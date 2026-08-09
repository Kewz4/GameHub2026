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
  FragmentedMp4SegmentAssembler,
  getFragmentedMp4VideoFrameCount,
  getGameRecorderContainer,
  getGameRecorderTargetDimensions,
  getGameRecorderVideoBitrate,
} from "@shared";

// Prefer H.264/MP4, for which Chromium can use a platform encoder when the
// selected profile and geometry are supported. Runtime telemetry remains the
// authority because accepting this MIME type does not prove acceleration.
const chooseMimeType = () =>
  GAME_RECORDER_MIME_CANDIDATES.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate)
  );

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
  frameRate: number;
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
  const frameRate = isPositiveFinite(settings.frameRate)
    ? Math.round(settings.frameRate * 100) / 100
    : configuration.fps;

  let disposed = false;
  return {
    stream: sourceStream,
    outputSettings: {
      width,
      height,
      frameRate,
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
  /** Recorders stopped on background/target loss must not leak the final
   * desktop-containing fragment into a clip. */
  private discardedRecorders = new WeakSet<MediaRecorder>();

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
      this.stop(Boolean(command.discardPending));
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
      // Fragmented MP4 can only close a media slice on a keyframe. Chromium's
      // default GOP may be longer than the replay segment cadence, leaving the
      // rolling buffer empty until recording stops. Align keyframes with the
      // requested segment duration so each timeslice is independently usable.
      ...(getGameRecorderContainer(mimeType) === "mp4"
        ? {
            videoKeyFrameIntervalDuration: GAME_RECORDER_SEGMENT_DURATION_MS,
          }
        : {}),
      ...(hasAudio ? { audioBitsPerSecond: GAME_RECORDER_AUDIO_BITRATE } : {}),
    });

    this.recorder = recorder;
    const chunks: Blob[] = [];
    const segmentStartedAt = Date.now();

    const commitSegment = (blob: Blob, startedAt: number, endedAt: number) =>
      blob
        .arrayBuffer()
        .then((payload) => {
          const encodedVideoFrames =
            getGameRecorderContainer(blob.type || mimeType) === "mp4"
              ? getFragmentedMp4VideoFrameCount(new Uint8Array(payload))
              : null;
          const metadata: GameRecorderSegmentMetadata = {
            startedAt,
            endedAt,
            mimeType: blob.type || mimeType || "video/webm",
            hasAudio,
            outputWidth: outputSettings.width,
            outputHeight: outputSettings.height,
            outputFps: outputSettings.frameRate,
            targetVideoBitrate: videoBitsPerSecond,
            encodedVideoFrames,
            normalizedOutput: outputSettings.normalized,
          };
          return window.electron.gameRecorderCommitSegment(metadata, payload);
        })
        .catch((error) =>
          window.electron.gameRecorderCaptureError(
            error instanceof Error ? error.message : String(error)
          )
        );

    // Fragmented MP4 lets one encoder run for the whole session. Chromium may
    // split the initialization across events (`ftyp`, then
    // `moov`+`moof`+`mdat`), so accumulate and parse complete ISO boxes instead
    // of assuming the first Blob is the whole reusable initialization segment.
    // WebM cannot be split this way and keeps restart-based rotation below.
    if (getGameRecorderContainer(mimeType) === "mp4") {
      this.continuous = true;
      const assembler = new FragmentedMp4SegmentAssembler();
      let sliceStartedAt = segmentStartedAt;
      let processing = Promise.resolve();

      recorder.addEventListener("dataavailable", (event) => {
        if (!event.data.size || this.discardedRecorders.has(recorder)) return;
        const eventEndedAt = Date.now();
        // Blob reads may resolve out of order. Serialize them so segment files
        // and their timestamps always remain in recorder emission order.
        processing = processing
          .then(async () => {
            if (this.discardedRecorders.has(recorder)) return;
            const emitted = new Uint8Array(await event.data.arrayBuffer());
            const segment = assembler.push(emitted);
            if (!segment || this.discardedRecorders.has(recorder)) {
              return;
            }

            // A flush can land in the same millisecond as a scheduled slice.
            // Keep boundaries strictly increasing for main-process validation.
            const startedAt = sliceStartedAt;
            const endedAt = Math.max(eventEndedAt, startedAt + 1);
            sliceStartedAt = endedAt;
            await commitSegment(
              new Blob([segment], { type: recorder.mimeType || mimeType }),
              startedAt,
              endedAt
            );
          })
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
      if (event.data.size > 0 && !this.discardedRecorders.has(recorder)) {
        chunks.push(event.data);
      }
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

        if (!chunks.length || this.discardedRecorders.has(recorder)) return;
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

  private stop(discardPending = false) {
    this.startGeneration += 1;
    this.active = false;
    if (this.segmentTimer !== null) {
      window.clearTimeout(this.segmentTimer);
      this.segmentTimer = null;
    }
    if (this.recorder?.state === "recording") {
      if (discardPending) this.discardedRecorders.add(this.recorder);
      this.recorder.stop();
    } else this.closeStream();
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
