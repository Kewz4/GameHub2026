import { app } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Game, HydraOverlayPerformance } from "@types";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";
import { getLinuxOverlayMetricsDirectory } from "./linux-overlay-launch";
import {
  calculateOverlayPerformance,
  isPresentMonFrameTimeHeader,
  parseCsvRow,
  parseMangoHudFrameTimes,
  parsePresentMonSample,
  resolvePresentMonFrameTimeColumns,
  type PresentMonSample,
} from "./overlay-performance-metrics";

const UPDATE_INTERVAL = 500;
const MAX_SAMPLES = 600;
// The elevated bridge clears any stale ETW session before starting PresentMon,
// and a game can take a few seconds to present its first frames after launch.
const CAPTURE_START_TIMEOUT = 20_000;
const STALE_SAMPLE_TIMEOUT = 3_000;
const SWAP_CHAIN_STALE_TIMEOUT = 5_000;
// A unique ETW session name per capture run. A trace session outlives the
// process that created it, so a fixed name lets one leaked session block every
// later capture ("a trace session named ... is already running"). The bridge
// also stops this name, and the legacy fixed name, before starting.
const presentMonSessionName = (targetPid: number, runId: number) =>
  `GameHubOverlayPresentMon-${process.pid}-${targetPid}-${runId}`;
const PRESENTMON_SHA256 =
  "9bec3083069f58f911e6a512f4806db51a27bd096103087bc1d05ef54c80a191";
const PERMISSION_MESSAGE =
  "Approve the Windows administrator prompt so PresentMon can capture this game's frame data.";

type SwapChainSamples = {
  samples: number[];
  lastSeenAt: number;
  runtime: string | null;
  presentMode: string | null;
  application: string | null;
};

export class OverlayFpsMonitor {
  private lastUpdate = 0;
  private lastSampleAt = 0;
  private samples: number[] = [];
  private generation = 0;
  private linuxPoll: NodeJS.Timeout | null = null;
  private linuxDirectory: string | null = null;
  private linuxFile: string | null = null;
  private linuxOffset = 0;
  private linuxPending = "";
  private presentMonPath: string | null = null;
  private targetPid = 0;
  private targetExecutable: string | null = null;
  private captureWatchdog: NodeJS.Timeout | null = null;
  private stalePoll: NodeJS.Timeout | null = null;
  private captureDiagnosticLogged = false;
  private waitingForFreshSamples = false;
  private presentMonFilePoll: NodeJS.Timeout | null = null;
  private presentMonOutputFile: string | null = null;
  private presentMonDiagnosticFile: string | null = null;
  private presentMonFileOffset = 0;
  private presentMonFilePending = "";
  private presentMonColumns: ReturnType<
    typeof resolvePresentMonFrameTimeColumns
  > | null = null;
  private captureRunId = 0;
  private windowsLaunchQueue: Promise<void> = Promise.resolve();
  private swapChains = new Map<string, SwapChainSamples>();
  private activeSwapChain: string | null = null;
  private onUpdate: (metrics: HydraOverlayPerformance) => void = () =>
    undefined;

  public setUpdateHandler(handler: (metrics: HydraOverlayPerformance) => void) {
    this.onUpdate = handler;
  }

  public start(
    game: Game,
    targetPid = 0,
    targetExecutable: string | null = null
  ) {
    this.stop();
    const generation = this.generation;
    this.captureDiagnosticLogged = false;

    if (process.platform === "linux") {
      this.publishState("waiting", "Waiting for MangoHud frame samples…");
      this.startLinux(game, generation);
      return;
    }
    if (process.platform !== "win32") {
      this.publishState(
        "unavailable",
        "FPS capture is not available on this platform."
      );
      return;
    }

    const presentMonPath = app.isPackaged
      ? path.join(process.resourcesPath, "presentmon", "PresentMon.exe")
      : path.join(app.getAppPath(), "presentmon", "PresentMon.exe");
    if (!fs.existsSync(presentMonPath)) {
      logger.warn("PresentMon is unavailable; FPS overlay disabled");
      this.publishState(
        "unavailable",
        "PresentMon is missing from this GameHub installation."
      );
      return;
    }
    try {
      const digest = crypto
        .createHash("sha256")
        .update(fs.readFileSync(presentMonPath))
        .digest("hex");
      if (digest !== PRESENTMON_SHA256) {
        logger.error("PresentMon integrity verification failed", {
          expected: PRESENTMON_SHA256,
          received: digest,
        });
        this.publishState(
          "unavailable",
          "PresentMon failed its integrity check. Repair GameHub before enabling FPS capture."
        );
        return;
      }
    } catch (error) {
      logger.error("Could not verify PresentMon", error);
      this.publishState(
        "unavailable",
        "PresentMon could not be verified. Repair GameHub before enabling FPS capture."
      );
      return;
    }

    this.presentMonPath = presentMonPath;
    if (!targetPid) {
      this.publishState("waiting", "Waiting for the game render process…");
      return;
    }
    this.setTargetProcess(targetPid, targetExecutable);
  }

  public setTargetProcess(pid: number, executable: string | null = null) {
    if (process.platform !== "win32") return;

    const nextPid = Number.isInteger(pid) && pid > 0 ? pid : 0;
    const nextExecutable = executable || null;
    if (
      nextPid === this.targetPid &&
      nextExecutable === this.targetExecutable
    ) {
      return;
    }

    this.stopCaptureProcess();
    this.targetPid = nextPid;
    this.targetExecutable = nextExecutable;
    this.captureDiagnosticLogged = false;
    this.resetSamples();

    if (!this.presentMonPath) return;
    if (!this.targetPid) {
      this.publishState("waiting", "Waiting for the game render process…");
      return;
    }
    this.queueWindowsCapture(this.generation);
  }

  public stop() {
    this.generation += 1;
    this.stopCaptureProcess();
    if (this.linuxPoll) clearInterval(this.linuxPoll);
    this.linuxPoll = null;
    this.linuxDirectory = null;
    this.linuxFile = null;
    this.linuxOffset = 0;
    this.linuxPending = "";
    this.presentMonPath = null;
    this.targetPid = 0;
    this.targetExecutable = null;
    this.resetSamples();
    this.onUpdate(this.emptyMetrics());
  }

  private queueWindowsCapture(generation: number) {
    this.windowsLaunchQueue = this.windowsLaunchQueue
      .catch(() => undefined)
      .then(() => this.startWindowsCapture(generation))
      .catch((error) => {
        logger.error("Could not launch elevated PresentMon", error);
        if (generation === this.generation) {
          this.stopCaptureProcess();
          this.resetSamples();
          this.publishState(
            "error",
            "PresentMon could not start with administrator rights."
          );
        }
      });
  }

  private async startWindowsCapture(generation: number) {
    const presentMonPath = this.presentMonPath;
    const targetPid = this.targetPid;
    if (generation !== this.generation || !presentMonPath || !targetPid) {
      return;
    }

    this.stopCaptureProcess();
    this.resetSamples();
    this.publishState("waiting", "Starting PresentMon FPS capture…");

    const captureRunId = ++this.captureRunId;
    const outputDirectory = path.join(
      app.getPath("temp"),
      "GameHub",
      "presentmon"
    );
    try {
      fs.mkdirSync(outputDirectory, { recursive: true });
      this.removeStalePresentMonFiles(outputDirectory);
    } catch (error) {
      logger.error("Could not prepare PresentMon output directory", error);
      this.publishState(
        "error",
        "GameHub could not prepare temporary FPS capture files."
      );
      return;
    }
    const outputFile = path.join(
      outputDirectory,
      `frames-${process.pid}-${targetPid}-${generation}-${captureRunId}.csv`
    );
    const diagnosticFile = `${outputFile}.log`;
    try {
      fs.rmSync(outputFile, { force: true });
      fs.rmSync(diagnosticFile, { force: true });
    } catch {
      // A stale diagnostic file is harmless; PresentMon will truncate it.
    }
    this.presentMonOutputFile = outputFile;
    this.presentMonDiagnosticFile = diagnosticFile;
    this.presentMonFileOffset = 0;
    this.presentMonFilePending = "";
    this.presentMonColumns = null;

    // Keep Electron at normal integrity. The native launcher requests UAC only
    // for checksum-verified PresentMon and retains the resulting process handle
    // so preference changes, target changes, updates, and shutdown can stop it.
    const started = await NativeAddon.launchElevatedPresentMon(
      presentMonPath,
      outputFile,
      targetPid,
      presentMonSessionName(targetPid, captureRunId)
    );
    if (
      generation !== this.generation ||
      captureRunId !== this.captureRunId ||
      targetPid !== this.targetPid
    ) {
      if (started) NativeAddon.stopElevatedPresentMon();
      this.presentMonOutputFile = null;
      this.presentMonDiagnosticFile = null;
      this.removePresentMonFile(outputFile);
      this.removePresentMonFile(diagnosticFile);
      return;
    }
    logger.info("Elevated PresentMon launched", {
      pid: targetPid,
      executable: this.targetExecutable,
      session: presentMonSessionName(targetPid, captureRunId),
      started,
    });

    if (!started) {
      this.presentMonOutputFile = null;
      this.presentMonDiagnosticFile = null;
      this.removePresentMonFile(outputFile);
      this.removePresentMonFile(diagnosticFile);
      this.resetSamples();
      this.publishState("permission-required", PERMISSION_MESSAGE);
      logger.warn(
        "Elevated PresentMon FPS capture was not approved or could not start",
        {
          pid: targetPid,
          executable: this.targetExecutable,
        }
      );
      return;
    }

    this.presentMonFilePoll = setInterval(() => {
      if (
        generation !== this.generation ||
        captureRunId !== this.captureRunId
      ) {
        return;
      }
      this.readPresentMonOutputFile(outputFile, targetPid);
    }, 100);

    this.captureWatchdog = setTimeout(() => {
      if (
        captureRunId === this.captureRunId &&
        generation === this.generation &&
        this.lastSampleAt === 0
      ) {
        const diagnostic = this.readPresentMonDiagnostic(diagnosticFile);
        this.stopCaptureProcess();
        this.resetSamples();
        this.publishState(
          "error",
          diagnostic
            ? "PresentMon could not capture this game's frames. Check GameHub logs for the collector error."
            : "PresentMon started as administrator but this game did not expose frame samples."
        );
        logger.warn("Elevated PresentMon produced no frame samples", {
          pid: targetPid,
          executable: this.targetExecutable,
          diagnostic,
        });
      }
    }, CAPTURE_START_TIMEOUT);

    this.stalePoll = setInterval(() => {
      if (
        captureRunId !== this.captureRunId ||
        generation !== this.generation ||
        !this.lastSampleAt ||
        Date.now() - this.lastSampleAt <= STALE_SAMPLE_TIMEOUT ||
        this.waitingForFreshSamples
      ) {
        return;
      }
      this.waitingForFreshSamples = true;
      this.resetSamples(true);
      this.publishState("waiting", "Waiting for new frames from the game…");
    }, 1_000);
  }

  private readPresentMonOutputFile(outputFile: string, targetPid: number) {
    try {
      if (!fs.existsSync(outputFile)) return;
      const size = fs.statSync(outputFile).size;
      if (size < this.presentMonFileOffset) {
        this.presentMonFileOffset = 0;
        this.presentMonFilePending = "";
        this.presentMonColumns = null;
      }
      if (size === this.presentMonFileOffset) return;

      const length = size - this.presentMonFileOffset;
      const buffer = Buffer.alloc(length);
      const descriptor = fs.openSync(outputFile, "r");
      try {
        fs.readSync(descriptor, buffer, 0, length, this.presentMonFileOffset);
      } finally {
        fs.closeSync(descriptor);
      }
      this.presentMonFileOffset = size;
      this.consumePresentMonCsv(buffer.toString("utf8"), targetPid);
    } catch (error) {
      logger.debug("Waiting for elevated PresentMon CSV output", error);
    }
  }

  private consumePresentMonCsv(chunk: string, targetPid: number) {
    const lines = `${this.presentMonFilePending}${chunk}`.split(/\r?\n/u);
    this.presentMonFilePending = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const row = parseCsvRow(line.replace(/^\uFEFF/u, ""));
      if (!this.presentMonColumns) {
        const possibleHeader = resolvePresentMonFrameTimeColumns(row);
        if (isPresentMonFrameTimeHeader(possibleHeader)) {
          this.presentMonColumns = possibleHeader;
        }
        continue;
      }

      const sample = parsePresentMonSample(row, this.presentMonColumns);
      if (!sample) {
        const possibleHeader = resolvePresentMonFrameTimeColumns(row);
        if (isPresentMonFrameTimeHeader(possibleHeader)) {
          this.presentMonColumns = possibleHeader;
        }
        continue;
      }
      if (sample.processId !== null && sample.processId !== targetPid) continue;
      this.recordPresentMonSample(sample);
    }
  }

  private recordPresentMonSample(sample: PresentMonSample) {
    const now = Date.now();
    const swapChain = sample.swapChain ?? "default";
    const record = this.swapChains.get(swapChain) ?? {
      samples: [],
      lastSeenAt: 0,
      runtime: null,
      presentMode: null,
      application: null,
    };
    record.samples.push(sample.frameTimeMs);
    if (record.samples.length > MAX_SAMPLES) record.samples.shift();
    record.lastSeenAt = now;
    record.runtime = sample.runtime ?? record.runtime;
    record.presentMode = sample.presentMode ?? record.presentMode;
    record.application = sample.application ?? record.application;
    this.swapChains.set(swapChain, record);

    for (const [key, value] of this.swapChains) {
      if (
        key !== swapChain &&
        now - value.lastSeenAt > SWAP_CHAIN_STALE_TIMEOUT
      ) {
        this.swapChains.delete(key);
      }
    }

    const active = [...this.swapChains.entries()].sort(
      ([leftKey, left], [rightKey, right]) =>
        right.samples.length - left.samples.length ||
        Number(rightKey === this.activeSwapChain) -
          Number(leftKey === this.activeSwapChain) ||
        right.lastSeenAt - left.lastSeenAt
    )[0];
    if (!active) return;
    this.activeSwapChain = active[0];
    this.samples = active[1].samples;
    this.lastSampleAt = now;
    this.waitingForFreshSamples = false;
    if (this.captureWatchdog) {
      clearTimeout(this.captureWatchdog);
      this.captureWatchdog = null;
    }

    if (!this.captureDiagnosticLogged) {
      this.captureDiagnosticLogged = true;
      logger.info("PresentMon FPS capture active", {
        pid: this.targetPid,
        executable: this.targetExecutable,
        application: active[1].application,
        runtime: active[1].runtime,
        presentMode: active[1].presentMode,
      });
    }
    this.publishSamples(this.captureDescription(active[1]));
  }

  private captureDescription(record: SwapChainSamples) {
    return ["PresentMon", record.runtime, record.presentMode]
      .filter(Boolean)
      .join(" • ");
  }

  private startLinux(game: Game, generation: number) {
    this.linuxDirectory = getLinuxOverlayMetricsDirectory(game);
    if (!this.linuxDirectory) {
      logger.warn(
        "MangoHud was not active when this game launched; Linux FPS capture is unavailable"
      );
      this.publishState(
        "unavailable",
        "MangoHud was not active when this game launched."
      );
      return;
    }

    const poll = () => {
      if (generation !== this.generation) return;
      try {
        this.readLinuxMetrics();
        if (
          this.lastSampleAt &&
          Date.now() - this.lastSampleAt > STALE_SAMPLE_TIMEOUT &&
          !this.waitingForFreshSamples
        ) {
          this.waitingForFreshSamples = true;
          this.resetSamples(true);
          this.publishState("waiting", "Waiting for new MangoHud frames…");
        }
      } catch (error) {
        if (generation !== this.generation) return;
        this.linuxFile = null;
        this.linuxOffset = 0;
        this.linuxPending = "";
        logger.debug("Waiting for MangoHud performance output", error);
      }
    };
    poll();
    this.linuxPoll = setInterval(poll, UPDATE_INTERVAL);
  }

  private readLinuxMetrics() {
    const directory = this.linuxDirectory;
    if (!directory) return;

    if (!this.linuxFile) {
      const files = fs
        .readdirSync(directory, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.endsWith(".csv") &&
            !entry.name.endsWith("_summary.csv")
        )
        .map((entry) => path.join(directory, entry.name))
        .sort(
          (left, right) =>
            fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs
        );
      this.linuxFile = files[0] ?? null;
      if (!this.linuxFile) return;
    }

    const size = fs.statSync(this.linuxFile).size;
    if (size < this.linuxOffset) {
      this.linuxOffset = 0;
      this.linuxPending = "";
    }
    if (size === this.linuxOffset) return;

    const length = size - this.linuxOffset;
    const buffer = Buffer.alloc(length);
    const descriptor = fs.openSync(this.linuxFile, "r");
    try {
      fs.readSync(descriptor, buffer, 0, length, this.linuxOffset);
    } finally {
      fs.closeSync(descriptor);
    }
    this.linuxOffset = size;

    const lines = `${this.linuxPending}${buffer.toString("utf8")}`.split(
      /\r?\n/u
    );
    this.linuxPending = lines.pop() ?? "";
    const frameTimes = parseMangoHudFrameTimes(lines);
    for (const frameTime of frameTimes) {
      this.samples.push(frameTime);
      if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    }
    if (frameTimes.length) {
      this.lastSampleAt = Date.now();
      this.waitingForFreshSamples = false;
    }
    this.publishSamples("MangoHud");
  }

  private publishSamples(captureMessage: string) {
    if (!this.samples.length) return;
    const now = Date.now();
    if (now - this.lastUpdate < UPDATE_INTERVAL) return;
    this.lastUpdate = now;
    const metrics = calculateOverlayPerformance(this.samples, now);
    if (metrics) {
      this.onUpdate({
        ...metrics,
        captureStatus: "capturing",
        captureMessage,
      });
    }
  }

  private publishState(
    captureStatus: NonNullable<HydraOverlayPerformance["captureStatus"]>,
    captureMessage: string
  ) {
    this.onUpdate(this.emptyMetrics(captureStatus, captureMessage));
  }

  private resetSamples(preserveLastSampleAt = false) {
    this.samples = [];
    this.swapChains.clear();
    this.activeSwapChain = null;
    this.lastUpdate = 0;
    if (!preserveLastSampleAt) {
      this.lastSampleAt = 0;
      this.waitingForFreshSamples = false;
    }
  }

  private stopCaptureProcess() {
    if (this.captureWatchdog) clearTimeout(this.captureWatchdog);
    if (this.stalePoll) clearInterval(this.stalePoll);
    this.captureWatchdog = null;
    this.stalePoll = null;
    if (this.presentMonFilePoll) clearInterval(this.presentMonFilePoll);
    this.presentMonFilePoll = null;
    this.presentMonFileOffset = 0;
    this.presentMonFilePending = "";
    this.presentMonColumns = null;
    this.captureRunId += 1;
    NativeAddon.stopElevatedPresentMon();
    const outputFile = this.presentMonOutputFile;
    const diagnosticFile = this.presentMonDiagnosticFile;
    this.presentMonOutputFile = null;
    this.presentMonDiagnosticFile = null;
    if (outputFile) this.removePresentMonFile(outputFile);
    if (diagnosticFile) this.removePresentMonFile(diagnosticFile);
  }

  private readPresentMonDiagnostic(diagnosticFile: string) {
    try {
      if (!fs.existsSync(diagnosticFile)) return null;
      const buffer = fs.readFileSync(diagnosticFile);
      if (!buffer.length) return null;

      // PresentMon writes its console diagnostics as UTF-16LE (with or without
      // a BOM). Decoding those bytes as UTF-8 produces a NUL between every
      // character, which made the collector error unreadable in the logs.
      const hasUtf16Bom =
        buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe;
      const looksUtf16 =
        hasUtf16Bom ||
        (buffer.length >= 4 &&
          buffer[1] === 0x00 &&
          buffer[3] === 0x00 &&
          buffer[0] !== 0x00);
      const decoded = looksUtf16
        ? buffer.subarray(hasUtf16Bom ? 2 : 0).toString("utf16le")
        : buffer.toString("utf8");

      // Drop any stray NULs left by a mis-detected encoding.
      const diagnostic = decoded.split("\u0000").join("").trim();
      return diagnostic ? diagnostic.slice(-4_000) : null;
    } catch {
      return null;
    }
  }

  private removePresentMonFile(outputFile: string, attempt = 0) {
    void fs.promises.rm(outputFile, { force: true }).catch(() => {
      if (attempt >= 5) return;
      const retry = setTimeout(
        () => this.removePresentMonFile(outputFile, attempt + 1),
        1_000 * 2 ** attempt
      );
      retry.unref();
    });
  }

  private removeStalePresentMonFiles(outputDirectory: string) {
    const staleBefore = Date.now() - 24 * 60 * 60 * 1_000;
    for (const entry of fs.readdirSync(outputDirectory, {
      withFileTypes: true,
    })) {
      if (
        !entry.isFile() ||
        !entry.name.startsWith("frames-") ||
        ![".csv", ".csv.log", ".csv.stop"].some((extension) =>
          entry.name.endsWith(extension)
        )
      ) {
        continue;
      }
      const outputFile = path.join(outputDirectory, entry.name);
      try {
        const isFromThisProcess = entry.name.startsWith(
          `frames-${process.pid}-`
        );
        if (
          isFromThisProcess ||
          fs.statSync(outputFile).mtimeMs < staleBefore
        ) {
          fs.rmSync(outputFile, { force: true });
        }
      } catch {
        // A still-running collector may briefly retain its output file.
      }
    }
  }

  private emptyMetrics(
    captureStatus?: HydraOverlayPerformance["captureStatus"],
    captureMessage?: string
  ): HydraOverlayPerformance {
    return {
      fps: null,
      averageFps: null,
      onePercentLow: null,
      frameTimeMs: null,
      updatedAt: Date.now(),
      ...(captureStatus ? { captureStatus } : {}),
      ...(captureMessage ? { captureMessage } : {}),
    };
  }
}

export const overlayFpsMonitor = new OverlayFpsMonitor();
