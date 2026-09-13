export type EmulatorSystem =
  | "ps1"
  | "ps2"
  | "ps3"
  | "psp"
  | "n3ds"
  | "nds"
  | "dsi"
  | "n64"
  | "gb"
  | "gbc"
  | "gba"
  | "wiiu"
  | "wii"
  | "gc"
  | "switch";

export type EmulatorBinary =
  | "duckstation"
  | "pcsx2"
  | "rpcs3"
  | "ppsspp"
  | "azahar"
  | "ralibretro"
  | "raproject64"
  | "ravba"
  | "cemu"
  | "dolphin"
  | "eden";

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

/**
 * The standard logical controls of a modern gamepad, in a layout that maps
 * cleanly onto every emulator we target. Each is bound to an SDL
 * GameController input token (see `PadBinding`), so one profile can be written
 * into RALibretro, PCSX2, RPCS3, Dolphin and Azahar configs.
 */
export type PadControl =
  | "up"
  | "down"
  | "left"
  | "right"
  | "a" // bottom face (SDL a / PS cross)
  | "b" // right face  (SDL b / PS circle)
  | "x" // left face   (SDL x / PS square)
  | "y" // top face    (SDL y / PS triangle)
  | "l1" // left shoulder
  | "r1" // right shoulder
  | "l2" // left trigger
  | "r2" // right trigger
  | "l3" // left stick click
  | "r3" // right stick click
  | "select"
  | "start"
  | "lstick_up"
  | "lstick_down"
  | "lstick_left"
  | "lstick_right"
  | "rstick_up"
  | "rstick_down"
  | "rstick_left"
  | "rstick_right";

/**
 * The physical SDL GameController input a control is bound to — a button name
 * ("a", "dpup", "leftshoulder", …), a signed axis ("-leftx", "+lefty",
 * "lefttrigger"), or "none". This is the RALibretro token vocabulary and the
 * lingua franca we translate from for the other emulators.
 */
export type PadBinding = string;

export interface ControllerProfile {
  /** Human name of the mapped controller (e.g. "Xbox 360 Controller"). */
  controllerName: string | null;
  /** SDL/joystick index of the controller (0 for the first pad). */
  controllerIndex: number;
  /** SDL GUID of the controller, when known (needed by Azahar/Citra). */
  controllerGuid: string | null;
  /** Enable motion (gyro/accel) for emulators/controllers that support it. */
  motion?: boolean;
  /** Logical control → SDL input token. */
  bindings: Record<PadControl, PadBinding>;
}

/**
 * The emulated-controller kind for emulators that expose more than one (Cemu:
 * Wii U GamePad / Pro / Classic; Dolphin: GameCube pad / Wii Remote). Ignored
 * by single-type emulators.
 */
export type EmulatedControllerType =
  | "wiiu_gamepad"
  | "wiiu_pro"
  | "wiiu_classic"
  | "gamecube"
  | "wiimote"
  | "switch_pro"
  | "joycon_pair";

/**
 * Controller profiles keyed by scope. `global` is the one-for-all default;
 * `byBinary` holds optional per-emulator overrides so users can keep distinct
 * mappings per console. `types` records the chosen emulated-controller kind per
 * emulator that supports several.
 */
export interface ControllerProfileStore {
  global: ControllerProfile;
  byBinary: Partial<Record<EmulatorBinary, ControllerProfile>>;
  types: Partial<Record<EmulatorBinary, EmulatedControllerType>>;
}

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

/** Action payload passed to `updateClassicsDisc` IPC. */
export type ClassicsDiscUpdate =
  | {
      addDisc: { path: string; label: string; fileName: string };
      selectedDiscPath: string;
    }
  | { selectedDiscPath: string }
  | { dontAskDiscSelection: boolean }
  | { removeDiscPath: string };

/** A game save detected inside a PS2 memory card (`.ps2`) image. */
export interface Ps2MemoryCardSaveRecord {
  cardFilePath: string; // absolute path to the .ps2 file
  cardLabel: string; // basename, e.g. "Mcd001.ps2"
  folderName: string; // on-card save folder, e.g. "BESLES-50009"
  sku: string | null; // normalized "SLES-50009", or null if unrecognized
  objectId: string | null; // resolved LaunchBox objectId, or null if unmatched
  shop: "launchbox" | null;
  title: string | null; // resolved title (UI falls back to folderName)
  iconUrl: string | null;
  libraryImageUrl: string | null;
  libraryHeroImageUrl: string | null;
  logoImageUrl: string | null;
  fileCount: number;
  sizeBytes: number;
  createdAt: number; // save's created time (epoch ms)
  modifiedAt: number; // save's modified time (epoch ms)
  detectedAt: number; // when this scan recorded it (epoch ms)
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

/*
 * PS1 (DuckStation) memory card saves reuse the exact same record/scan/export
 * shapes as PS2 — only the on-card format and export container differ. These
 * neutral aliases let the shared sublevel, IPC and UI code read system-agnostic.
 * For PS1, `folderName` holds the on-card save identifier and `fileCount` holds
 * the block count.
 */
export type MemoryCardSaveRecord = Ps2MemoryCardSaveRecord;
export type MemcardScanInput = Ps2MemcardScanInput;
export type MemcardScanProgress = Ps2MemcardScanProgress;
export type MemcardExportResult = Ps2ExportResult;

/* ── Cloud emulation saves (`/profile/emulation-saves`) ───────────────────── */

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

/** A committed cloud save as returned by the emulation-saves API. */
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

/** Result of preparing a downloaded save for restoration into a local card. */
export interface MemcardRestoreResult {
  ok: boolean;
  /** True until the app has a format-complete, crash-safe card writer. */
  requiresManualImport?: boolean;
  /** Standards-based PSU/MCS file revealed for the user to import. */
  exportedPath?: string;
  error?: string;
}

/** A local memory card a cloud save can be restored into. */
export interface MemcardRestoreTarget {
  cardFilePath: string;
  cardLabel: string;
}

/* ── Emulator install helper (Setup Wizard) ───────────────────────────────── */

export type EmulatorInstallKind =
  | "windows-installer"
  | "linux-appimage"
  | "linux-flatpak"
  | "windows-archive"
  | "link";

export type EmulatorInstallChannel = "release" | "prerelease";

export type EmulatorInstallLinkKind = "aur" | "flatpak" | "release_page";

/** A single, IPC-serializable install option offered for an emulator. */
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

/** A selectable preset option within one category of a Cemu graphic pack. */
export interface CemuGraphicPackPresetCategory {
  /** Category name (empty string for a pack's default, uncategorised preset). */
  category: string;
  /** The available preset names in this category. */
  options: string[];
  /** The currently-active preset for this category (from settings.xml). */
  active: string | null;
}

/** A Cemu graphic pack parsed from a downloaded rules.txt. */
export interface CemuGraphicPack {
  /** Stable id — the rules.txt path relative to the Cemu data dir. */
  id: string;
  /** Display name (rules.txt `name`, falling back to the path leaf). */
  name: string;
  /** The Cemu tree path, e.g. "Zelda BOTW/Mods/FPS++". */
  path: string;
  /** Wii U title ids this pack applies to (lowercased hex). */
  titleIds: string[];
  /** Optional description from rules.txt. */
  description: string | null;
  /** Whether this pack is currently enabled in settings.xml. */
  enabled: boolean;
  /** Preset categories the user can choose from. */
  presets: CemuGraphicPackPresetCategory[];
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
