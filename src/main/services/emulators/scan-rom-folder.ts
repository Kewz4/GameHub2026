import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { EmulatorSystem } from "@types";
import { KNOWN_BINARIES } from "./known-binaries";
import { parseCueReferencedFiles, resolveSniffTarget, sniffDiscImage } from "./sniff-disc-platform";

export interface ScannedGame {
  primaryPath: string;
  name: string;
  sizeBytes: number;
  wrongPlatform: boolean;
}

export interface ScanResult {
  fileCount: number;
  sizeBytes: number;
  games: ScannedGame[];
}

export interface ScanProgress {
  processed: number;
  total: number;
  currentFile: string | null;
  kept: number;
}

export interface ScanOptions {
  onProgress?: (p: ScanProgress) => void;
  signal?: { cancelled: boolean };
  scanSubfolders?: boolean;
}

const collectFiles = (
  dir: string,
  extensions: Set<string>,
  recursive: boolean
): string[] => {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && recursive) {
        results.push(...collectFiles(full, extensions, recursive));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.has(ext)) results.push(full);
      }
    }
  } catch {
    // ignore permission errors
  }
  return results;
};

export const scanRomFolder = async (
  folderPath: string,
  system: EmulatorSystem,
  options: ScanOptions = {}
): Promise<ScanResult> => {
  const { onProgress, signal, scanSubfolders = true } = options;
  const binary = KNOWN_BINARIES[system];
  const extensions = new Set(binary.romExtensions);

  const files = collectFiles(folderPath, extensions, scanSubfolders);
  const games: ScannedGame[] = [];
  let totalSize = 0;
  const sidecars = new Set<string>();

  for (let i = 0; i < files.length; i++) {
    if (signal?.cancelled) break;
    const filePath = files[i];
    if (sidecars.has(filePath)) continue;

    onProgress?.({
      processed: i + 1,
      total: files.length,
      currentFile: filePath,
      kept: games.length,
    });

    let size = 0;
    try {
      size = statSync(filePath).size;
    } catch {
      // ignore
    }

    const sniffTarget = await resolveSniffTarget(filePath);
    if (sniffTarget && (system === "ps1" || system === "ps2")) {
      const platform = await sniffDiscImage(sniffTarget);
      if (platform !== "unknown" && platform !== system) {
        games.push({
          primaryPath: filePath,
          name: path.basename(filePath),
          sizeBytes: size,
          wrongPlatform: true,
        });
        totalSize += size;
        continue;
      }
    }

    if (filePath.toLowerCase().endsWith(".cue")) {
      const refs = await parseCueReferencedFiles(filePath);
      for (const ref of refs) sidecars.add(ref);
    }

    games.push({
      primaryPath: filePath,
      name: path.basename(filePath, path.extname(filePath)),
      sizeBytes: size,
      wrongPlatform: false,
    });
    totalSize += size;
  }

  return { fileCount: files.length, sizeBytes: totalSize, games };
};

export const countRomGroups = (result: ScanResult): number =>
  result.games.filter((g) => !g.wrongPlatform).length;
