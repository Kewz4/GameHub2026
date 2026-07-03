import fs from "node:fs";
import path from "node:path";
import type { EmulatorSystem } from "@types";
import { KNOWN_BINARIES } from "./known-binaries";
import { getEmulatorConfig } from "./emulators-repository";
import { logger } from "../logger";
import type { SettingDef, SettingValue, SettingType } from "./setting-types";
import { STANDALONE_SETTINGS_BY_SYSTEM } from "./standalone-settings-defs";
import {
  isStandaloneSettingsSystem,
  readStandaloneSettings,
  writeStandaloneSettings,
} from "./emulator-standalone-settings";

export type { SettingDef, SettingValue, SettingType };

/**
 * User-facing emulator settings (video / performance / core options), exposed
 * per system and persisted into the emulator's own config files. RALibretro
 * systems edit the libretro core option JSON (`<install>/Cores/<core>.json`);
 * standalone emulators (PCSX2/RPCS3/Dolphin/Azahar/Cemu) edit their own native
 * config (INI/YAML/XML) via emulator-standalone-settings.
 */

/** Which libretro core file backs each RALibretro system. */
const CORE_FILE: Partial<Record<EmulatorSystem, string>> = {
  n64: "mupen64plus_next_libretro.json",
  ps1: "mednafen_psx_libretro.json",
  psp: "ppsspp_libretro.json",
  gba: "mgba_libretro.json",
  gb: "mgba_libretro.json",
  gbc: "mgba_libretro.json",
  nds: "melondsds_libretro.json",
  dsi: "melondsds_libretro.json",
};

const onOff = [
  { value: "True", label: "On" },
  { value: "False", label: "Off" },
];
const enabledDisabled = [
  { value: "enabled", label: "On" },
  { value: "disabled", label: "Off" },
];

/** The N64 (Mupen64Plus-Next) options we surface — resolution/upscaling first. */
const N64_SETTINGS: SettingDef[] = [
  {
    key: "mupen64plus-rdp-plugin",
    label: "Renderer",
    type: "enum",
    group: "Video",
    hint: "GLideN64 = best compatibility; ParaLLEl = accurate; Angrylion = pixel-perfect (slow).",
    options: [
      { value: "gliden64", label: "GLideN64" },
      { value: "parallel", label: "ParaLLEl-RDP" },
      { value: "angrylion", label: "Angrylion (accurate)" },
    ],
  },
  {
    key: "mupen64plus-EnableNativeResFactor",
    label: "Internal resolution (GLideN64)",
    type: "enum",
    group: "Video",
    hint: "Upscale factor over native N64 resolution.",
    options: [
      { value: "0", label: "Disabled" },
      { value: "1", label: "1× (native)" },
      { value: "2", label: "2×" },
      { value: "3", label: "3×" },
      { value: "4", label: "4×" },
      { value: "6", label: "6×" },
      { value: "8", label: "8×" },
    ],
  },
  {
    key: "mupen64plus-parallel-rdp-upscaling",
    label: "Internal resolution (ParaLLEl)",
    type: "enum",
    group: "Video",
    options: [
      { value: "1x", label: "1× (native)" },
      { value: "2x", label: "2×" },
      { value: "4x", label: "4×" },
      { value: "8x", label: "8×" },
    ],
  },
  {
    key: "mupen64plus-aspect",
    label: "Aspect ratio",
    type: "enum",
    group: "Video",
    options: [
      { value: "4:3", label: "4:3" },
      { value: "16:9", label: "16:9" },
      { value: "16:9 adjusted", label: "16:9 adjusted" },
    ],
  },
  {
    key: "mupen64plus-169screensize",
    label: "16:9 resolution",
    type: "enum",
    group: "Video",
    options: [
      { value: "960x540", label: "960×540" },
      { value: "1280x720", label: "1280×720" },
      { value: "1920x1080", label: "1920×1080" },
      { value: "2560x1440", label: "2560×1440" },
      { value: "3840x2160", label: "3840×2160 (4K)" },
    ],
  },
  {
    key: "mupen64plus-MultiSampling",
    label: "Anti-aliasing (MSAA)",
    type: "enum",
    group: "Enhancements",
    options: [
      { value: "0", label: "Off" },
      { value: "2", label: "2×" },
      { value: "4", label: "4×" },
      { value: "8", label: "8×" },
      { value: "16", label: "16×" },
    ],
  },
  {
    key: "mupen64plus-txFilterMode",
    label: "Texture filtering",
    type: "enum",
    group: "Enhancements",
    options: [
      { value: "None", label: "None" },
      { value: "Smooth filtering 1", label: "Smooth 1" },
      { value: "Smooth filtering 2", label: "Smooth 2" },
      { value: "Sharp filtering 1", label: "Sharp 1" },
    ],
  },
  {
    key: "mupen64plus-ThreadedRenderer",
    label: "Threaded renderer",
    type: "toggle",
    group: "Performance",
    options: onOff,
    hint: "Can improve performance; may cause glitches in some games.",
  },
  {
    key: "mupen64plus-cpucore",
    label: "CPU core",
    type: "enum",
    group: "Performance",
    options: [
      { value: "dynamic_recompiler", label: "Dynamic recompiler (fast)" },
      { value: "cached_interpreter", label: "Cached interpreter" },
      { value: "pure_interpreter", label: "Pure interpreter (accurate)" },
    ],
  },
];

/** PS1 (Beetle PSX) options. */
const PS1_SETTINGS: SettingDef[] = [
  {
    key: "beetle_psx_internal_resolution",
    label: "Internal resolution",
    type: "enum",
    group: "Video",
    options: [
      { value: "1x(native)", label: "1× (native)" },
      { value: "2x", label: "2×" },
      { value: "4x", label: "4×" },
      { value: "8x", label: "8×" },
      { value: "16x", label: "16×" },
    ],
  },
  {
    key: "beetle_psx_pgxp_mode",
    label: "PGXP (geometry correction)",
    type: "enum",
    group: "Enhancements",
    hint: "Reduces the classic PS1 polygon wobble.",
    options: [
      { value: "disabled", label: "Off" },
      { value: "memory only", label: "Memory only" },
      { value: "memory + CPU", label: "Memory + CPU" },
    ],
  },
  {
    key: "beetle_psx_widescreen_hack",
    label: "Widescreen hack",
    type: "enum",
    group: "Video",
    options: enabledDisabled,
  },
  {
    key: "beetle_psx_aspect_ratio",
    label: "Aspect ratio",
    type: "enum",
    group: "Video",
    hint: "For 16:9, turn on the Widescreen hack instead.",
    options: [
      { value: "corrected", label: "Corrected" },
      { value: "uncorrected", label: "Uncorrected" },
      { value: "4:3", label: "4:3" },
      { value: "ntsc", label: "NTSC" },
    ],
  },
  {
    key: "beetle_psx_dither_mode",
    label: "Dithering",
    type: "enum",
    group: "Video",
    options: [
      { value: "1x(native)", label: "Native" },
      { value: "internal resolution", label: "Internal resolution" },
      { value: "disabled", label: "Off" },
    ],
  },
];

/** PSP (PPSSPP core) options. */
const PSP_SETTINGS: SettingDef[] = [
  {
    key: "ppsspp_internal_resolution",
    label: "Internal resolution",
    type: "enum",
    group: "Video",
    options: [
      { value: "480x272", label: "1× (native)" },
      { value: "960x544", label: "2×" },
      { value: "1440x816", label: "3×" },
      { value: "1920x1088", label: "4×" },
    ],
  },
  {
    key: "ppsspp_frameskip",
    label: "Frameskip",
    type: "enum",
    group: "Performance",
    options: [
      { value: "disabled", label: "Off" },
      { value: "1", label: "1" },
      { value: "2", label: "2" },
      { value: "3", label: "3" },
    ],
  },
  {
    key: "ppsspp_texture_scaling_level",
    label: "Texture upscaling",
    type: "enum",
    group: "Enhancements",
    options: [
      { value: "disabled", label: "Off" },
      { value: "2x", label: "2×" },
      { value: "3x", label: "3×" },
      { value: "4x", label: "4×" },
      { value: "5x", label: "5×" },
    ],
  },
];

/** GBA (mGBA core) options. */
const GBA_SETTINGS: SettingDef[] = [
  {
    key: "mgba_color_correction",
    label: "Color correction",
    type: "enum",
    group: "Video",
    hint: "Emulate the washed-out GBA/GBC LCD colors.",
    options: [
      { value: "OFF", label: "Off" },
      { value: "GBA", label: "Game Boy Advance" },
      { value: "GBC", label: "Game Boy Color" },
      { value: "Auto", label: "Auto" },
    ],
  },
  {
    key: "mgba_frameskip",
    label: "Frameskip",
    type: "enum",
    group: "Performance",
    hint: "Fixed interval uses the frameskip amount below.",
    options: [
      { value: "disabled", label: "Off" },
      { value: "auto", label: "Auto" },
      { value: "auto_threshold", label: "Auto (threshold)" },
      { value: "fixed_interval", label: "Fixed interval" },
    ],
  },
  {
    key: "mgba_frameskip_interval",
    label: "Frameskip amount",
    type: "enum",
    group: "Performance",
    options: [
      { value: "0", label: "0" },
      { value: "1", label: "1" },
      { value: "2", label: "2" },
      { value: "3", label: "3" },
      { value: "4", label: "4" },
    ],
  },
  {
    key: "mgba_interframe_blending",
    label: "Interframe blending",
    type: "enum",
    group: "Video",
    options: [
      { value: "OFF", label: "Off" },
      { value: "mix", label: "Mix" },
      { value: "mix_smart", label: "Mix (smart)" },
      { value: "lcd_ghosting", label: "LCD ghosting" },
      { value: "lcd_ghosting_fast", label: "LCD ghosting (fast)" },
    ],
  },
];

/** DS / DSi (melonDS core) options. */
const DS_SETTINGS: SettingDef[] = [
  {
    key: "melonds_render_mode",
    label: "Renderer",
    type: "enum",
    group: "Video",
    options: [
      { value: "software", label: "Software" },
      { value: "opengl", label: "OpenGL (upscale)" },
    ],
  },
  {
    key: "melonds_opengl_resolution",
    label: "Internal resolution (OpenGL)",
    type: "enum",
    group: "Video",
    options: [
      { value: "1", label: "1× (native)" },
      { value: "2", label: "2×" },
      { value: "4", label: "4×" },
      { value: "8", label: "8×" },
    ],
  },
  {
    key: "melonds_screen_layout1",
    label: "Screen layout",
    type: "enum",
    group: "Video",
    options: [
      { value: "top-bottom", label: "Top / Bottom" },
      { value: "left-right", label: "Left / Right" },
      { value: "top", label: "Top only" },
    ],
  },
];

const SETTINGS_BY_SYSTEM: Partial<Record<EmulatorSystem, SettingDef[]>> = {
  n64: N64_SETTINGS,
  ps1: PS1_SETTINGS,
  psp: PSP_SETTINGS,
  gba: GBA_SETTINGS,
  gb: GBA_SETTINGS,
  gbc: GBA_SETTINGS,
  nds: DS_SETTINGS,
  dsi: DS_SETTINGS,
};

/** The settings schema exposed for a system (empty if none defined yet). */
export function getSettingDefs(system: EmulatorSystem): SettingDef[] {
  return (
    SETTINGS_BY_SYSTEM[system] ?? STANDALONE_SETTINGS_BY_SYSTEM[system] ?? []
  );
}

/** Resolve the core option file path for a RALibretro system, or null. */
async function coreFilePath(system: EmulatorSystem): Promise<string | null> {
  if (KNOWN_BINARIES[system]?.binary !== "ralibretro") return null;
  const file = CORE_FILE[system];
  if (!file) return null;
  const config = await getEmulatorConfig(system);
  if (!config.executablePath) return null;
  return path.join(path.dirname(config.executablePath), "Cores", file);
}

/** Read the current values for a system's exposed settings. */
export async function readEmulatorSettings(
  system: EmulatorSystem
): Promise<SettingValue[]> {
  const defs = getSettingDefs(system);
  if (defs.length === 0) return [];

  // Standalone emulators (PCSX2/RPCS3/Dolphin/Azahar/Cemu) read from their own
  // native config files.
  if (isStandaloneSettingsSystem(system)) {
    return readStandaloneSettings(system, defs);
  }

  const file = await coreFilePath(system);
  let core: Record<string, string> = {};
  if (file && fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      core = parsed?.core ?? {};
    } catch (err) {
      logger.warn(`[emulator-settings] failed to read ${file}`, err);
    }
  }
  return defs.map((d) => ({
    key: d.key,
    value: core[d.key] ?? d.options?.[0]?.value ?? "",
  }));
}

/** Persist changed settings for a system into its core option file. */
export async function writeEmulatorSettings(
  system: EmulatorSystem,
  values: SettingValue[]
): Promise<boolean> {
  if (isStandaloneSettingsSystem(system)) {
    return writeStandaloneSettings(system, values);
  }

  const file = await coreFilePath(system);
  if (!file) return false;

  let json: { core?: Record<string, string> } = {};
  if (fs.existsSync(file)) {
    try {
      json = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      json = {};
    }
  }
  json.core = { ...(json.core ?? {}) };
  for (const { key, value } of values) {
    json.core[key] = value;
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(json));
    return true;
  } catch (err) {
    logger.error(`[emulator-settings] failed to write ${file}`, err);
    return false;
  }
}
