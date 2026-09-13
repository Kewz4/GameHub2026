import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { findExecutableOnPath, installLauncherBinary } from "./launcher-binary";
import { SystemPath } from "./system-path";
import { logger } from "./logger";
import { getLauncherInvocation } from "./launcher-invocation";

// This is GOG's public OAuth2 client ID — hardcoded in heroic-gogdl
const GOG_CLIENT_ID = "46899977096215655";

export const getGogdlInstallPath = (): string => {
  const binDir = path.join(SystemPath.getPath("userData"), "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const ext = process.platform === "win32" ? ".exe" : "";
  return path.join(binDir, `gogdl${ext}`);
};

export const findGogdlBinary = (customPath?: string | null): string | null => {
  if (customPath && fs.existsSync(customPath)) return customPath;
  const ext = process.platform === "win32" ? ".exe" : "";
  const resourcesBin = path.join(process.resourcesPath ?? "", "bin");
  const execAdjacentBin = path.join(
    path.dirname(process.execPath ?? ""),
    "resources",
    "bin"
  );
  for (const dir of [
    resourcesBin,
    execAdjacentBin,
    path.join(__dirname, "..", "..", "binaries", "bin"),
  ]) {
    const candidate = path.join(dir, `gogdl${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  const installPath = getGogdlInstallPath();
  if (fs.existsSync(installPath)) return installPath;
  return findExecutableOnPath("gogdl");
};

export const downloadGogdl = async (
  onProgress?: (pct: number) => void
): Promise<string> => {
  const destination = await installLauncherBinary(
    "gogdl",
    getGogdlInstallPath(),
    onProgress
  );
  logger.log(`gogdl downloaded to ${destination}`);
  return destination;
};

/**
 * Write the auth config file that heroic-gogdl expects.
 *
 * heroic-gogdl reads --auth-config-path as a JSON file whose top-level keys
 * are GOG OAuth2 client IDs. The entry for the public client ID must contain
 * access_token, refresh_token, expires_in, and loginTime (unix seconds).
 *
 * Returns the path to the written auth file.
 */
export const writeGogdlAuthConfig = (
  accessToken: string,
  refreshToken: string
): string => {
  const configDir = path.join(SystemPath.getPath("userData"), "gogdl-config");
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(configDir, 0o700);
  const authPath = path.join(configDir, "auth.json");

  const config = {
    [GOG_CLIENT_ID]: {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      loginTime: Math.floor(Date.now() / 1000),
    },
  };

  fs.writeFileSync(authPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  if (process.platform !== "win32") fs.chmodSync(authPath, 0o600);
  return authPath;
};

function parseEtaToMs(eta: string): number {
  const parts = eta.split(":").map(Number);
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return (h * 3600 + m * 60 + s) * 1000;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return (m * 60 + s) * 1000;
  }
  return 0;
}

export function spawnGogdlInstall(
  gameId: string,
  downloadPath: string,
  accessToken: string,
  refreshToken: string,
  binaryPath: string | null | undefined,
  onProgress: (
    progress: number,
    downloadedMB: number,
    totalMB: number,
    speedMBs: number,
    etaMs: number
  ) => void,
  onComplete: () => void,
  onError: (err: string) => void,
  onLog?: (line: string, isError: boolean) => void
): () => void {
  const binary = findGogdlBinary(binaryPath);
  if (!binary) {
    onError("gogdl binary not found");
    return () => {};
  }

  let invocation: ReturnType<typeof getLauncherInvocation>;
  try {
    const authConfigPath = writeGogdlAuthConfig(accessToken, refreshToken);
    invocation = getLauncherInvocation(
      binary,
      [
        "--auth-config-path",
        authConfigPath,
        "download",
        gameId,
        "--platform",
        "windows",
        "--path",
        downloadPath,
        "--skip-dlcs",
        "--max-workers",
        "4",
      ],
      { ...process.env, PYTHONUNBUFFERED: "1" }
    );
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error));
    return () => {};
  }
  const child = spawn(invocation.command, invocation.args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: invocation.env,
  });

  // heroic-gogdl emits human-readable progress lines, for example:
  //   [PROGRESS] INFO: = Progress: 0.61 52428800/8550960053, Running for: 00:00:13, ETA: 00:36:14
  //   [PROGRESS] INFO: = Downloaded: 24.80 MiB, Written: 50.00 MiB
  //   [PROGRESS] INFO:  + Download	- 4.19 MiB/s (raw) / 9.92 MiB/s (decompressed)
  //   [PROGRESS] INFO:  + Disk	- 7.63 MiB/s (write) / 0.00 MiB/s (read)
  // Note: the percentage is a decimal like "0.61" (= 0.61%), bytes are written/total.
  // Completion is signalled by a clean exit (code 0).

  let completed = false;
  let lastSpeedMBs = 0;
  let lastEtaMs = 0;
  let lastPct = 0;
  let lastWrittenBytes = 0;
  let lastTotalBytes = 0;

  const handleLine = (line: string, isStderr = false) => {
    if (!line.trim()) return;
    logger.log(`[gogdl] ${line}`);
    onLog?.(line, isStderr);
    if (completed) return;

    // Progress line: "Progress: 0.61 52428800/8550960053, Running for: 00:00:13, ETA: 00:36:14"
    // pct is a percentage value (0.61 = 0.61%), followed by writtenBytes/totalBytes
    const progressMatch = line.match(
      /Progress:\s+(\d+\.?\d*)\s+(\d+)\/(\d+),.*ETA:\s+([\d:]+)/
    );
    if (progressMatch) {
      lastPct = parseFloat(progressMatch[1]) / 100;
      lastWrittenBytes = parseFloat(progressMatch[2]);
      lastTotalBytes = parseFloat(progressMatch[3]);
      lastEtaMs = parseEtaToMs(progressMatch[4]);
      const writtenMB = lastWrittenBytes / (1024 * 1024);
      const totalMB = lastTotalBytes / (1024 * 1024);
      onProgress(lastPct, writtenMB, totalMB, lastSpeedMBs, lastEtaMs);
      return;
    }

    // Speed line: "Download	- 4.19 MiB/s (raw) / ..."
    const speedMatch = line.match(/Download\s+-\s+(\d+\.?\d*)\s+MiB\/s/);
    if (speedMatch) {
      lastSpeedMBs = parseFloat(speedMatch[1]);
      if (lastTotalBytes > 0) {
        onProgress(
          lastPct,
          lastWrittenBytes / (1024 * 1024),
          lastTotalBytes / (1024 * 1024),
          lastSpeedMBs,
          lastEtaMs
        );
      }
      return;
    }
  };

  const splitLines = (buf: string): [string[], string] => {
    const parts = buf.split(/\r\n|\r|\n/);
    const remaining = parts.pop() ?? "";
    return [parts, remaining];
  };

  let stdoutBuf = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    const [lines, rest] = splitLines(stdoutBuf);
    stdoutBuf = rest;
    for (const line of lines) handleLine(line, false);
  });

  let stderrBuf = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    const [lines, rest] = splitLines(stderrBuf);
    stderrBuf = rest;
    for (const line of lines) handleLine(line, true);
  });

  let killIntentional = false;

  child.on("error", (err) => {
    if (!killIntentional) onError(err.message);
  });

  child.on("close", (code) => {
    if (killIntentional) return;

    // Flush any remaining buffered output
    if (stderrBuf.trim()) handleLine(stderrBuf, true);
    if (stdoutBuf.trim()) handleLine(stdoutBuf, false);

    if (completed) return;

    if (code === 0) {
      // Clean exit = success
      completed = true;
      onComplete();
    } else if (code !== null) {
      onError(`gogdl exited with code ${code}`);
    }
  });

  return () => {
    try {
      killIntentional = true;
      if (process.platform === "win32" && child.pid) {
        require("node:child_process").execSync(
          `taskkill /F /T /PID ${child.pid}`,
          { stdio: "ignore" }
        );
      } else {
        child.kill("SIGKILL");
      }
    } catch {
      // intentional
    }
  };
}
