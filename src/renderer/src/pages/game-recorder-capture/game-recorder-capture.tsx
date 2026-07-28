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
  getGameRecorderTargetDimensions,
  getGameRecorderVideoBitrate,
} from "@shared";

// Prefer the hardware-encoded H.264/MP4 path; see GAME_RECORDER_MIME_CANDIDATES
// for why software VP9 is only a fallback.
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
  frameRate: GameRecorderPreferences["fps"];
  normalized: boolean;
};

type CaptureStreamPipeline = {
  stream: MediaStream;
  outputSettings: CaptureOutputSettings;
  dispose: () => void;
};

const VIDEO_READY_TIMEOUT_MS = 5_000;
const FRAME_RATE_EPSILON = 0.01;
const FRAME_RATE_SAMPLE_MS = 2_000;
const MINIMUM_SUSTAINED_FRAME_RATE_RATIO = 0.95;
const MAX_CONSECUTIVE_SLOW_SAMPLES = 3;

const isPositiveFinite = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const stopStreams = (...streams: Array<MediaStream | null>) => {
  const tracks = new Set<MediaStreamTrack>();
  streams.forEach((stream) =>
    stream?.getTracks().forEach((track) => tracks.add(track))
  );
  tracks.forEach((track) => track.stop());
};

const waitForVideoData = async (video: HTMLVideoElement) => {
  if (
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  ) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener("loadeddata", handleReady);
      video.removeEventListener("resize", handleReady);
      video.removeEventListener("error", handleError);
    };
    const handleReady = () => {
      if (video.videoWidth <= 0 || video.videoHeight <= 0) return;
      cleanup();
      resolve();
    };
    const handleError = () => {
      const detail = video.error?.message;
      cleanup();
      reject(
        new Error(
          detail
            ? `The game capture could not be decoded: ${detail}`
            : "The game capture could not provide a video frame."
        )
      );
    };
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "The game capture did not provide a video frame within five seconds."
        )
      );
    }, VIDEO_READY_TIMEOUT_MS);

    video.addEventListener("loadeddata", handleReady);
    video.addEventListener("resize", handleReady);
    video.addEventListener("error", handleError);
  });
};

const createCaptureStreamPipeline = async (
  sourceStream: MediaStream,
  configuration: GameRecorderPreferences,
  onRuntimeError: (message: string) => void
): Promise<CaptureStreamPipeline> => {
  const sourceTrack = sourceStream.getVideoTracks()[0];
  if (!sourceTrack) throw new Error("The game window did not provide video.");

  const requestedDimensions = getGameRecorderTargetDimensions(
    configuration.resolution
  );
  const sourceSettings = sourceTrack.getSettings();
  const sourceWidth = sourceSettings.width;
  const sourceHeight = sourceSettings.height;
  const sourceFrameRate = sourceSettings.frameRate;
  const hasKnownSourceDimensions =
    isPositiveFinite(sourceWidth) && isPositiveFinite(sourceHeight);
  const dimensionsMatch =
    requestedDimensions === null
      ? hasKnownSourceDimensions
      : sourceWidth === requestedDimensions.width &&
        sourceHeight === requestedDimensions.height;
  const frameRateMatches =
    isPositiveFinite(sourceFrameRate) &&
    Math.abs(sourceFrameRate - configuration.fps) <= FRAME_RATE_EPSILON;

  // Preserve a direct, lossless capture path when Chromium proves that the
  // backend honored every selected setting. Unknown or mismatched settings are
  // normalized below instead of silently recording a lower mode.
  if (dimensionsMatch && frameRateMatches && hasKnownSourceDimensions) {
    sourceTrack.contentHint = "motion";
    sourceStream
      .getAudioTracks()
      .forEach((track) => (track.contentHint = "music"));
    let disposed = false;
    return {
      stream: sourceStream,
      outputSettings: {
        width: sourceWidth,
        height: sourceHeight,
        frameRate: configuration.fps,
        normalized: false,
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        stopStreams(sourceStream);
      },
    };
  }

  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.disablePictureInPicture = true;
  video.srcObject = sourceStream;

  let canvasStream: MediaStream | null = null;
  let outputStream: MediaStream | null = null;
  let frameTimer: number | null = null;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (frameTimer !== null) {
      window.clearTimeout(frameTimer);
      frameTimer = null;
    }
    video.pause();
    video.srcObject = null;
    stopStreams(outputStream, canvasStream, sourceStream);
  };

  try {
    await video.play();
    await waitForVideoData(video);

    const targetWidth = requestedDimensions?.width ?? video.videoWidth;
    const targetHeight = requestedDimensions?.height ?? video.videoHeight;
    if (!isPositiveFinite(targetWidth) || !isPositiveFinite(targetHeight)) {
      throw new Error(
        "The recorder could not determine the game window's output resolution."
      );
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(targetWidth);
    canvas.height = Math.round(targetHeight);
    const context = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
    if (!context) {
      throw new Error(
        "Canvas video normalization is unavailable in this renderer."
      );
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const drawFrame = () => {
      const currentSourceWidth = video.videoWidth;
      const currentSourceHeight = video.videoHeight;
      if (currentSourceWidth <= 0 || currentSourceHeight <= 0) {
        throw new Error("The game capture stopped providing video frames.");
      }
      const scale = Math.min(
        canvas.width / currentSourceWidth,
        canvas.height / currentSourceHeight
      );
      const drawWidth = Math.max(1, Math.round(currentSourceWidth * scale));
      const drawHeight = Math.max(1, Math.round(currentSourceHeight * scale));
      const drawX = Math.floor((canvas.width - drawWidth) / 2);
      const drawY = Math.floor((canvas.height - drawHeight) / 2);

      // Never crop or stretch gameplay. Non-matching aspect ratios receive
      // neutral letterboxing/pillarboxing inside the exact configured output.
      context.fillStyle = "#000";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, drawX, drawY, drawWidth, drawHeight);
    };

    drawFrame();
    canvasStream = canvas.captureStream(0);
    const canvasTrack = canvasStream.getVideoTracks()[0] as
      | CanvasCaptureMediaStreamTrack
      | undefined;
    if (!canvasTrack || typeof canvasTrack.requestFrame !== "function") {
      throw new Error(
        "This Chromium build cannot guarantee the selected recorder frame rate."
      );
    }
    canvasTrack.contentHint = "motion";

    const canvasSettings = canvasTrack.getSettings();
    if (
      (isPositiveFinite(canvasSettings.width) &&
        canvasSettings.width !== canvas.width) ||
      (isPositiveFinite(canvasSettings.height) &&
        canvasSettings.height !== canvas.height)
    ) {
      throw new Error(
        `The recorder requested ${canvas.width}×${canvas.height}, but Chromium created ${canvasSettings.width ?? "unknown"}×${canvasSettings.height ?? "unknown"}.`
      );
    }

    sourceStream
      .getAudioTracks()
      .forEach((track) => (track.contentHint = "music"));
    outputStream = new MediaStream([
      canvasTrack,
      ...sourceStream.getAudioTracks(),
    ]);

    const frameIntervalMs = 1_000 / configuration.fps;
    let nextFrameAt = performance.now();
    let sampleStartedAt = nextFrameAt;
    let sampledFrames = 0;
    let consecutiveSlowSamples = 0;
    let runtimeFailed = false;

    const failRuntime = (message: string) => {
      if (runtimeFailed || disposed) return;
      runtimeFailed = true;
      if (frameTimer !== null) {
        window.clearTimeout(frameTimer);
        frameTimer = null;
      }
      onRuntimeError(message);
    };

    const scheduleNextFrame = () => {
      if (disposed || runtimeFailed) return;
      frameTimer = window.setTimeout(
        emitFrame,
        Math.max(0, nextFrameAt - performance.now())
      );
    };

    const emitFrame = () => {
      frameTimer = null;
      if (disposed || runtimeFailed) return;

      const now = performance.now();
      if (now + 0.25 < nextFrameAt) {
        scheduleNextFrame();
        return;
      }

      try {
        drawFrame();
        canvasTrack.requestFrame();
      } catch (error) {
        failRuntime(
          error instanceof Error
            ? error.message
            : "The recorder could not normalize the game video."
        );
        return;
      }

      sampledFrames += 1;
      nextFrameAt += frameIntervalMs;
      if (nextFrameAt < now - frameIntervalMs) {
        const skippedIntervals =
          Math.floor((now - nextFrameAt) / frameIntervalMs) + 1;
        nextFrameAt += skippedIntervals * frameIntervalMs;
      }

      const sampleElapsedMs = now - sampleStartedAt;
      if (sampleElapsedMs >= FRAME_RATE_SAMPLE_MS) {
        const sustainedFrameRate = (sampledFrames * 1_000) / sampleElapsedMs;
        if (
          sustainedFrameRate <
          configuration.fps * MINIMUM_SUSTAINED_FRAME_RATE_RATIO
        ) {
          consecutiveSlowSamples += 1;
        } else {
          consecutiveSlowSamples = 0;
        }
        sampleStartedAt = now;
        sampledFrames = 0;

        if (consecutiveSlowSamples >= MAX_CONSECUTIVE_SLOW_SAMPLES) {
          failRuntime(
            `The recorder could not sustain ${configuration.fps} FPS at ${canvas.width}×${canvas.height}. Reduce the selected resolution or frame rate.`
          );
          return;
        }
      }

      scheduleNextFrame();
    };

    // Request the first encoded canvas frame immediately, then maintain a
    // drift-corrected fixed cadence. Repeated source frames are intentional
    // when a game renders below the selected output FPS.
    canvasTrack.requestFrame();
    sampledFrames = 1;
    nextFrameAt += frameIntervalMs;
    scheduleNextFrame();

    return {
      stream: outputStream,
      outputSettings: {
        width: canvas.width,
        height: canvas.height,
        frameRate: configuration.fps,
        normalized: true,
      },
      dispose: () => {
        dispose();
        // Release the backing GPU surface after its capture track is stopped.
        canvas.width = 1;
        canvas.height = 1;
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
};

class CaptureController {
  private stream: MediaStream | null = null;
  private streamCleanups = new Map<MediaStream, () => void>();
  private recorder: MediaRecorder | null = null;
  private segmentTimer: number | null = null;
  private active = false;
  private startGeneration = 0;

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
      const pipeline = await createCaptureStreamPipeline(
        stream,
        configuration,
        (message) => {
          if (generation !== this.startGeneration || !this.active) return;
          this.stop();
          void window.electron.gameRecorderCaptureError(message);
        }
      );

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
        const blob = new Blob(chunks, {
          type: recorder.mimeType || mimeType || "video/webm",
        });
        void blob
          .arrayBuffer()
          .then((payload) => {
            const metadata: GameRecorderSegmentMetadata = {
              startedAt: segmentStartedAt,
              endedAt,
              mimeType: blob.type || "video/webm",
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
    if (this.recorder?.state === "recording") {
      this.recorder.stop();
    }
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
