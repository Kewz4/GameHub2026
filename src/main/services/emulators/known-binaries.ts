import type { EmulatorBinary, EmulatorSystem } from "@types";

/**
 * Where the app can fetch a portable build of an emulator. Most RA cores and
 * the Nintendo/Sony emulators publish GitHub releases; the few that don't
 * (Dolphin) fall back to a release-page link or flatpak.
 */
export interface EmulatorInstallSource {
  /** "owner/repo" whose latest release is queried, or null when unavailable. */
  githubRepo: string | null;
  /** Case-insensitive regex (source string) matching the Windows asset. */
  windowsAssetPattern?: string;
  /** Case-insensitive regex (source string) matching the Linux asset. */
  linuxAssetPattern?: string;
  /** A fixed direct-download archive URL (used instead of the GitHub API when a
   *  vendor publishes a stable URL, e.g. RALibretro on retroachievements.org). */
  directDownloadUrl?: string;
  /** Fallback page shown as a "link" option when no direct asset resolves. */
  releasePageUrl?: string;
  /** Flatpak app id offered as a Linux install option. */
  flatpakInstallId?: string;
}

export interface KnownBinary {
  system: EmulatorSystem;
  binary: EmulatorBinary;
  displayName: string;
  /** Every system this binary can run (e.g. RAVBA → gb/gbc/gba). */
  systems: EmulatorSystem[];
  /** Whether the emulator unlocks RetroAchievements natively. */
  hasRetroAchievements: boolean;
  linuxNames: string[];
  windowsNames: string[];
  flatpakIds: string[];
  versionFlags: string[];
  romExtensions: string[];
  romDirectoryMarkers: string[];
  install: EmulatorInstallSource;
}

/**
 * RALibretro is the RetroAchievements libretro front-end. One install serves
 * PS1, PSP, the whole Game Boy family (GB/GBC/GBA), N64, DS and DSi via the
 * bundled cores (mednafen_psx, ppsspp, mgba, mupen64plus_next, melondsds) —
 * the mGBA core handles GB and GBC as well as GBA, so there's no separate
 * emulator for them. It ships a stable direct-download zip on
 * retroachievements.org rather than a GitHub release. Windows-only.
 */
export const RALIBRETRO_SYSTEMS: EmulatorSystem[] = [
  "ps1",
  "psp",
  "gba",
  "gb",
  "gbc",
  "n64",
  "nds",
  "dsi",
];
const RALIBRETRO_INSTALL: EmulatorInstallSource = {
  githubRepo: null,
  // The x64 build — its RALibretro.exe is 64-bit and matches the 64-bit
  // libretro cores we bundle. The non-x64 (RALibretro.zip) frontend is 32-bit
  // and CANNOT load those cores, so it must not be used here.
  directDownloadUrl: "https://retroachievements.org/bin/RALibretro-x64.zip",
  flatpakInstallId: "org.libretro.RetroArch",
  ...(process.platform === "linux"
    ? { releasePageUrl: "https://www.retroarch.com/?page=platforms" }
    : {}),
  // No releasePageUrl: RALibretro installs automatically (bundled cores +
  // configs); we never fall back to opening a downloads page for it.
};
const RALIBRETRO_WIN_NAMES = ["RALibretro.exe", "RALibretro-x64.exe"];
const RALIBRETRO_LINUX_NAMES = ["retroarch", "RetroArch"];

/** Build a RALibretro-backed KnownBinary for one of its systems. */
const ralibretro = (
  system: EmulatorSystem,
  romExtensions: string[]
): KnownBinary => ({
  system,
  binary: "ralibretro",
  displayName: process.platform === "linux" ? "RetroArch" : "RALibretro",
  systems: RALIBRETRO_SYSTEMS,
  hasRetroAchievements: true,
  linuxNames: RALIBRETRO_LINUX_NAMES,
  windowsNames: RALIBRETRO_WIN_NAMES,
  flatpakIds: ["org.libretro.RetroArch"],
  versionFlags: ["--version"],
  romExtensions,
  romDirectoryMarkers: [],
  install: RALIBRETRO_INSTALL,
});

export const KNOWN_BINARIES: Record<EmulatorSystem, KnownBinary> = {
  // PS1 via Beetle PSX (mednafen_psx) — cue/chd/pbp/m3u; .bin is a cue sidecar.
  ps1: ralibretro("ps1", [
    ".cue",
    ".bin",
    ".chd",
    ".pbp",
    ".m3u",
    ".ccd",
    ".img",
    ".ecm",
  ]),
  ps2: {
    system: "ps2",
    binary: "pcsx2",
    displayName: "PCSX2",
    systems: ["ps2"],
    // PCSX2 has built-in RetroAchievements support (Achievements settings).
    hasRetroAchievements: true,
    linuxNames: ["pcsx2-qt", "pcsx2", "PCSX2"],
    windowsNames: ["pcsx2-qt.exe", "pcsx2-qtx64-avx2.exe", "pcsx2.exe"],
    flatpakIds: ["net.pcsx2.PCSX2"],
    versionFlags: ["-version"],
    romExtensions: [
      ".iso",
      ".chd",
      ".cso",
      ".zso",
      ".nrg",
      ".cue",
      ".bin",
      ".mds",
      ".mdf",
      ".m3u",
    ],
    romDirectoryMarkers: [],
    install: {
      githubRepo: "PCSX2/pcsx2",
      // The real build is "...windows-x64-Qt.7z"; exclude "...-Qt-symbols.7z"
      // (debug symbols), which "windows-x64.*\\.7z$" matched first.
      windowsAssetPattern: "windows-x64-Qt\\.7z$",
      linuxAssetPattern: "x64\\.AppImage$",
      flatpakInstallId: "net.pcsx2.PCSX2",
    },
  },
  ps3: {
    system: "ps3",
    binary: "rpcs3",
    displayName: "RPCS3",
    systems: ["ps3"],
    hasRetroAchievements: false,
    linuxNames: ["rpcs3", "RPCS3"],
    windowsNames: ["rpcs3.exe"],
    flatpakIds: ["net.rpcs3.RPCS3"],
    versionFlags: ["--version"],
    // Only formats RPCS3 launches as a game. Disc dumps are caught via
    // romDirectoryMarkers; license/internal files (.rap/.sfb/.bin/...) excluded.
    romExtensions: [".iso", ".pkg", ".elf", ".self"],
    romDirectoryMarkers: ["PS3_GAME", "ps3_game"],
    install: {
      githubRepo: "DAGINATSUKO/www-rpcs3",
      windowsAssetPattern: "win64.*\\.(7z|zip)$",
      linuxAssetPattern: "\\.AppImage$",
      flatpakInstallId: "net.rpcs3.RPCS3",
    },
  },
  // PSP via the ppsspp libretro core — iso/chd/pbp.
  psp: ralibretro("psp", [".iso", ".cso", ".chd", ".pbp"]),
  n3ds: {
    system: "n3ds",
    binary: "azahar",
    displayName: "Azahar",
    systems: ["n3ds"],
    hasRetroAchievements: false,
    linuxNames: ["azahar", "azahar-qt"],
    windowsNames: ["azahar.exe", "azahar-qt.exe"],
    flatpakIds: ["org.azahar_emu.Azahar"],
    versionFlags: ["--version"],
    romExtensions: [".3ds", ".cci", ".cxi", ".cia", ".app", ".3dsx", ".elf"],
    romDirectoryMarkers: [],
    install: {
      githubRepo: "azahar-emu/azahar",
      // Standalone MSVC build zip only — exclude the libretro CORE zip
      // ("azahar-libretro-windows-x86_64-….zip", a single DLL) and the
      // "-installer.exe", both of which the old pattern matched first.
      windowsAssetPattern: "azahar-windows-msvc-[\\d.]+\\.zip$",
      linuxAssetPattern: "\\.AppImage$",
      flatpakInstallId: "org.azahar_emu.Azahar",
    },
  },
  // DS / DSi via melonDS DS.
  nds: ralibretro("nds", [".nds", ".srl"]),
  dsi: ralibretro("dsi", [".nds", ".dsi", ".srl", ".ids"]),
  // N64 via mupen64plus_next.
  n64: ralibretro("n64", [".z64", ".n64", ".v64", ".ndd"]),
  // Game Boy / Game Boy Color via the same mGBA libretro core as GBA — served
  // by RALibretro, not a separate emulator.
  gb: ralibretro("gb", [".gb"]),
  gbc: ralibretro("gbc", [".gbc", ".cgb", ".sgb"]),
  // GBA via the mGBA libretro core.
  gba: ralibretro("gba", [".gba", ".agb"]),
  wiiu: {
    system: "wiiu",
    binary: "cemu",
    displayName: "Cemu",
    systems: ["wiiu"],
    hasRetroAchievements: false,
    linuxNames: ["Cemu", "cemu"],
    windowsNames: ["Cemu.exe"],
    flatpakIds: ["info.cemu.Cemu"],
    versionFlags: ["--version"],
    romExtensions: [".wux", ".wud", ".wua", ".wad", ".rpx", ".iso"],
    romDirectoryMarkers: ["code", "content", "meta"],
    install: {
      githubRepo: "cemu-project/Cemu",
      windowsAssetPattern: "windows.*x64.*\\.zip$",
      linuxAssetPattern: "\\.AppImage$",
      flatpakInstallId: "info.cemu.Cemu",
    },
  },
  wii: {
    system: "wii",
    binary: "dolphin",
    displayName: "Dolphin",
    systems: ["wii", "gc"],
    hasRetroAchievements: true,
    linuxNames: ["dolphin-emu", "Dolphin"],
    windowsNames: ["Dolphin.exe", "DolphinR.exe"],
    flatpakIds: ["org.DolphinEmu.dolphin-emu"],
    versionFlags: ["--version"],
    romExtensions: [".rvz", ".iso", ".wbfs", ".wad", ".gcz", ".ciso", ".nkit"],
    romDirectoryMarkers: [],
    install: {
      githubRepo: null,
      releasePageUrl: "https://dolphin-emu.org/download/",
      flatpakInstallId: "org.DolphinEmu.dolphin-emu",
    },
  },
  gc: {
    system: "gc",
    binary: "dolphin",
    displayName: "Dolphin",
    systems: ["wii", "gc"],
    hasRetroAchievements: true,
    linuxNames: ["dolphin-emu", "Dolphin"],
    windowsNames: ["Dolphin.exe", "DolphinR.exe"],
    flatpakIds: ["org.DolphinEmu.dolphin-emu"],
    versionFlags: ["--version"],
    romExtensions: [".rvz", ".iso", ".gcm", ".gcz", ".ciso", ".nkit"],
    romDirectoryMarkers: [],
    install: {
      githubRepo: null,
      releasePageUrl: "https://dolphin-emu.org/download/",
      flatpakInstallId: "org.DolphinEmu.dolphin-emu",
    },
  },
  switch: {
    system: "switch",
    binary: "eden",
    displayName: "Eden",
    systems: ["switch"],
    hasRetroAchievements: false,
    linuxNames: ["eden", "Eden"],
    windowsNames: ["eden.exe"],
    flatpakIds: [],
    versionFlags: ["--version"],
    romExtensions: [".nsp", ".xci", ".nsz", ".xcz", ".nca"],
    romDirectoryMarkers: [],
    install: {
      githubRepo: null,
      // Eden publishes on its own Forgejo instance, not GitHub. The stable
      // channel serves a fixed URL pattern per version.
      directDownloadUrl:
        "https://stable.eden-emu.dev/v0.2.0-rc2/Eden-Windows-v0.2.0-rc2-amd64-msvc-standard.zip",
      releasePageUrl: "https://git.eden-emu.dev/eden-emu/eden/releases",
    },
  },
};

/** Every system key, in display order. */
export const ALL_SYSTEMS: EmulatorSystem[] = Object.keys(
  KNOWN_BINARIES
) as EmulatorSystem[];

/** Systems whose emulator unlocks RetroAchievements natively. */
export const RETROACHIEVEMENTS_SYSTEMS: EmulatorSystem[] = ALL_SYSTEMS.filter(
  (system) => KNOWN_BINARIES[system].hasRetroAchievements
);

export const systemHasRetroAchievements = (system: EmulatorSystem): boolean =>
  KNOWN_BINARIES[system].hasRetroAchievements;

export const EMULATOR_BINARIES: readonly EmulatorBinary[] = Array.from(
  new Set(Object.values(KNOWN_BINARIES).map((entry) => entry.binary))
);

export const isKnownEmulatorBinary = (
  value: unknown
): value is EmulatorBinary =>
  typeof value === "string" &&
  (EMULATOR_BINARIES as readonly string[]).includes(value);

/**
 * First system served by a binary (used to resolve detection metadata), or
 * null when no system currently maps to this binary (e.g. a stale/orphaned
 * binary from a persisted config that predates a registry change). Callers
 * MUST handle null explicitly — silently falling back to an arbitrary system
 * would resolve a *different* binary's install source under the orphaned
 * binary's name, masking the mismatch instead of surfacing it.
 */
export const primarySystemForBinary = (
  binary: EmulatorBinary
): EmulatorSystem | null =>
  ALL_SYSTEMS.find((system) => KNOWN_BINARIES[system].binary === binary) ??
  null;
