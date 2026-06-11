import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import axios from "axios";
import { SystemPath } from "./system-path";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

export interface LegendaryGame {
  app_name: string;
  app_title: string;
  is_installed: boolean;
  install_path?: string;
  key_images?: { type: string; url: string }[];
  // playtime in minutes as reported by Epic's servers (present when legendary is authenticated)
  playtime?: number;
}

export interface LegendaryStatus {
  account: string | null;
  authenticated: boolean;
}

const getPlatformSearchPaths = (): string[] => {
  const userData = SystemPath.getPath("userData");
  const binDir = path.join(userData, "bin");
  // Bundled: try both resourcesPath and exe-adjacent resources (for portable builds)
  const resourcesBin = path.join(process.resourcesPath ?? "", "bin");
  const execAdjacentBin = path.join(
    path.dirname(process.execPath ?? ""),
    "resources",
    "bin"
  );

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? "";
    return [
      path.join(resourcesBin, "legendary.exe"),
      path.join(execAdjacentBin, "legendary.exe"),
      path.join(binDir, "legendary.exe"),
      path.join(localAppData, "Programs", "legendary", "legendary.exe"),
      path.join(localAppData, "legendary", "legendary.exe"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      path.join(resourcesBin, "legendary"),
      path.join(execAdjacentBin, "legendary"),
      path.join(binDir, "legendary"),
      "/usr/local/bin/legendary",
      "/opt/homebrew/bin/legendary",
      path.join(SystemPath.getPath("home"), ".local", "bin", "legendary"),
    ];
  }
  return [
    path.join(resourcesBin, "legendary"),
    path.join(execAdjacentBin, "legendary"),
    path.join(binDir, "legendary"),
    path.join(SystemPath.getPath("home"), ".local", "bin", "legendary"),
    "/usr/bin/legendary",
    "/usr/local/bin/legendary",
  ];
};

export const getLegendaryInstallPath = (): string => {
  const binDir = path.join(SystemPath.getPath("userData"), "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const ext = process.platform === "win32" ? ".exe" : "";
  return path.join(binDir, `legendary${ext}`);
};

export const findLegendaryBinary = (
  customPath?: string | null
): string | null => {
  if (customPath && fs.existsSync(customPath)) return customPath;

  for (const candidate of getPlatformSearchPaths()) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // intentional
    }
  }

  // Try PATH via which/where
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const { stdout } = require("node:child_process").execSync(
      `${whichCmd} legendary`,
      { encoding: "utf8", timeout: 3000 }
    );
    const bin = stdout.trim().split("\n")[0].trim();
    if (bin && fs.existsSync(bin)) return bin;
  } catch {
    // intentional
  }

  return null;
};

const runLegendary = async (
  binary: string,
  args: string[]
): Promise<string> => {
  const { stdout } = await execFileAsync(binary, args, {
    timeout: 60_000,
    env: legendaryEnv(),
  });
  return stdout;
};

export const getLegendaryStatus = async (
  binaryPath?: string | null
): Promise<LegendaryStatus> => {
  const binary = findLegendaryBinary(binaryPath);
  if (!binary) return { account: null, authenticated: false };

  try {
    const output = await runLegendary(binary, [
      ...legendaryBaseArgs(),
      "status",
      "--json",
    ]);
    const data = JSON.parse(output);
    return {
      account: data.account ?? null,
      authenticated: Boolean(data.account),
    };
  } catch (err) {
    logger.error("legendary status failed", err);
    return { account: null, authenticated: false };
  }
};

export const getLegendaryGames = async (
  binaryPath?: string | null
): Promise<LegendaryGame[]> => {
  const binary = findLegendaryBinary(binaryPath);
  if (!binary) throw new Error("legendary binary not found");

  const output = await runLegendary(binary, [
    ...legendaryBaseArgs(),
    "list",
    "--json",
    "--force-refresh",
  ]);
  const data = JSON.parse(output);

  if (!Array.isArray(data))
    throw new Error("Unexpected legendary output format");

  return data as LegendaryGame[];
};

export const getLegendaryConfigPath = (): string => {
  const configPath = path.join(
    SystemPath.getPath("userData"),
    "legendary-config"
  );
  fs.mkdirSync(configPath, { recursive: true });
  return configPath;
};

export const getLegendaryInstalledExePath = (
  appName: string
): string | null => {
  try {
    const installedJson = path.join(getLegendaryConfigPath(), "installed.json");
    if (!fs.existsSync(installedJson)) return null;
    const installed = JSON.parse(fs.readFileSync(installedJson, "utf8"));
    const entry = installed[appName];
    if (!entry?.install_path || !entry?.executable) return null;
    const exePath = path.join(entry.install_path, entry.executable);
    return fs.existsSync(exePath) ? exePath : null;
  } catch {
    return null;
  }
};

const legendaryBaseArgs = (): string[] => [];

const legendaryEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  LEGENDARY_CONFIG_PATH: getLegendaryConfigPath(),
});

export const authenticateLegendary = async (
  code: string,
  binaryPath?: string | null
): Promise<void> => {
  const binary = findLegendaryBinary(binaryPath);
  if (!binary) throw new Error("legendary binary not found");

  await execFileAsync(
    binary,
    [...legendaryBaseArgs(), "auth", "--code", code.trim()],
    { timeout: 30_000, env: legendaryEnv() }
  );
};

export const getLegendaryGameCoverUrl = (
  game: LegendaryGame
): string | null => {
  if (!game.key_images?.length) return null;
  const priority = [
    "DieselGameBoxTall",
    "DieselGameBox",
    "Thumbnail",
    "DieselGameBoxWide",
  ];
  for (const type of priority) {
    const img = game.key_images.find((k) => k.type === type);
    if (img) return img.url;
  }
  return game.key_images[0]?.url ?? null;
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

export function spawnLegendaryInstall(
  appName: string,
  downloadPath: string,
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
  const binary = findLegendaryBinary(binaryPath);
  if (!binary) {
    onError("Legendary binary not found");
    return () => {};
  }

  const child = spawn(
    binary,
    [
      ...legendaryBaseArgs(),
      "install",
      appName,
      "--base-path",
      downloadPath,
      "--yes",
      "--skip-sdl",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: legendaryEnv(),
    }
  );

  // Legendary actual output format (from DLManager):
  //   [DLManager] INFO: = Progress: 4.52% (55/1218), Running for 00:00:13, ETA: 00:04:38
  //   [DLManager] INFO: - Downloaded: 14.41 MiB, Written: 25.22 MiB
  //   [DLManager] INFO: - 0.55 MiB/s (raw) / 1.97 MiB/s (decompressed)
  //   [DLManager] INFO: - 0.00 MiB/s (write) / 0.00 MiB/s (read)
  // Completion: process exits with code 0.
  const progressPctRegex = /Progress:\s+(\d+\.?\d*)%.*ETA:\s+([\d:]+)/;
  const writtenRegex =
    /Downloaded:\s+(\d+\.?\d*)\s+MiB.*Written:\s+(\d+\.?\d*)\s+MiB/;
  const speedRegex = /(\d+\.?\d*)\s+MiB\/s\s*\(raw\)/;

  let lastPct = 0;
  let lastWrittenMB = 0;
  let lastDownloadedMB = 0;
  let lastSpeedMBs = 0;
  let lastEtaMs = 0;
  let completed = false;
  let killIntentional = false;

  const handleLine = (line: string, isStderr: boolean) => {
    if (!line.trim()) return;
    onLog?.(line, isStderr);
    if (completed) return;

    const pctMatch = line.match(progressPctRegex);
    if (pctMatch) {
      lastPct = parseFloat(pctMatch[1]) / 100;
      lastEtaMs = parseEtaToMs(pctMatch[2]);
      return;
    }

    const speedMatch = line.match(speedRegex);
    if (speedMatch) {
      lastSpeedMBs = parseFloat(speedMatch[1]);
      return;
    }

    const writtenMatch = line.match(writtenRegex);
    if (writtenMatch) {
      lastDownloadedMB = parseFloat(writtenMatch[1]);
      lastWrittenMB = parseFloat(writtenMatch[2]);
      // written = decompressed bytes on disk; use pct to derive total
      const totalMB = lastPct > 0 ? lastWrittenMB / lastPct : 0;
      onProgress(lastPct, lastDownloadedMB, totalMB, lastSpeedMBs, lastEtaMs);
      return;
    }
  };

  let stdoutBuffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line, false);
  });

  let stderrBuffer = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line, true);
  });

  child.on("error", (err) => {
    if (!killIntentional) onError(err.message);
  });

  child.on("close", (code) => {
    if (killIntentional) return;
    if (stderrBuffer.trim()) handleLine(stderrBuffer, true);
    if (stdoutBuffer.trim()) handleLine(stdoutBuffer, false);
    if (!completed) {
      if (code === 0) {
        completed = true;
        onComplete();
      } else if (code !== null) {
        onError(`Legendary exited with code ${code}`);
      }
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

interface GitHubRelease {
  assets: { name: string; browser_download_url: string }[];
}

export const downloadLegendary = async (
  onProgress?: (pct: number) => void
): Promise<string> => {
  const response = await axios.get<GitHubRelease>(
    "https://api.github.com/repos/legendary-gl/legendary/releases/latest",
    { headers: { Accept: "application/vnd.github+json" } }
  );

  const assets = response.data.assets;
  let assetName: string;

  if (process.platform === "win32") {
    assetName = "legendary.exe";
  } else if (process.platform === "darwin") {
    assetName = "legendary_macos";
  } else {
    assetName = "legendary_linux_x86_64";
  }

  const asset =
    assets.find((a) => a.name === assetName) ??
    assets.find(
      (a) => a.name.includes("legendary") && !a.name.endsWith(".tar.gz")
    );

  if (!asset)
    throw new Error(`No legendary binary found for ${process.platform}`);

  const destPath = getLegendaryInstallPath();

  const downloadResponse = await axios.get<ArrayBuffer>(
    asset.browser_download_url,
    {
      responseType: "arraybuffer",
      onDownloadProgress: (evt) => {
        if (evt.total && onProgress)
          onProgress(Math.round((evt.loaded / evt.total) * 100));
      },
    }
  );

  fs.writeFileSync(destPath, Buffer.from(downloadResponse.data));

  if (process.platform !== "win32") {
    fs.chmodSync(destPath, 0o755);
  }

  logger.log(`legendary downloaded to ${destPath}`);
  return destPath;
};
