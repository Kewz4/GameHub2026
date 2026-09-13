import fs from "node:fs";
import path from "node:path";
import type { ControllerProfile, PadControl } from "@types";
import { emulatorUserPaths } from "./emulator-user-paths";
import { LIBRETRO_CORE_MAP } from "./libretro-core-map";

/** The persisted ralibretro identity represents the shared libretro frontend.
 * Windows retains RALibretro; Linux uses actual RetroArch native .so cores. */
export const LINUX_RETRO_CORES: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(LIBRETRO_CORE_MAP).map(([system, { core }]) => [
      system,
      core,
    ])
  );
const CORE_LIBRARY_NAMES: Readonly<Record<string, string>> = {
  ps1: "Beetle PSX",
  psp: "PPSSPP",
  gb: "mGBA",
  gbc: "mGBA",
  gba: "mGBA",
  n64: "Mupen64Plus-Next",
  nds: "melonDS DS",
  dsi: "melonDS DS",
};

export const parseRetroArchConfig = (
  contents: string
): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*([a-zA-Z0-9_+.-]+)\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(line);
    if (match) {
      try {
        result[match[1]] = JSON.parse(`"${match[2]}"`);
      } catch {
        /* malformed value */
      }
    }
  }
  return result;
};

export const serializeRetroArchConfig = (
  values: Record<string, string>
): string =>
  Object.entries(values)
    .filter(([key]) => /^[a-zA-Z0-9_+.-]+$/.test(key))
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    .join("\n") + "\n";

const readConfig = (file: string) => {
  try {
    return parseRetroArchConfig(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
};

const configPath = (installDir: string) =>
  path.join(
    emulatorUserPaths("ralibretro", installDir).config,
    "retroarch.cfg"
  );

const configuredDirectory = (
  value: string | undefined,
  configFile: string
): string | null => {
  if (!value || value === "default") return null;
  // RetroArch's :/ alias is relative to the loaded configuration directory.
  return path.resolve(
    path.dirname(configFile),
    value.startsWith(":/") ? value.slice(2) : value
  );
};

export const retroArchSaveRoots = (
  installDir: string,
  romPath?: string | null,
  system?: string
): string[] => {
  const file = configPath(installDir);
  const cfg = readConfig(file);
  const configured = configuredDirectory(cfg.savefile_directory, file);
  let root =
    (cfg.savefiles_in_content_dir === "true" && romPath
      ? path.dirname(romPath)
      : configured) ??
    (romPath ? path.dirname(romPath) : path.join(path.dirname(file), "saves"));
  if (system && cfg.sort_savefiles_by_content_enable === "true" && romPath)
    root = path.join(root, path.basename(path.dirname(romPath)));
  if (
    system &&
    cfg.sort_savefiles_enable !== "false" &&
    CORE_LIBRARY_NAMES[system]
  )
    root = path.join(root, CORE_LIBRARY_NAMES[system]);
  return [root];
};

export const retroArchSystemDirectory = (installDir: string): string => {
  const file = configPath(installDir);
  return (
    configuredDirectory(readConfig(file).system_directory, file) ??
    path.join(path.dirname(file), "system")
  );
};

export const retroArchCoreOptionsFile = (installDir: string, system: string) =>
  path.join(path.dirname(configPath(installDir)), "gamehub", `${system}.opt`);

export const readRetroArchCoreOptions = (
  installDir: string,
  system: string
) => {
  const file = configPath(installDir);
  const cfg = readConfig(file);
  const nativeOptions =
    configuredDirectory(cfg.core_options_path, file) ??
    path.join(path.dirname(file), "retroarch-core-options.cfg");
  return {
    ...readConfig(nativeOptions),
    ...readConfig(retroArchCoreOptionsFile(installDir, system)),
  };
};

export const writeRetroArchCoreOptions = (
  installDir: string,
  system: string,
  values: Record<string, string>
) => {
  if (!(system in LINUX_RETRO_CORES)) return false;
  const file = retroArchCoreOptionsFile(installDir, system);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    serializeRetroArchConfig({
      ...readRetroArchCoreOptions(installDir, system),
      ...values,
    })
  );
  return true;
};

export const retroArchControllerConfig = (
  profile: ControllerProfile
): Record<string, string> => {
  const buttons: Record<string, string> = {
    a: "0",
    b: "1",
    x: "2",
    y: "3",
    back: "4",
    guide: "5",
    start: "6",
    leftstick: "7",
    rightstick: "8",
    leftshoulder: "9",
    rightshoulder: "10",
    dpup: "11",
    dpdown: "12",
    dpleft: "13",
    dpright: "14",
  };
  const axes: Record<string, string> = {
    "-leftx": "-0",
    "+leftx": "+0",
    "-lefty": "-1",
    "+lefty": "+1",
    "-rightx": "-2",
    "+rightx": "+2",
    "-righty": "-3",
    "+righty": "+3",
    lefttrigger: "+4",
    righttrigger: "+5",
  };
  const controls: Record<string, PadControl> = {
    b: "a",
    a: "b",
    y: "x",
    x: "y",
    up: "up",
    down: "down",
    left: "left",
    right: "right",
    l: "l1",
    r: "r1",
    l2: "l2",
    r2: "r2",
    l3: "l3",
    r3: "r3",
    select: "select",
    start: "start",
    l_x_minus: "lstick_left",
    l_x_plus: "lstick_right",
    l_y_minus: "lstick_up",
    l_y_plus: "lstick_down",
    r_x_minus: "rstick_left",
    r_x_plus: "rstick_right",
    r_y_minus: "rstick_up",
    r_y_plus: "rstick_down",
  };
  const config: Record<string, string> = {
    input_joypad_driver: "sdl2",
    input_player1_joypad_index: String(profile.controllerIndex),
  };
  for (const [target, control] of Object.entries(controls)) {
    const token = profile.bindings[control];
    config[`input_player1_${target}_btn`] = buttons[token] ?? "nul";
    config[`input_player1_${target}_axis`] = axes[token] ?? "nul";
  }
  return config;
};

export const writeRetroArchController = (
  installDir: string,
  profile: ControllerProfile
): boolean => {
  const file = path.join(
    path.dirname(configPath(installDir)),
    "gamehub",
    "controller.cfg"
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    serializeRetroArchConfig(retroArchControllerConfig(profile))
  );
  return true;
};

export const findRetroArchCorePath = (
  installDir: string,
  system: string
): string | null => {
  const core = LINUX_RETRO_CORES[system];
  if (!core) return null;
  const file = configPath(installDir);
  const cfg = readConfig(file);
  const flatpak = /\/flatpak\/exports\/bin\/?$/.test(installDir);
  const directories = [
    configuredDirectory(cfg.libretro_directory, file),
    path.join(path.dirname(file), "cores"),
    ...(!flatpak
      ? [
          path.join(installDir, "cores"),
          "/usr/lib/libretro",
          "/usr/lib64/libretro",
          "/usr/lib/x86_64-linux-gnu/libretro",
          "/usr/lib/aarch64-linux-gnu/libretro",
        ]
      : []),
  ];
  return (
    directories
      .filter((dir): dir is string => !!dir)
      .map((dir) => path.join(dir, `${core}.so`))
      .find((candidate) => {
        try {
          return fs.statSync(candidate).isFile();
        } catch {
          return false;
        }
      }) ?? null
  );
};

export const buildRetroArchLaunch = (
  installDir: string,
  system: string,
  romPath: string,
  login?: { username?: string; token?: string }
): string[] => {
  const core = LINUX_RETRO_CORES[system];
  if (!core) throw new Error(`No Linux libretro core is mapped for ${system}`);
  const file = configPath(installDir);
  const coreFile = findRetroArchCorePath(installDir, system);
  if (!coreFile)
    throw new Error(
      `RetroArch core ${core}.so is missing. Install it with RetroArch's Online Updater → Core Downloader or your Linux package manager, then retry.`
    );
  if (system === "nds" || system === "dsi") {
    writeRetroArchCoreOptions(installDir, system, {
      melonds_console_mode: system === "dsi" ? "dsi" : "ds",
    });
  }
  const overrides: Record<string, string> = {
    config_save_on_exit: "false",
    video_windowed_fullscreen: "true",
    savefile_directory: retroArchSaveRoots(installDir, romPath, system)[0],
    // The effective location above already applies the native config's core/
    // content sorting. Do not let RetroArch append those directory names twice.
    sort_savefiles_enable: "false",
    sort_savefiles_by_content_enable: "false",
    savefiles_in_content_dir: "false",
    system_directory: retroArchSystemDirectory(installDir),
  };
  const customCoreOptions = retroArchCoreOptionsFile(installDir, system);
  if (fs.existsSync(customCoreOptions))
    overrides.core_options_path = customCoreOptions;
  // This is the explicit login2 token, never the RetroAchievements web API
  // key. Preserve an emulator-side login when GameHub has no login token.
  if (login?.username?.trim() && login.token?.trim()) {
    overrides.cheevos_enable = "true";
    overrides.cheevos_username = login.username.trim();
    overrides.cheevos_token = login.token.trim();
  }
  const controller = path.join(path.dirname(file), "gamehub", "controller.cfg");
  Object.assign(overrides, readConfig(controller));
  const launchFile = path.join(
    path.dirname(file),
    "gamehub",
    `${system}-launch.cfg`
  );
  fs.mkdirSync(path.dirname(launchFile), { recursive: true });
  fs.writeFileSync(launchFile, serializeRetroArchConfig(overrides), {
    mode: 0o600,
  });
  if (process.platform === "linux") fs.chmodSync(launchFile, 0o600);
  return [
    "--fullscreen",
    "--appendconfig",
    launchFile,
    "-L",
    coreFile,
    romPath,
  ];
};
