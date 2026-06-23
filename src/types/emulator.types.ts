export type EmulatorSystem = "ps1" | "ps2" | "ps3";

export type EmulatorBinary = "duckstation" | "pcsx2" | "rpcs3";

export interface RomFolder {
  id: string;
  path: string;
  scanSubfolders: boolean;
  fileCount: number;
  sizeBytes: number;
  lastScanAt: number | null;
}

export interface EmulatorConfig {
  system: EmulatorSystem;
  binary: EmulatorBinary;
  executablePath: string | null;
  detectedVersion: string | null;
  detectedAt: number | null;
  romFolders: RomFolder[];
  lastScanAt: number | null;
  totalFiles: number;
  totalSizeBytes: number;
}

export type EmulatorConfigMap = Record<EmulatorSystem, EmulatorConfig>;

export interface DetectedRom {
  objectId: string;
  title: string;
  libraryImageUrl: string | null;
  iconUrl: string | null;
  sizeBytes: number | null;
  skus: string[];
}

export interface ClassicsDisc {
  path: string;
  label: string;
  fileName: string;
  sku?: string | null;
}

export interface Ps2MemoryCardSaveRecord {
  cardFilePath: string;
  cardLabel: string;
  folderName: string;
  sku: string | null;
  objectId: string | null;
  shop: "launchbox" | null;
  title: string | null;
  iconUrl: string | null;
  libraryImageUrl: string | null;
  libraryHeroImageUrl: string | null;
  logoImageUrl: string | null;
  fileCount: number;
  sizeBytes: number;
  createdAt: number;
  modifiedAt: number;
  detectedAt: number;
}

export interface Ps2MemcardScanInput {
  autoDetect: boolean;
  manualPaths?: string[];
}

export type Ps2MemcardScanProgress =
  | {
      type: "scan_progress";
      processed: number;
      total: number;
      currentCard: string | null;
    }
  | {
      type: "match_progress";
      processed: number;
      total: number;
      currentSave: string;
      status: "matched" | "unmatched";
      matched: number;
      unmatched: number;
    }
  | {
      type: "done";
      cardCount: number;
      saveCount: number;
      matched: number;
      unmatched: number;
    }
  | { type: "cancelled"; cardCount: number; saveCount: number }
  | { type: "error"; message: string };

export interface Ps2ExportResult {
  ok: boolean;
  location?: string;
  sizeBytes?: number;
  error?: string;
}

export type MemoryCardSaveRecord = Ps2MemoryCardSaveRecord;
export type MemcardScanInput = Ps2MemcardScanInput;
export type MemcardScanProgress = Ps2MemcardScanProgress;
export type MemcardExportResult = Ps2ExportResult;

export type EmulationSavePlatform = "ps1" | "ps2";
export type EmulationSaveEmulator = "duckstation" | "pcsx2";

export interface EmulationBackupProgress {
  platform: EmulationSavePlatform;
  cardFilePath: string;
  processed: number;
  uploaded: number;
  failed: number;
  total: number;
  currentLabel: string | null;
}

export interface EmulationCloudSave {
  id: string;
  platform: EmulationSavePlatform;
  emulator: EmulationSaveEmulator;
  saveKind: "game_save";
  saveIdentity: string;
  artifactLengthInBytes: number;
  fileName: string;
  hostname: string | null;
  localLastModifiedAt: string | null;
  label: string | null;
  metadata: Record<string, unknown> | null;
  shop: "launchbox" | "steam" | null;
  objectId: string | null;
  lastUploadedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemcardRestoreResult {
  ok: boolean;
  error?: string;
}

export interface MemcardRestoreTarget {
  cardFilePath: string;
  cardLabel: string;
}

export type EmulatorInstallKind =
  | "windows-installer"
  | "linux-appimage"
  | "windows-archive"
  | "link";

export type EmulatorInstallChannel = "release" | "prerelease";

export type EmulatorInstallLinkKind = "aur" | "flatpak" | "release_page";

export interface ResolvedInstallOption {
  id: string;
  binary: EmulatorBinary;
  kind: EmulatorInstallKind;
  channel: EmulatorInstallChannel | null;
  downloadUrl: string | null;
  fileName: string | null;
  version: string | null;
  htmlUrl: string | null;
  linkUrl: string | null;
  linkKind: EmulatorInstallLinkKind | null;
}

export type EmulatorInstallPhase =
  | "downloading"
  | "extracting"
  | "running"
  | "done"
  | "error";

export interface EmulatorInstallProgress {
  binary: EmulatorBinary;
  optionId: string;
  phase: EmulatorInstallPhase;
  loaded?: number;
  total?: number;
  reason?: string;
  path?: string;
}

export interface EmulatorInstallResult {
  ok: boolean;
  path?: string;
  reason?: string;
}
