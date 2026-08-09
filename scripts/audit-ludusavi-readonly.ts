import fs from "node:fs";
import path from "node:path";

import {
  discoverLudusaviMappingFolders,
  loadVerifiedLudusaviBackup,
  scanLudusaviBackupRoot,
} from "../src/main/services/cloud-save/ludusavi-import-plan";

const backupRoot = process.env.GAMEHUB_LUDUSAVI_BACKUPS;
if (!backupRoot) {
  throw new Error("Set GAMEHUB_LUDUSAVI_BACKUPS to the backup root.");
}

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(
  repositoryRoot,
  "artifacts",
  "ludusavi",
  "live-readonly-report.json"
);
const folders = discoverLudusaviMappingFolders(backupRoot);
const summaries = scanLudusaviBackupRoot(backupRoot, []);
const summaryByFolder = new Map(
  summaries.map((summary) => [path.resolve(summary.folderPath), summary])
);
const results: Array<{
  folder: string;
  gameName: string | null;
  capturedAt: string | null;
  fileCount: number;
  totalSizeBytes: number;
  verified: boolean;
  error: string | null;
}> = [];

for (const folder of folders) {
  const summary = summaryByFolder.get(path.resolve(folder));
  try {
    const verified = await loadVerifiedLudusaviBackup(folder);
    results.push({
      folder: path.relative(backupRoot, folder),
      gameName: verified.gameName,
      capturedAt: verified.capturedAt,
      fileCount: verified.files.length,
      totalSizeBytes: verified.files.reduce(
        (total, file) => total + file.sizeBytes,
        0
      ),
      verified: true,
      error: null,
    });
  } catch (error) {
    results.push({
      folder: path.relative(backupRoot, folder),
      gameName: summary?.gameName ?? null,
      capturedAt: summary?.capturedAt ?? null,
      fileCount: summary?.fileCount ?? 0,
      totalSizeBytes: summary?.totalSizeBytes ?? 0,
      verified: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const report = {
  scannedAt: new Date().toISOString(),
  discovered: folders.length,
  verified: results.filter((result) => result.verified).length,
  failed: results.filter((result) => !result.verified).length,
  files: results.reduce((total, result) => total + result.fileCount, 0),
  totalSizeBytes: results.reduce(
    (total, result) => total + result.totalSizeBytes,
    0
  ),
  results,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, outputPath }, null, 2));
