import type { EmulatorSystem } from "@types";
import type { SettingDef } from "./setting-types";

/**
 * User-facing settings for the standalone emulators, mapping to the exact
 * config keys each one uses (see emulator-standalone-settings.ts for the file
 * formats/paths). Keys are the raw config keys; enum values are the raw values
 * written to disk.
 */

const upscale = (native = "1×"): { value: string; label: string }[] => [
  { value: "1", label: `1× (${native})` },
  { value: "2", label: "2×" },
  { value: "3", label: "3×" },
  { value: "4", label: "4×" },
  { value: "5", label: "5×" },
  { value: "6", label: "6× (4K)" },
  { value: "8", label: "8×" },
];

// ── PCSX2 (PS2) — inis/PCSX2.ini [EmuCore/GS] ────────────────────────────────
const PCSX2_SETTINGS: SettingDef[] = [
  {
    key: "upscale_multiplier",
    label: "Internal resolution",
    type: "enum",
    group: "Video",
    hint: "Upscale factor over native PS2 resolution.",
    options: upscale("native"),
  },
  {
    key: "AspectRatio",
    label: "Aspect ratio",
    type: "enum",
    group: "Video",
    options: [
      { value: "Auto 4:3", label: "Auto (4:3)" },
      { value: "4:3", label: "4:3" },
      { value: "16:9", label: "16:9" },
      { value: "Stretch", label: "Stretch" },
    ],
  },
  {
    key: "Renderer",
    label: "Renderer",
    type: "enum",
    group: "Video",
    hint: "Vulkan/Direct3D are fastest; Software is most accurate but slow.",
    options: [
      { value: "-1", label: "Automatic" },
      { value: "14", label: "Vulkan" },
      { value: "12", label: "OpenGL" },
      { value: "3", label: "Direct3D 11" },
      { value: "15", label: "Direct3D 12" },
      { value: "13", label: "Software" },
    ],
  },
];

// ── RPCS3 (PS3) — config.yml (nested; keys are "Group/Key") ───────────────────
const RPCS3_SETTINGS: SettingDef[] = [
  {
    key: "Video/Resolution Scale",
    label: "Resolution scale",
    type: "enum",
    group: "Video",
    hint: "Percentage of native 720p (100% = native).",
    options: [
      { value: "100", label: "100% (native)" },
      { value: "150", label: "150%" },
      { value: "200", label: "200% (1440p)" },
      { value: "300", label: "300% (4K)" },
    ],
  },
  {
    key: "Video/Renderer",
    label: "Renderer",
    type: "enum",
    group: "Video",
    options: [
      { value: "Vulkan", label: "Vulkan" },
      { value: "OpenGL", label: "OpenGL" },
      { value: "Null", label: "Null (no video)" },
    ],
  },
  {
    key: "Video/Frame limit",
    label: "Frame limit",
    type: "enum",
    group: "Performance",
    options: [
      { value: "Off", label: "Off" },
      { value: "Auto", label: "Auto" },
      { value: "60", label: "60 FPS" },
      { value: "30", label: "30 FPS" },
    ],
  },
];

// ── Azahar (3DS) — user/config/qt-config.ini [Renderer] ──────────────────────
// Keys verified against azahar-emu/azahar config.cpp.
const onOffTrue = [
  { value: "true", label: "On" },
  { value: "false", label: "Off" },
];
const AZAHAR_SETTINGS: SettingDef[] = [
  {
    key: "graphics_api",
    label: "Renderer",
    type: "enum",
    group: "Video",
    hint: "Vulkan is fastest on most GPUs; OpenGL is the fallback.",
    options: [
      { value: "2", label: "Vulkan" },
      { value: "1", label: "OpenGL" },
      { value: "0", label: "Software" },
    ],
  },
  {
    key: "resolution_factor",
    label: "Internal resolution",
    type: "enum",
    group: "Video",
    hint: "Upscale factor over native 3DS resolution (0 = follow window).",
    options: [
      { value: "0", label: "Auto (window)" },
      { value: "1", label: "1× (native)" },
      { value: "2", label: "2×" },
      { value: "3", label: "3×" },
      { value: "4", label: "4×" },
      { value: "6", label: "6×" },
      { value: "8", label: "8×" },
    ],
  },
  {
    key: "shaders_accurate_mul",
    label: "Accurate shader multiplication",
    type: "enum",
    group: "Video",
    hint: "Fixes graphical glitches in some games; slightly slower.",
    options: onOffTrue,
  },
  {
    key: "async_shader_compilation",
    label: "Async shader compilation",
    type: "enum",
    group: "Performance",
    hint: "Reduces shader-compilation stutter.",
    options: onOffTrue,
  },
  {
    key: "use_disk_shader_cache",
    label: "Disk shader cache",
    type: "enum",
    group: "Performance",
    hint: "Reuses compiled shaders across sessions.",
    options: onOffTrue,
  },
  {
    key: "use_vsync",
    label: "V-Sync",
    type: "enum",
    group: "Performance",
    options: onOffTrue,
  },
];

// ── Dolphin (Wii/GC) — User/Config/GFX.ini [Settings] + Dolphin.ini [Core] ────
const DOLPHIN_SETTINGS: SettingDef[] = [
  {
    key: "InternalResolution",
    label: "Internal resolution",
    type: "enum",
    group: "Video",
    hint: "Upscale factor over native resolution (1× = native).",
    options: [
      { value: "0", label: "Auto (window)" },
      { value: "1", label: "1× (native)" },
      { value: "2", label: "2× (720p)" },
      { value: "3", label: "3× (1080p)" },
      { value: "4", label: "4×" },
      { value: "5", label: "5× (1440p)" },
      { value: "6", label: "6× (4K)" },
      { value: "8", label: "8×" },
    ],
  },
  {
    key: "AspectRatio",
    label: "Aspect ratio",
    type: "enum",
    group: "Video",
    options: [
      { value: "0", label: "Auto" },
      { value: "1", label: "Force 16:9" },
      { value: "2", label: "Force 4:3" },
      { value: "3", label: "Stretch" },
    ],
  },
  {
    key: "GFXBackend",
    label: "Renderer",
    type: "enum",
    group: "Video",
    hint: "Video backend (stored in Dolphin.ini).",
    options: [
      { value: "Vulkan", label: "Vulkan" },
      { value: "OGL", label: "OpenGL" },
      { value: "D3D", label: "Direct3D 11" },
      { value: "D3D12", label: "Direct3D 12" },
      { value: "Software Renderer", label: "Software" },
    ],
  },
];

// ── Cemu (Wii U) — settings.xml <Graphic> ────────────────────────────────────
const CEMU_SETTINGS: SettingDef[] = [
  {
    key: "api",
    label: "Renderer",
    type: "enum",
    group: "Video",
    hint: "Vulkan is recommended for most GPUs.",
    options: [
      { value: "1", label: "Vulkan" },
      { value: "0", label: "OpenGL" },
    ],
  },
  {
    key: "VSync",
    label: "V-Sync",
    type: "enum",
    group: "Performance",
    options: [
      { value: "0", label: "Off" },
      { value: "1", label: "Double buffering" },
      { value: "2", label: "Triple buffering" },
    ],
  },
  {
    key: "UpscaleFilter",
    label: "Upscale filter",
    type: "enum",
    group: "Video",
    options: [
      { value: "0", label: "Bilinear" },
      { value: "1", label: "Bicubic" },
      { value: "2", label: "Hermite" },
      { value: "3", label: "Nearest Neighbor" },
    ],
  },
  {
    key: "DownscaleFilter",
    label: "Downscale filter",
    type: "enum",
    group: "Video",
    options: [
      { value: "0", label: "Bilinear" },
      { value: "1", label: "Point" },
    ],
  },
  {
    key: "FullscreenScaling",
    label: "Fullscreen scaling",
    type: "enum",
    group: "Video",
    options: [
      { value: "0", label: "Keep aspect ratio" },
      { value: "1", label: "Stretch" },
    ],
  },
  {
    key: "AsyncCompile",
    label: "Async shader compile",
    type: "enum",
    group: "Performance",
    hint: "Compiles shaders in the background to reduce stutter (Vulkan).",
    options: [
      { value: "true", label: "On" },
      { value: "false", label: "Off" },
    ],
  },
  {
    key: "vkAccurateBarriers",
    label: "Accurate barriers (Vulkan)",
    type: "enum",
    group: "Performance",
    hint: "More accurate rendering; disable only for a small speed gain.",
    options: [
      { value: "true", label: "On" },
      { value: "false", label: "Off" },
    ],
  },
  {
    key: "GX2DrawdoneSync",
    label: "Full sync at GX2DrawDone",
    type: "enum",
    group: "Performance",
    hint: "Improves stability in some games; may reduce performance.",
    options: [
      { value: "true", label: "On" },
      { value: "false", label: "Off" },
    ],
  },
];

export const STANDALONE_SETTINGS_BY_SYSTEM: Partial<
  Record<EmulatorSystem, SettingDef[]>
> = {
  ps2: PCSX2_SETTINGS,
  ps3: RPCS3_SETTINGS,
  n3ds: AZAHAR_SETTINGS,
  wii: DOLPHIN_SETTINGS,
  gc: DOLPHIN_SETTINGS,
  wiiu: CEMU_SETTINGS,
};
