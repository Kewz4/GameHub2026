import type {
  GameRecorderPcmChunkMetadata,
  GameRecorderPreferences,
} from "@types";
import { GAME_RECORDER_SEGMENT_DURATION_MS } from "../../shared";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildNativeRecorderFfmpegArguments,
  buildNativeRecorderProbeArguments,
  getNativeRecorderInitialAudioPaddingFrames,
  parseNativeRecorderSegmentListEntry,
  type NativeRecorderEncoder,
} from "./game-recorder-native-ffmpeg";
import { buildLinuxRecorderFfmpegArguments } from "./linux-recorder-ffmpeg";
import type { LinuxRecorderEncoder } from "./linux-recorder-encoder";

export type NativeRecorderCompletedSegment = {
  path: string;
  startedAt: number;
  endedAt: number;
  bytes: number;
  encodedVideoFrames: number | null;
};

type NativeRecorderSessionOptions = {
  ffmpegPath: string;
  encoder: NativeRecorderEncoder;
  linux?: {
    display: string;
    pulseMonitor: string | null;
    encoder?: LinuxRecorderEncoder;
  };
  configuration: GameRecorderPreferences;
  captureSessionId: number;
  windowHandle: string;
  sourceWidth: number;
  sourceHeight: number;
  segmentDirectory: string;
  onSegment: (segment: NativeRecorderCompletedSegment) => Promise<void> | void;
  onFatalError: (message: string) => Promise<void> | void;
};

const runProbe = (executable: string, args: string[], timeoutMs: number) =>
  new Promise<boolean>((resolve) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(false);
    }, timeoutMs);
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
  });

export const probeNativeRecorderEncoder = (
  ffmpegPath: string,
  encoder: NativeRecorderEncoder = "h264_nvenc"
) => runProbe(ffmpegPath, buildNativeRecorderProbeArguments(encoder), 8_000);

export class NativeRecorderSession {
  public readonly captureSessionId: number;
  public readonly encoder: NativeRecorderEncoder | LinuxRecorderEncoder["name"];
  public readonly dimensions: { width: number; height: number };
  public readonly targetVideoBitrate: number;
  public readonly outputFps: number;
  public readonly startedAt: number;
  public readonly hasAudio: boolean;

  private readonly options: NativeRecorderSessionOptions;
  private readonly prefix: string;
  private readonly outputPattern: string;
  private child: ChildProcessWithoutNullStreams | null = null;
  private stopping = false;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private segmentChain = Promise.resolve();
  private committedPaths = new Set<string>();
  private startupTimeout: NodeJS.Timeout | null = null;
  private pcmTimelineStarted = false;
  private completion: Promise<void> = Promise.resolve();
  private resolveCompletion: (() => void) | null = null;

  constructor(options: NativeRecorderSessionOptions) {
    this.options = options;
    this.captureSessionId = options.captureSessionId;
    this.encoder = options.linux
      ? (options.linux.encoder?.name ?? "libx264")
      : options.encoder;
    this.startedAt = Date.now();
    this.hasAudio = options.linux
      ? Boolean(
          options.configuration.captureGameAudio && options.linux.pulseMonitor
        )
      : options.configuration.captureGameAudio;
    this.outputFps = options.configuration.fps;
    this.prefix = `native-${String(options.captureSessionId).padStart(8, "0")}`;
    this.outputPattern = path.join(
      options.segmentDirectory,
      `${this.prefix}-%08d.mp4`
    );
    const built = this.buildArguments();
    this.dimensions = built.dimensions;
    this.targetVideoBitrate = built.targetBitrate;
  }

  public start() {
    if (this.child) throw new Error("The native recorder is already running.");
    const built = this.buildArguments();
    const child = spawn(this.options.ffmpegPath, built.args, {
      windowsHide: true,
      stdio: [
        this.hasAudio && !this.options.linux ? "pipe" : "ignore",
        "pipe",
        "pipe",
      ],
    }) as ChildProcessWithoutNullStreams;
    this.child = child;
    this.completion = new Promise<void>((resolve) => {
      this.resolveCompletion = resolve;
    });
    this.startupTimeout = setTimeout(() => {
      if (!this.stopping && this.committedPaths.size === 0) {
        void this.options.onFatalError(
          "The native encoder did not produce its first replay segment."
        );
      }
    }, 12_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on("data", (chunk: string) => this.consumeStderr(chunk));
    child.once("error", (error) => {
      if (!this.stopping) void this.options.onFatalError(error.message);
    });
    child.once("exit", (code) => {
      this.clearStartupTimeout();
      if (this.child === child) this.child = null;
      if (!this.stopping && code !== 0) {
        const diagnostic = this.stderrBuffer.trim();
        void this.options.onFatalError(
          diagnostic || `Native video encoder exited with code ${String(code)}.`
        );
      }
    });
    child.once("close", () => {
      this.clearStartupTimeout();
      if (this.child === child) this.child = null;
      const trailingLine = this.stdoutBuffer.trim();
      this.stdoutBuffer = "";
      if (trailingLine) this.queueSegment(trailingLine);
      void this.segmentChain
        .then(() => this.cleanupIncompleteSegments())
        .catch(() => undefined)
        .finally(() => {
          this.resolveCompletion?.();
          this.resolveCompletion = null;
        });
    });
  }

  public async writePcmChunk(
    metadata: GameRecorderPcmChunkMetadata,
    payload: ArrayBuffer | Uint8Array
  ) {
    if (!this.hasAudio || this.options.linux) return;
    if (metadata.captureSessionId !== this.captureSessionId) {
      throw new Error("Recorder PCM belongs to an inactive capture session.");
    }
    if (
      metadata.sampleRate !== 48_000 ||
      metadata.channels !== 2 ||
      !Number.isSafeInteger(metadata.frameCount) ||
      metadata.frameCount <= 0 ||
      !Number.isFinite(metadata.chunkStartedAt)
    ) {
      throw new Error("Recorder PCM metadata was invalid.");
    }
    const bytes =
      payload instanceof Uint8Array
        ? Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
        : Buffer.from(payload);
    if (bytes.byteLength !== metadata.frameCount * metadata.channels * 4) {
      throw new Error("Recorder PCM payload size did not match its metadata.");
    }
    const child = this.child;
    if (!child?.stdin || child.stdin.destroyed || this.stopping) return;
    if (!this.pcmTimelineStarted) {
      this.pcmTimelineStarted = true;
      const paddingFrames = getNativeRecorderInitialAudioPaddingFrames(
        this.startedAt,
        metadata.chunkStartedAt,
        metadata.sampleRate
      );
      if (paddingFrames > 0) {
        await this.writePcmBytes(
          child,
          Buffer.alloc(paddingFrames * metadata.channels * 4)
        );
      }
    }
    await this.writePcmBytes(child, bytes);
  }

  public stop(): Promise<void> {
    if (this.stopping) return this.completion;
    this.stopping = true;
    this.clearStartupTimeout();
    const child = this.child;
    if (!child) return this.completion;
    child.stdin?.end();
    child.kill();
    if (this.options.linux) {
      // A failed driver/encoder may ignore graceful termination. Bound teardown
      // of this owned FFmpeg child before trying a software replacement.
      const forceStop = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }, 2000);
      forceStop.unref();
      void this.completion.finally(() => clearTimeout(forceStop));
    }
    return this.completion;
  }

  private consumeStdout(chunk: string) {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) this.queueSegment(line);
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private async writePcmBytes(
    child: ChildProcessWithoutNullStreams,
    bytes: Uint8Array
  ) {
    if (child.stdin.destroyed || this.stopping) return;
    if (child.stdin.write(bytes)) return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        child.stdin.off("drain", finish);
        child.stdin.off("error", finish);
        child.off("exit", finish);
        resolve();
      };
      child.stdin.once("drain", finish);
      child.stdin.once("error", finish);
      child.once("exit", finish);
    });
  }

  private consumeStderr(chunk: string) {
    for (const line of chunk.split(/\r?\n/u)) {
      if (line.trim() && !/^[a-z_]+=/u.test(line.trim())) {
        this.stderrBuffer = `${this.stderrBuffer}${line}\n`.slice(-6_000);
      }
    }
  }

  private queueSegment(line: string) {
    const entry = parseNativeRecorderSegmentListEntry(line);
    if (!entry) return;
    this.segmentChain = this.segmentChain.then(async () => {
      const resolvedDirectory = path.resolve(this.options.segmentDirectory);
      const segmentName = path.basename(entry.path);
      const resolvedPath = path.join(resolvedDirectory, segmentName);
      if (
        !segmentName.startsWith(`${this.prefix}-`) ||
        path.extname(segmentName).toLowerCase() !== ".mp4"
      ) {
        throw new Error(
          "Native recorder reported a segment outside its session."
        );
      }
      const stats = await fs.promises.stat(resolvedPath);
      if (!stats.isFile() || stats.size <= 0) return;
      // The native pipeline explicitly enforces CFR before muxing. Cap at one
      // segment interval because the first MP4 can include a few milliseconds
      // of AAC priming beyond its 180 video frames.
      const videoDurationSeconds = Math.min(
        GAME_RECORDER_SEGMENT_DURATION_MS / 1_000,
        entry.endSeconds - entry.startSeconds
      );
      const frameCount = Math.max(
        1,
        Math.round(videoDurationSeconds * this.options.configuration.fps)
      );
      this.committedPaths.add(resolvedPath);
      this.clearStartupTimeout();
      await this.options.onSegment({
        path: resolvedPath,
        startedAt: this.startedAt + Math.round(entry.startSeconds * 1_000),
        endedAt: this.startedAt + Math.round(entry.endSeconds * 1_000),
        bytes: stats.size,
        encodedVideoFrames: frameCount > 0 ? frameCount : null,
      });
    });
    this.segmentChain = this.segmentChain.catch((error) => {
      if (!this.stopping) {
        void this.options.onFatalError(
          error instanceof Error ? error.message : String(error)
        );
      }
    });
  }

  private async cleanupIncompleteSegments() {
    const entries = await fs.promises
      .readdir(this.options.segmentDirectory, { withFileTypes: true })
      .catch(() => []);
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.startsWith(`${this.prefix}-`) &&
            !this.committedPaths.has(
              path.join(this.options.segmentDirectory, entry.name)
            )
        )
        .map((entry) =>
          fs.promises
            .rm(path.join(this.options.segmentDirectory, entry.name), {
              force: true,
            })
            .catch(() => undefined)
        )
    );
  }

  private clearStartupTimeout() {
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
    this.startupTimeout = null;
  }

  private buildArguments() {
    const options = this.options;
    if (options.linux)
      return buildLinuxRecorderFfmpegArguments({
        configuration: options.configuration,
        windowId: options.windowHandle,
        display: options.linux.display,
        pulseMonitor: this.hasAudio ? options.linux.pulseMonitor : null,
        encoder: options.linux.encoder,
        sourceWidth: options.sourceWidth,
        sourceHeight: options.sourceHeight,
        outputPattern: this.outputPattern,
      });
    return buildNativeRecorderFfmpegArguments({
      configuration: options.configuration,
      encoder: options.encoder,
      ffmpegWindowHandle: options.windowHandle,
      sourceWidth: options.sourceWidth,
      sourceHeight: options.sourceHeight,
      outputPattern: this.outputPattern,
      includeAudio: this.hasAudio,
    });
  }
}
