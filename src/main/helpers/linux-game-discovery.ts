import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const linuxGameRoots = (home = os.homedir()): string[] => [
  path.posix.join(home, "Games"),
  path.posix.join(home, "games"),
  path.posix.join(home, "GOG Games"),
  path.posix.join(home, "Applications"),
];

export const linuxSteamRoots = (
  home = os.homedir(),
  env = process.env
): string[] => {
  const data =
    env.XDG_DATA_HOME && path.posix.isAbsolute(env.XDG_DATA_HOME)
      ? env.XDG_DATA_HOME
      : path.posix.join(home, ".local", "share");
  return [
    path.posix.join(data, "Steam"),
    path.posix.join(home, ".steam", "steam"),
    path.posix.join(home, ".steam", "root"),
    path.posix.join(
      home,
      ".var",
      "app",
      "com.valvesoftware.Steam",
      ".local",
      "share",
      "Steam"
    ),
  ];
};

/** Extensionless ELF games and executable scripts are common on Linux. Inspect
 * their headers; never mistake a ROM, shared library or arbitrary text for a
 * game, and never execute files while scanning. */
export const isLinuxLaunchableFile = (file: string): boolean => {
  if (/\.so(?:\.|$)/i.test(path.basename(file))) return false;
  let handle: number | null = null;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || (stat.mode & 0o111) === 0) return false;
    handle = fs.openSync(file, "r");
    const header = Buffer.alloc(4);
    const read = fs.readSync(handle, header, 0, 4, 0);
    return (
      (read >= 4 && header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) ||
      (read >= 2 && header[0] === 0x23 && header[1] === 0x21)
    );
  } catch {
    return false;
  } finally {
    if (handle !== null) fs.closeSync(handle);
  }
};
