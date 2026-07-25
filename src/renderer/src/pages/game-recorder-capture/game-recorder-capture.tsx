import { useEffect } from "react";
import type {
  GameRecorderCaptureCommand,
  GameRecorderPreferences,
  GameRecorderSegmentMetadata,
} from "@types";

const SEGMENT_DURATION_MS = 2_000;

const RESOLUTION_HEIGHT: Record<
  GameRecorderPreferences["resolution"],
  number | null
> = {
  source: null,
  "720p": 720,
  "1080p": 1080,
  "1440p": 1440,
  "2160p": 2160,
};

const VIDEO_BITRATE: Record<
  Exclude<GameRecorderPreferences["resolution"], "source">,
  number
> = {
  "720p": 6_000_000,
  "1080p": 12_000_000,
  "1440p": 20_000_000,
  "2160p": 36_000_000,
};

const chooseMimeType = () => {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate)
  );
};

class CaptureController {
  private stream: MediaStream | null = null;
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
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: configuration.captureGameAudio,
        video: true,
      });
      if (generation !== this.startGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack)
        throw new Error("The game window did not provide video.");
      const targetHeight = RESOLUTION_HEIGHT[configuration.resolution];
      await videoTrack
        .applyConstraints({
          frameRate: {
            ideal: configuration.fps,
            max: configuration.fps,
          },
          ...(targetHeight
            ? {
                height: {
                  ideal: targetHeight,
                  max: targetHeight,
                },
              }
            : {}),
        })
        .catch(() => undefined);

      this.stream = stream;
      this.active = true;
      videoTrack.addEventListener(
        "ended",
        () => {
          if (
            generation !== this.startGeneration ||
            this.stream !== stream ||
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
      this.startSegment(configuration, generation, stream);
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
    stream: MediaStream
  ) {
    if (
      !this.active ||
      generation !== this.startGeneration ||
      stream !== this.stream
    ) {
      return;
    }

    const mimeType = chooseMimeType();
    const baseBitrate =
      configuration.resolution === "source"
        ? 20_000_000
        : VIDEO_BITRATE[configuration.resolution];
    const frameRateMultiplier =
      configuration.fps >= 120 ? 1.7 : configuration.fps <= 30 ? 0.65 : 1;
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: Math.round(baseBitrate * frameRateMultiplier),
      audioBitsPerSecond: 192_000,
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
          this.startSegment(configuration, generation, stream);
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
      SEGMENT_DURATION_MS
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
    stream?.getTracks().forEach((track) => track.stop());
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
