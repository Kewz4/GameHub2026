import { useEffect } from "react";
import type {
  GameRecorderCaptureCommand,
  GameRecorderPreferences,
  GameRecorderSegmentMetadata,
} from "@types";
import {
  GAME_RECORDER_AUDIO_BITRATE,
  GAME_RECORDER_AUDIO_CHANNELS,
  GAME_RECORDER_AUDIO_SAMPLE_RATE,
  GAME_RECORDER_MIME_CANDIDATES,
  GAME_RECORDER_SEGMENT_DURATION_MS,
  getGameRecorderContainer,
  getGameRecorderTargetDimensions,
  getGameRecorderVideoBitrate,
} from "@shared";

// Prefer the hardware-encoded H.264/MP4 path; see GAME_RECORDER_MIME_CANDIDATES
// for why software VP9 is only a fallback.
const chooseMimeType = () =>
  GAME_RECORDER_MIME_CANDIDATES.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate)
  );

/**
 * Rebase a fragmented-MP4 media fragment onto a zero timeline.
 *
 * Every `moof` carries a `tfdt` whose baseMediaDecodeTime is measured from the
 * start of the recording session, so the 40th fragment claims to begin two
 * minutes in. Pairing such a fragment with the init segment yields a file that
 * plays but reports a duration counted from session start, which would change
 * how the concatenator lays segments out on the timeline. Zeroing the field
 * makes each committed segment start at 0 — exactly like the self-contained
 * files the restart-based path used to produce — so the main process keeps
 * working unchanged.
 */
const rebaseFragment = (
  bytes: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const typeAt = (offset: number) =>
    String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );

  // `moof` and `traf` are containers; `tfdt` is the leaf holding the time.
  const found: { offset: number; version: number; value: bigint }[] = [];
  const walk = (start: number, end: number) => {
    let offset = start;
    while (offset + 8 <= end) {
      const size = view.getUint32(offset);
      if (size < 8 || offset + size > end) return;
      const type = typeAt(offset);
      if (type === "moof" || type === "traf") {
        walk(offset + 8, offset + size);
      } else if (type === "tfdt") {
        const version = bytes[offset + 8];
        found.push({
          offset,
          version,
          value:
            version === 1
              ? view.getBigUint64(offset + 12)
              : BigInt(view.getUint32(offset + 12)),
        });
      }
      offset += size;
    }
  };

  walk(0, bytes.length);
  if (!found.length) return bytes;

  // One chunk can hold several moof/mdat pairs, and each track has its own
  // tfdt. Only the common base may be removed — zeroing them all individually
  // would stack every fragment and every track at time 0 and produce a file
  // the demuxer rejects.
  const base = found.reduce(
    (lowest, entry) => (entry.value < lowest ? entry.value : lowest),
    found[0].value
  );
  for (const entry of found) {
    const rebased = entry.value - base;
    if (entry.version === 1) view.setBigUint64(entry.offset + 12, rebased);
    else view.setUint32(entry.offset + 12, Number(rebased));
  }
  return bytes;
};

const getVideoConstraints = (
  configuration: GameRecorderPreferences
): MediaTrackConstraints => {
  const dimensions = getGameRecorderTargetDimensions(configuration.resolution);

  return {
    frameRate: {
      ideal: configuration.fps,
      max: configuration.fps,
    },
    ...(dimensions
      ? {
          width: {
            ideal: dimensions.width,
            max: dimensions.width,
          },
          height: {
            ideal: dimensions.height,
            max: dimensions.height,
          },
        }
      : {}),
  };
};

const getAudioConstraints = (): MediaTrackConstraints => ({
  channelCount: { ideal: GAME_RECORDER_AUDIO_CHANNELS },
  sampleRate: { ideal: GAME_RECORDER_AUDIO_SAMPLE_RATE },
  // System-loopback audio is already a finished mix. Speech processing makes
  // game music sound hollow, pumps quiet scenes, and can clip loud effects.
  autoGainControl: false,
  echoCancellation: false,
  noiseSuppression: false,
});

const applyVideoConstraints = async (
  track: MediaStreamTrack,
  configuration: GameRecorderPreferences
) => {
  const dimensions = getGameRecorderTargetDimensions(configuration.resolution);
  const frameRate = {
    ideal: configuration.fps,
    max: configuration.fps,
  };

  try {
    await track.applyConstraints(getVideoConstraints(configuration));
    return;
  } catch {
    // Desktop capture backends vary by Windows build and GPU driver. Retain a
    // working stream if one constraint is unsupported, while still applying
    // every compatible quality constraint independently.
  }

  await track.applyConstraints({ frameRate }).catch(() => undefined);
  if (dimensions) {
    await track
      .applyConstraints({
        width: { ideal: dimensions.width, max: dimensions.width },
        height: { ideal: dimensions.height, max: dimensions.height },
      })
      .catch(() => undefined);
  }
};

type CaptureOutputSettings = {
  width: number;
  height: number;
  frameRate: GameRecorderPreferences["fps"];
  normalized: boolean;
};

type CaptureStreamPipeline = {
  stream: MediaStream;
  outputSettings: CaptureOutputSettings;
  dispose: () => void;
};

const isPositiveFinite = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const stopStreams = (...streams: Array<MediaStream | null>) => {
  const tracks = new Set<MediaStreamTrack>();
  streams.forEach((stream) =>
    stream?.getTracks().forEach((track) => tracks.add(track))
  );
  tracks.forEach((track) => track.stop());
};

/**
 * Prepare the capture stream for MediaRecorder.
 *
 * This deliberately records the stream Chromium gives us, untouched. An earlier
 * version re-drew every frame into a 2D canvas to force an exact output size,
 * but that check ("does the source match the request?") compared the reported
 * frame rate to the target within 0.01 fps, which a live desktop capture never
 * satisfies — so the canvas path ran for every recording. Each frame then went
 * GPU capture -> <video> -> drawImage on the main thread -> captureStream, on a
 * setTimeout clock that is neither frame-accurate nor immune to throttling.
 * That is what produced the dropped frames and stutter.
 *
 * The capturer already scales to the constrained resolution on the GPU
 * (applyVideoConstraints ran before this), so there is nothing left to do per
 * frame: no JS runs between the capturer and the encoder.
 */
const createCaptureStreamPipeline = async (
  sourceStream: MediaStream,
  configuration: GameRecorderPreferences
): Promise<CaptureStreamPipeline> => {
  const sourceTrack = sourceStream.getVideoTracks()[0];
  if (!sourceTrack) throw new Error("The game window did not provide video.");

  // Tell the encoder this is high-motion video rather than static content, so
  // it spends its bitrate on temporal detail instead of preserving sharp edges.
  sourceTrack.contentHint = "motion";
  sourceStream.getAudioTracks().forEach((track) => {
    track.contentHint = "music";
  });

  const settings = sourceTrack.getSettings();
  const requested = getGameRecorderTargetDimensions(configuration.resolution);
  const width = isPositiveFinite(settings.width)
    ? settings.width
    : (requested?.width ?? 1_920);
  const height = isPositiveFinite(settings.height)
    ? settings.height
    : (requested?.height ?? 1_080);

  let disposed = false;
  return {
    stream: sourceStream,
    outputSettings: {
      width,
      height,
      frameRate: configuration.fps,
      normalized: false,
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stopStreams(sourceStream);
    },
  };
};

class CaptureController {
  private stream: MediaStream | null = null;
  private streamCleanups = new Map<MediaStream, () => void>();
  private recorder: MediaRecorder | null = null;
  private segmentTimer: number | null = null;
  private active = false;
  private startGeneration = 0;
  /** True while a single fragmented-MP4 recorder spans the whole session. */
  private continuous = false;

  public async handle(command: GameRecorderCaptureCommand) {
    if (command.type === "start" && command.configuration) {
      await this.start(command.configuration);
      return;
    }
    if (command.type === "flush") {
      this.rotateSegment();
      return;
    }
    if (command.type === "stop") {
      this.stop();
    }
  }

  private async start(configuration: GameRecorderPreferences) {
    this.stop();
    const generation = ++this.startGeneration;
    try {
      const videoConstraints = getVideoConstraints(configuration);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: configuration.captureGameAudio ? getAudioConstraints() : false,
        video: videoConstraints,
      });
      if (generation !== this.startGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack)
        throw new Error("The game window did not provide video.");
      await applyVideoConstraints(videoTrack, configuration);

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        await audioTrack
          .applyConstraints(getAudioConstraints())
          .catch(() => undefined);
      }

      // Normalize the capture to the exact selected resolution/frame rate when
      // Chromium could not honor them directly. The pipeline may hand back a
      // canvas-backed stream, so everything below records `pipeline.stream`.
      const pipeline = await createCaptureStreamPipeline(stream, configuration);

      if (generation !== this.startGeneration) {
        pipeline.dispose();
        return;
      }

      const outputStream = pipeline.stream;
      this.stream = outputStream;
      this.streamCleanups.set(outputStream, pipeline.dispose);
      this.active = true;

      // Watch the source track: a normalized canvas track keeps producing
      // frames even after the game window disappears.
      videoTrack.addEventListener(
        "ended",
        () => {
          if (
            generation !== this.startGeneration ||
            this.stream !== outputStream ||
            !this.active
          ) {
            return;
          }
          this.stop();
          void window.electron.gameRecorderCaptureError(
            "The game window capture ended unexpectedly."
          );
        },
        { once: true }
      );
      this.startSegment(
        configuration,
        generation,
        outputStream,
        pipeline.outputSettings
      );
    } catch (error) {
      this.active = false;
      this.closeStream();
      await window.electron.gameRecorderCaptureError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private startSegment(
    configuration: GameRecorderPreferences,
    generation: number,
    stream: MediaStream,
    outputSettings: CaptureOutputSettings
  ) {
    if (
      !this.active ||
      generation !== this.startGeneration ||
      stream !== this.stream
    ) {
      return;
    }

    const mimeType = chooseMimeType();
    // The pipeline's settings are authoritative: for a normalized capture the
    // canvas dimensions are what actually gets encoded.
    const videoBitsPerSecond = getGameRecorderVideoBitrate(
      configuration,
      {
        width: outputSettings.width,
        height: outputSettings.height,
      },
      mimeType
    );
    const hasAudio = stream.getAudioTracks().length > 0;
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond,
      ...(hasAudio ? { audioBitsPerSecond: GAME_RECORDER_AUDIO_BITRATE } : {}),
    });

    this.recorder = recorder;
    const chunks: Blob[] = [];
    const segmentStartedAt = Date.now();

    const commitSegment = (blob: Blob, startedAt: number, endedAt: number) =>
      blob
        .arrayBuffer()
        .then((payload) => {
          const metadata: GameRecorderSegmentMetadata = {
            startedAt,
            endedAt,
            mimeType: blob.type || mimeType || "video/webm",
            hasAudio,
            outputWidth: outputSettings.width,
            outputHeight: outputSettings.height,
            outputFps: outputSettings.frameRate,
            normalizedOutput: outputSettings.normalized,
          };
          return window.electron.gameRecorderCommitSegment(metadata, payload);
        })
        .catch((error) =>
          window.electron.gameRecorderCaptureError(
            error instanceof Error ? error.message : String(error)
          )
        );

    // Fragmented MP4 lets one encoder run for the whole session. Chromium emits
    // the first chunk as `ftyp`+`moov` — an init segment carrying no media —
    // and every later chunk as `moof`+`mdat` fragments, so prepending the init
    // to a fragment reproduces a self-contained file without duplicating a
    // single frame. The previous approach stopped and recreated the recorder
    // every few seconds, and re-initializing the hardware H.264 encode session
    // dropped frames at every boundary. WebM cannot do this (its first chunk
    // already contains media), so it keeps the restart-based rotation below.
    if (getGameRecorderContainer(mimeType) === "mp4") {
      this.continuous = true;
      let initSegment: Blob | null = null;
      let sliceStartedAt = segmentStartedAt;

      recorder.addEventListener("dataavailable", (event) => {
        if (!event.data.size) return;
        if (!initSegment) {
          initSegment = event.data;
          sliceStartedAt = Date.now();
          return;
        }
        // Chromium can deliver the init segment and the first fragment in the
        // same task, and a flush emits one immediately after the previous
        // slice, so two events can land on the same millisecond. The main
        // process rejects a segment whose end is not after its start, which
        // silently dropped those. Advance by at least a millisecond to keep
        // the slice boundaries strictly increasing.
        const startedAt = sliceStartedAt;
        const endedAt = Math.max(Date.now(), startedAt + 1);
        sliceStartedAt = endedAt;
        const init = initSegment;
        void event.data
          .arrayBuffer()
          .then((fragment) =>
            commitSegment(
              new Blob([init, rebaseFragment(new Uint8Array(fragment))], {
                type: recorder.mimeType || mimeType,
              }),
              startedAt,
              endedAt
            )
          )
          .catch((error) =>
            window.electron.gameRecorderCaptureError(
              error instanceof Error ? error.message : String(error)
            )
          );
      });
      recorder.addEventListener(
        "error",
        (event) => {
          const message =
            "error" in event && event.error instanceof Error
              ? event.error.message
              : "The browser media encoder stopped unexpectedly.";
          void window.electron.gameRecorderCaptureError(message);
        },
        { once: true }
      );
      recorder.addEventListener(
        "stop",
        () => {
          if (this.recorder === recorder) this.recorder = null;
          this.closeStream(stream);
        },
        { once: true }
      );
      // The timeslice makes `dataavailable` fire on a cadence without ever
      // tearing the encoder down.
      recorder.start(GAME_RECORDER_SEGMENT_DURATION_MS);
      return;
    }

    this.continuous = false;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener(
      "error",
      (event) => {
        const message =
          "error" in event && event.error instanceof Error
            ? event.error.message
            : "The browser media encoder stopped unexpectedly.";
        void window.electron.gameRecorderCaptureError(message);
      },
      { once: true }
    );
    recorder.addEventListener(
      "stop",
      () => {
        const endedAt = Date.now();
        if (this.recorder === recorder) this.recorder = null;

        // Start the next self-contained WebM immediately. Each segment gets its
        // own container header, so the main process can retain only the latest
        // 15–60 seconds and concatenate those files without re-encoding.
        if (
          this.active &&
          generation === this.startGeneration &&
          this.stream === stream
        ) {
          this.startSegment(configuration, generation, stream, outputSettings);
        } else {
          this.closeStream(stream);
        }

        if (!chunks.length) return;
        void commitSegment(
          new Blob(chunks, {
            type: recorder.mimeType || mimeType || "video/webm",
          }),
          segmentStartedAt,
          endedAt
        );
      },
      { once: true }
    );
    recorder.start();
    this.segmentTimer = window.setTimeout(
      () => this.rotateSegment(),
      GAME_RECORDER_SEGMENT_DURATION_MS
    );
  }

  private rotateSegment() {
    if (this.segmentTimer !== null) {
      window.clearTimeout(this.segmentTimer);
      this.segmentTimer = null;
    }
    if (this.recorder?.state !== "recording") return;
    // A flush must not cost frames. In continuous mode `requestData()` emits
    // everything buffered so far and leaves the encoder running; only the
    // restart-based WebM path has to stop to close its container.
    if (this.continuous) this.recorder.requestData();
    else this.recorder.stop();
  }

  private stop() {
    this.startGeneration += 1;
    this.active = false;
    if (this.segmentTimer !== null) {
      window.clearTimeout(this.segmentTimer);
      this.segmentTimer = null;
    }
    if (this.recorder?.state === "recording") this.recorder.stop();
    else this.closeStream();
  }

  private closeStream(stream = this.stream) {
    if (!stream) return;
    // dispose() tears down the whole pipeline (source, canvas and output
    // streams plus the frame timer); stopping the output tracks alone would
    // leave the underlying display capture running.
    const dispose = this.streamCleanups.get(stream);
    if (dispose) {
      this.streamCleanups.delete(stream);
      dispose();
    } else {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (this.stream === stream) this.stream = null;
  }
}

const captureController = new CaptureController();

export default function GameRecorderCapture() {
  useEffect(() => {
    const unsubscribe = window.electron.onGameRecorderCaptureCommand(
      (command) => {
        void captureController.handle(command);
      }
    );
    void window.electron.gameRecorderCaptureReady();
    return unsubscribe;
  }, []);

  return null;
}
