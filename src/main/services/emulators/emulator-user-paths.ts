import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface EmulatorUserPaths {
  data: string;
  config: string;
  portable: boolean;
}

interface PathOptions {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
  exists?: (target: string) => boolean;
  pcsx2AppImage?: boolean;
}

const flatpakIds: Record<string, string> = {
  pcsx2: "net.pcsx2.PCSX2",
  duckstation: "org.duckstation.DuckStation",
  rpcs3: "net.rpcs3.RPCS3",
  azahar: "org.azahar_emu.Azahar",
  dolphin: "org.DolphinEmu.dolphin-emu",
  cemu: "info.cemu.Cemu",
  ralibretro: "org.libretro.RetroArch",
};

/** Resolve the emulator's actual data/config directories, not /usr/bin or a
 * Flatpak export directory. The split matters: Dolphin, Azahar and Cemu keep
 * native Linux configuration and saves in different XDG roots. */
export const emulatorUserPaths = (
  binary: string,
  installDir: string,
  options: PathOptions = {}
): EmulatorUserPaths => {
  const platform = options.platform ?? process.platform;
  const p = platform === "linux" ? path.posix : path;
  const home = options.home ?? os.homedir();
  const env = options.env ?? process.env;
  const exists = options.exists ?? fs.existsSync;
  const directory = (target: string) => {
    if (options.exists) return options.exists(target);
    try {
      return fs.statSync(target).isDirectory();
    } catch {
      return false;
    }
  };
  const flatpakId = /\/flatpak\/exports\/bin\/?$/.test(installDir)
    ? flatpakIds[binary]
    : undefined;
  const sandbox = flatpakId ? p.join(home, ".var", "app", flatpakId) : null;
  const absoluteEnv = (key: string, fallback: string) =>
    env[key] && p.isAbsolute(env[key]!) ? env[key]! : fallback;
  const dataHome = sandbox
    ? p.join(sandbox, "data")
    : absoluteEnv("XDG_DATA_HOME", p.join(home, ".local", "share"));
  const configHome = sandbox
    ? p.join(sandbox, "config")
    : absoluteEnv("XDG_CONFIG_HOME", p.join(home, ".config"));
  const portable = (data: string, config = data): EmulatorUserPaths => ({
    data,
    config,
    portable: true,
  });
  const native = (name: string, configOnly = false): EmulatorUserPaths => ({
    data: p.join(configOnly ? configHome : dataHome, name),
    config: p.join(configHome, name),
    portable: false,
  });
  // Preserve established Windows portable behavior. On Linux only honor a
  // marker that already exists; configuring a detected emulator must never
  // silently switch it away from the user's existing save tree.
  switch (binary) {
    case "ralibretro":
      return platform === "linux"
        ? native("retroarch", true)
        : portable(installDir);
    case "dolphin": {
      const user = p.join(installDir, "User");
      if (
        platform !== "linux" ||
        (!sandbox && exists(p.join(installDir, "portable.txt")))
      )
        return portable(user, p.join(user, "Config"));
      const override = !sandbox && env.DOLPHIN_EMU_USERPATH;
      if (override && p.isAbsolute(override))
        return portable(override, p.join(override, "Config"));
      const legacy = p.join(home, ".dolphin-emu");
      if (!sandbox && directory(legacy))
        return portable(legacy, p.join(legacy, "Config"));
      return native("dolphin-emu");
    }
    case "azahar":
    case "eden": {
      const user = p.join(installDir, "user");
      if (platform !== "linux" || (!sandbox && directory(user)))
        return portable(user, p.join(user, "config"));
      return native(binary);
    }
    case "cemu": {
      const root = p.join(installDir, "portable");
      if (!sandbox && directory(root)) return portable(root);
      return platform === "linux" ? native("Cemu") : portable(installDir);
    }
    case "rpcs3": {
      const root = p.join(installDir, "portable");
      if (platform === "linux" && !sandbox && directory(root))
        return portable(root);
      return platform === "linux"
        ? native("rpcs3", true)
        : portable(installDir);
    }
    case "pcsx2": {
      let appImage = options.pcsx2AppImage ?? false;
      if (
        platform === "linux" &&
        !sandbox &&
        options.pcsx2AppImage === undefined
      ) {
        try {
          appImage = fs
            .readdirSync(installDir)
            .some((name) => /^pcsx2.*\.appimage$/i.test(name));
        } catch {
          /* Native package directory. */
        }
      }
      if (platform === "linux" && appImage) {
        // PCSX2's AppImage mounts its executable elsewhere. A marker beside
        // the AppImage does NOT enable portable mode. Honor an already-used
        // portable data tree and explicitly pass -portable at launch; otherwise
        // keep the existing native XDG data (never silently orphan saves).
        const root = p.join(installDir, "PCSX2");
        if (exists(p.join(root, "inis", "PCSX2.ini")))
          return portable(root, p.join(root, "inis"));
        const roots = native("PCSX2", true);
        return { ...roots, config: p.join(roots.config, "inis") };
      }
      if (
        platform !== "linux" ||
        (!sandbox && exists(p.join(installDir, "portable.ini")))
      )
        return portable(installDir, p.join(installDir, "inis"));
      const roots = native("PCSX2", true);
      return { ...roots, config: p.join(roots.config, "inis") };
    }
    case "duckstation": {
      if (
        platform !== "linux" ||
        (!sandbox && exists(p.join(installDir, "portable.txt")))
      )
        return portable(installDir);
      const roots = native("duckstation");
      return { ...roots, config: roots.data };
    }
    default:
      return portable(installDir);
  }
};

export const emulatorConfigFile = (
  binary: string,
  installDir: string,
  file: string
) => path.join(emulatorUserPaths(binary, installDir).config, file);

/** A user-configured Cemu MLC destination is authoritative for its saves. */
export const cemuMlcDir = (installDir: string): string => {
  const roots = emulatorUserPaths("cemu", installDir);
  try {
    const xml = fs.readFileSync(
      path.join(roots.config, "settings.xml"),
      "utf8"
    );
    const value = /<mlc_path>\s*([^<]*?)\s*<\/mlc_path>/i
      .exec(xml)?.[1]
      ?.trim();
    if (value) {
      const decoded = value.replace(
        /&(amp|quot|apos|lt|gt);/g,
        (_all, entity: string) =>
          ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" })[entity]!
      );
      if (!decoded.includes("\0")) return path.resolve(roots.data, decoded);
    }
  } catch {
    /* Cemu has not created its configuration yet. */
  }
  return path.join(roots.data, "mlc01");
};
