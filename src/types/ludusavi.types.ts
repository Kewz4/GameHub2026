export interface LudusaviScanChange {
  change: "New" | "Different" | "Removed" | "Same" | "Unknown";
  decision: "Processed" | "Cancelled" | "Ignore";
  bytes: number;
}

export interface LudusaviGame extends LudusaviScanChange {
  files: Record<string, LudusaviScanChange>;
}

export interface LudusaviBackup {
  overall: {
    totalGames: number;
    totalBytes: number;
    processedGames: number;
    processedBytes: number;
    changedGames: {
      new: number;
      different: number;
      same: number;
    };
  };
  games: Record<string, LudusaviGame>;

  // Custom path for the backup, extracted from the config
  customBackupPath?: string | null;
  mappingSource?: "manual" | "emulator" | "pc" | "manifest";
  mappingError?: string | null;
  mappingWarning?: string | null;
  resolvedPaths?: string[];
}

export interface LudusaviCustomGame {
  name: string;
  files: string[];
  registry: string[];
}

export interface LudusaviConfig {
  manifest: {
    enable: boolean;
    secondary: {
      url: string;
      enable: boolean;
    }[];
  };
  customGames: LudusaviCustomGame[];
}

export interface LudusaviBackupMapping {
  files: {
    [key: string]: {
      hash: string;
      size: number;
    };
  };
  registry?: {
    hash?: string;
  } | null;
}

export interface LudusaviBackupLibraryTarget {
  shop: import("./game.types").GameShop;
  objectId: string;
  title: string;
}

export interface LudusaviBackupScanEntry {
  gameName: string;
  folderPath: string;
  mappingPath: string;
  hasMappingYaml: true;
  capturedAt: string;
  fileCount: number;
  totalSizeBytes: number;
  suggestedGame: LudusaviBackupLibraryTarget | null;
  matchReason: "gamehub-id" | "backup-folder-id" | "exact-title" | null;
}

export type LudusaviImportResult =
  | {
      ok: false;
      status: "preview";
      currentSnapshotId: string | null;
      currentVersion: number;
      wouldReplace: boolean;
      aggregateHash: string;
      fileCount: number;
      totalSizeBytes: number;
    }
  | {
      ok: true;
      status: "imported" | "already-current";
      snapshotId: string;
      version: number;
      fileCount: number;
      totalSizeBytes: number;
    }
  | {
      ok: false;
      status: "confirmation-required";
      expectedSnapshotId: string;
      currentVersion: number;
      fileCount: number;
      totalSizeBytes: number;
    };
