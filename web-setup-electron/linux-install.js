const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const DESKTOP_ID = "io.gamehub.launcher.desktop";
const findLinuxAsset = (assets, kind, arch = process.arch) => {
  if (!["x64", "arm64"].includes(arch)) return null;
  return (
    assets.find((asset) => {
      const name = asset.name.toLowerCase();
      if (kind === "deb")
        return name.endsWith(arch === "x64" ? "_amd64.deb" : "_arm64.deb");
      if (kind === "rpm")
        return name.endsWith(arch === "x64" ? ".x86_64.rpm" : ".aarch64.rpm");
      if (!name.endsWith(".appimage") || name.includes("websetup"))
        return false;
      return arch === "arm64"
        ? /(?:arm64|aarch64)/.test(name)
        : !/(?:arm64|aarch64|i[3-6]86)/.test(name);
    }) ?? null
  );
};
const cleanLine = (value) => String(value).replace(/[\r\n\0]/g, " ");
// Exec quoting has two escaping layers: desktop-entry string decoding, then
// argv quoting. Percent signs must not become field codes in a literal path.
const quoteDesktopArgument = (value) => {
  if (/[\r\n\0]/.test(value))
    throw new Error("Invalid desktop entry argument.");
  const quoted = value.replace(/%/g, "%%").replace(/[\\"`$]/g, "\\$&");
  return `"${quoted.replace(/\\/g, "\\\\")}"`;
};
const getLinuxInstallPaths = (home = os.homedir(), env = process.env) => {
  const data =
    env.XDG_DATA_HOME && path.posix.isAbsolute(env.XDG_DATA_HOME)
      ? env.XDG_DATA_HOME
      : path.posix.join(home, ".local", "share");
  return {
    directory: path.posix.join(data, "GameHub"),
    applications: path.posix.join(data, "applications"),
    icon: path.posix.join(
      data,
      "icons",
      "hicolor",
      "256x256",
      "apps",
      "io.gamehub.launcher.png"
    ),
    command: path.posix.join(home, ".local", "bin", "gamehub"),
  };
};

const resolveLinuxPackageManager = ({
  exists = fs.existsSync,
  release = "",
} = {}) => {
  // Immutable gaming distros must not be modified with dnf/apt merely because
  // a command exists. A user-owned AppImage works without changing the OS.
  if (
    exists("/run/ostree-booted") ||
    /(?:^|\n)(?:ID|ID_LIKE|VARIANT_ID)=.*(?:steamos|bazzite|silverblue|kinoite)/i.test(
      release
    )
  )
    return "appimage";
  if (exists("/usr/bin/apt-get")) return "apt";
  if (exists("/usr/bin/dnf")) return "dnf";
  if (exists("/usr/bin/zypper")) return "zypper";
  return "appimage";
};

const getLinuxPackageCommand = (
  manager,
  packagePath,
  exists = fs.existsSync
) => {
  if (!path.posix.isAbsolute(packagePath) || /[\0\r\n]/.test(packagePath))
    throw new Error("Invalid package path.");
  const commands = {
    apt: ["/usr/bin/apt-get", "install", "-y", "--", packagePath],
    dnf: ["/usr/bin/dnf", "install", "-y", "--", packagePath],
    zypper: [
      "/usr/bin/zypper",
      "--non-interactive",
      "install",
      "--",
      packagePath,
    ],
  };
  if (!commands[manager] || !exists("/usr/bin/pkexec")) return null;
  return { command: "/usr/bin/pkexec", args: commands[manager] };
};

const createLinuxDesktopEntry = (executable, icon) =>
  [
    "[Desktop Entry]",
    "Type=Application",
    "Name=GameHub",
    `Exec=${quoteDesktopArgument(executable)} %U`,
    ...(icon ? [`Icon=${cleanLine(icon).replace(/\\/g, "\\\\")}`] : []),
    "Terminal=false",
    "Categories=Game;",
    "StartupWMClass=GameHub",
    "MimeType=x-scheme-handler/hydralauncher;",
    "X-GameHub-Managed=true",
    "Actions=BigPicture;",
    "",
    "[Desktop Action BigPicture]",
    "Name=Big Picture",
    `Exec=${quoteDesktopArgument(executable)} --big-picture`,
    "",
  ].join("\n");

const publishFile = async (destination, writer, mode, replace = true) => {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.download-${crypto.randomUUID()}`;
  try {
    await writer(temporary);
    if (mode) await fs.promises.chmod(temporary, mode);
    if (replace) await fs.promises.rename(temporary, destination);
    else await fs.promises.link(temporary, destination);
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
};

const readExistingFile = async (file) => {
  try {
    const stat = await fs.promises.lstat(file);
    return {
      stat,
      contents: stat.isFile() ? await fs.promises.readFile(file) : null,
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

// Icons are stored inside GameHub's installation under a content-addressed
// filename. Never replace an unrelated user-owned hicolor/theme icon.
const installPrivateIcon = async (directory, iconSource) => {
  const bytes = await fs.promises.readFile(iconSource);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  const icon = path.join(directory, `gamehub-icon-${digest}.png`);
  const existing = await readExistingFile(icon);
  if (existing) {
    if (existing.contents?.equals(bytes)) return icon;
    throw new Error(
      "GameHub's icon path is occupied by another file; the existing file was preserved."
    );
  }
  await publishFile(
    icon,
    (file) => fs.promises.writeFile(file, bytes),
    0o644,
    false
  );
  return icon;
};

const installLinuxAppImage = async ({
  directory,
  portable = false,
  download,
  iconSource,
  home = os.homedir(),
  env = process.env,
}) => {
  if (!path.isAbsolute(directory) || /[\0\r\n]/.test(directory))
    throw new Error("Choose an absolute installation folder.");
  if (portable && fs.existsSync(directory) && fs.readdirSync(directory).length)
    throw new Error(
      "Choose an empty folder for GameHub Portable so existing files stay safe."
    );
  const executable = path.join(directory, "GameHub.AppImage");
  await publishFile(executable, download, 0o755);
  if (portable) {
    await fs.promises.writeFile(path.join(directory, "portable"), "", {
      flag: "wx",
    });
    return { executable, directory, warnings: [] };
  }
  const locations = getLinuxInstallPaths(home, env);
  const warnings = [];
  const desktopFile = path.join(locations.applications, DESKTOP_ID);
  const existingDesktop = await readExistingFile(desktopFile);
  const managedDesktop =
    existingDesktop?.contents &&
    /^X-GameHub-Managed=true\s*$/m.test(
      existingDesktop.contents.toString("utf8")
    );
  let desktopEntryCreated = false;
  if (!existingDesktop || managedDesktop) {
    const icon = await installPrivateIcon(directory, iconSource);
    try {
      await publishFile(
        desktopFile,
        (file) =>
          fs.promises.writeFile(
            file,
            createLinuxDesktopEntry(executable, icon)
          ),
        0o644,
        Boolean(existingDesktop)
      );
      desktopEntryCreated = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      // Another program created the entry while the download was finishing.
    }
  }
  if (!desktopEntryCreated) {
    warnings.push(
      "The existing applications-menu entry was preserved; no GameHub menu entry was created. Use Launch GameHub below or open the installed AppImage."
    );
  }
  const launchHint = desktopEntryCreated
    ? "Use the applications menu to launch GameHub."
    : "Use Launch GameHub below or open the installed AppImage.";
  await fs.promises.mkdir(path.dirname(locations.command), { recursive: true });
  try {
    const existing = await fs.promises
      .lstat(locations.command)
      .catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (!existing) await fs.promises.symlink(executable, locations.command);
    else if (
      !existing.isSymbolicLink() ||
      path.resolve(
        path.dirname(locations.command),
        await fs.promises.readlink(locations.command)
      ) !== path.resolve(executable)
    ) {
      warnings.push(
        `The existing gamehub command was preserved. ${launchHint}`
      );
    }
  } catch {
    warnings.push(`The command shortcut could not be created. ${launchHint}`);
  }
  return {
    executable,
    directory,
    desktopFile: desktopEntryCreated ? desktopFile : null,
    desktopEntryCreated,
    warnings,
  };
};

/** Spawn is only an OS handoff, not proof that the AppImage runtime started.
 * Keep setup alive through a short grace interval to catch missing FUSE and
 * other immediate nonzero exits. A clean early exit may hand off to an already
 * running GameHub instance and is therefore successful. No sandbox overrides. */
const launchLinuxAppImage = (
  executable,
  { spawnProcess = spawn, startupGraceMs = 2000 } = {}
) =>
  new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(executable, [], { detached: true, stdio: "ignore" });
    } catch (error) {
      reject(error);
      return;
    }
    let timer;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("spawn", onSpawn);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      if (error) reject(error);
      else {
        child.unref();
        resolve(child);
      }
    };
    const onSpawn = () => {
      timer = setTimeout(() => finish(), startupGraceMs);
    };
    const onError = (error) =>
      finish(
        new Error(
          `GameHub could not launch (${error.code ?? "process error"}). The installation is intact. Check AppImage/FUSE support and executable permissions.`
        )
      );
    const onExit = (code, signal) =>
      finish(
        code === 0
          ? null
          : new Error(
              `GameHub exited before startup completed (${signal ?? `code ${code}`}). The installation is intact. Check AppImage/FUSE support on this Linux system.`
            )
      );
    child.once("spawn", onSpawn);
    child.once("error", onError);
    child.once("exit", onExit);
  });

module.exports = {
  DESKTOP_ID,
  findLinuxAsset,
  quoteDesktopArgument,
  getLinuxInstallPaths,
  resolveLinuxPackageManager,
  getLinuxPackageCommand,
  createLinuxDesktopEntry,
  installLinuxAppImage,
  launchLinuxAppImage,
};
