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

export const KNOWN_BINARIES: Record<EmulatorSystem, KnownBinary> = {
  ps1: {
    system: "ps1",
    binary: "duckstation",
    displayName: "DuckStation",
    systems: ["ps1"],
    hasRetroAchievements: false,
    linuxNames: [
      "duckstation-qt",
      "duckstation-nogui",
      "duckstation",
      "DuckStation",
    ],
    windowsNames: [
      "duckstation-qt-x64-ReleaseLTCG.exe",
      "duckstation-qt.exe",
      "duckstation-nogui.exe",
    ],
    flatpakIds: ["org.duckstation.DuckStation"],
    versionFlags: ["-version"],
    romExtensions: [
      ".cue",
      ".bin",
      ".iso",
      ".chd",
      ".pbp",
      ".img",
      ".sub",
      ".ccd",
      ".mds",
      ".mdf",
      ".ecm",
      ".m3u",
    ],
    romDirectoryMarkers: [],
    install: {
      githubRepo: "stenzek/duckstation",
      windowsAssetPattern: "windows-x64.*\\.zip$",
      linuxAssetPattern: "x64\\.AppImage$",
      flatpakInstallId: "org.duckstation.DuckStation",
    },
  },
  ps2: {
    system: "ps2",
    binary: "pcsx2",
    displayName: "PCSX2",
    systems: ["ps2"],
    hasRetroAchievements: false,
    linuxNames: ["pcsx2-qt", "pcsx2", "PCSX2"],
    windowsNames: ["pcsx2-qt.exe", "pcsx2-qtx64-avx2.exe", "pcsx2.exe"],
    flatpakIds: ["net.pcsx2.PCSX2"],
    versionFlags: ["-version"],
    romExtensions: [
      ".iso",
      ".chd",
      ".cso",
      ".zso",
      ".gz",
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
      windowsAssetPattern: "windows-x64.*\\.7z$",
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
  psp: {
    system: "psp",
    binary: "ppsspp",
    displayName: "PPSSPP",
    systems: ["psp"],
    hasRetroAchievements: true,
    linuxNames: ["PPSSPPSDL", "PPSSPPQt", "ppsspp"],
    windowsNames: ["PPSSPPWindows64.exe", "PPSSPPWindows.exe"],
    flatpakIds: ["org.ppsspp.PPSSPP"],
    versionFlags: ["--version"],
    romExtensions: [".iso", ".cso", ".chd", ".pbp", ".prx", ".elf"],
    romDirectoryMarkers: [],
    install: {
      githubRepo: "hrydgard/ppsspp",
      windowsAssetPattern: "windows.*\\.(zip|7z)$",
      releasePageUrl: "https://www.ppsspp.org/download/",
      flatpakInstallId: "org.ppsspp.PPSSPP",
    },
  },
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
      windowsAssetPattern: "windows.*(msvc|x86_64).*\\.zip$",
      linuxAssetPattern: "\\.AppImage$",
      flatpakInstallId: "org.azahar_emu.Azahar",
    },
  },
  nds: {
    system: "nds",
    binary: "ralibretro",
    displayName: "RALibretro",
    systems: ["nds", "dsi"],
    hasRetroAchievements: true,
    linuxNames: ["RALibretro", "ralibretro"],
    windowsNames: ["RALibretro.exe", "RALibretro-x64.exe"],
    flatpakIds: [],
    versionFlags: ["--version"],
    romExtensions: [".nds", ".srl"],
    romDirectoryMarkers: [],
    install: {
      githubRepo: "RetroAchievements/RALibretro",
      windowsAssetPattern: "\\.(zip|7z)$",
      releasePageUrl: "https://github.com/RetroAchievements/RALibretro/releases",
    },
  },
  dsi: {
    system: "dsi",
    binary: "ralibretro",
    displayName: "RALibretro",
    systems: ["nds", "dsi"],
    hasRetroAchievements: true,
    linuxNames: ["RALibretro", "ralibretro"],
    windowsNames: ["RALibretro.exe", "RALibretro-x64.exe"],
    flatpakIds: [],
    versionFlags: ["--version"],
    romExtensions: [".nds", ".dsi", ".srl", ".ids"],
    romDirectoryMarkers: [],
    install: {
      githubRepo: "RetroAchievements/RALibretro",
      windowsAssetPattern: "\\.(zip|7z)$",
      releasePageUrl: "https://github.com/RetroAchievements/RALibretro/releases",
    },
  },
  n64: {
    system: "n64",
    binary: "raproject64",
    displayName: "RAProject64",
    systems: ["n64"],
    hasRetroAchievements: true,
    linuxNames: ["RAProject64", "project64"],
    windowsNames: ["RAProject64.exe", "Project64.exe"],
    flatpakIds: [],
    versionFlags: ["--version"],
    romExtensions: [".z64", ".n64", ".v64", ".ndd", ".u1"],
    romDirectoryMarkers: [],
    install: {
      githubRepo: "RetroAchievements/RAProject64",
      windowsAssetPattern: "\\.(zip|7z|exe)$",
      releasePageUrl:
        "https://github.com/RetroAchievements/RAProject64/releases",
    },
  },
  gb: {
    system: "gb",
    binary: "ravba",
    displayName: "RAVBA",
    systems: ["gb", "gbc", "gba"],
    hasRetroAchievements: true,
    linuxNames: ["RAVBA", "visualboyadvance-m"],
    windowsNames: ["RAVBA.exe", "visualboyadvance-m.exe"],
    flatpakIds: [],
    versionFlags: ["--version"],
    romExtensions: [".gb"],
    romDirectoryMarkers: [],
    install: {
      githubRepo: "RetroAchievements/RAVBA",
      windowsAssetPattern: "\\.(zip|7z)$",
      releasePageUrl: "https://github.com/RetroAchievements/RAVBA/releases",
    },
  },
  gbc: {
    system: "gbc",
    binary: "ravba",
    displayName: "RAVBA",
    systems: ["gb", "gbc", "gba"],
    hasRetroAchievements: true,
    linuxNames: ["RAVBA", "visualboyadvance-m"],
    windowsNames: ["RAVBA.exe", "visualboyadvance-m.exe"],
    flatpakIds: [],
    versionFlags: ["--version"],
    romExtensions: [".gbc", ".cgb", ".sgb"],
    romDirectoryMarkers: [],
    install: {
      githubRepo: "RetroAchievements/RAVBA",
      windowsAssetPattern: "\\.(zip|7z)$",
      releasePageUrl: "https://github.com/RetroAchievements/RAVBA/releases",
    },
  },
  gba: {
    system: "gba",
    binary: "ravba",
    displayName: "RAVBA",
    systems: ["gb", "gbc", "gba"],
    hasRetroAchievements: true,
    linuxNames: ["RAVBA", "visualboyadvance-m"],
    windowsNames: ["RAVBA.exe", "visualboyadvance-m.exe"],
    flatpakIds: [],
    versionFlags: ["--version"],
    romExtensions: [".gba", ".agb", ".bin"],
    romDirectoryMarkers: [],
    install: {
      githubRepo: "RetroAchievements/RAVBA",
      windowsAssetPattern: "\\.(zip|7z)$",
      releasePageUrl: "https://github.com/RetroAchievements/RAVBA/releases",
    },
  },
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
    romExtensions: [".wux", ".wud", ".wad", ".rpx", ".iso"],
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

/** First system served by a binary (used to resolve detection metadata). */
export const primarySystemForBinary = (
  binary: EmulatorBinary
): EmulatorSystem =>
  ALL_SYSTEMS.find((system) => KNOWN_BINARIES[system].binary === binary) ??
  "ps1";
