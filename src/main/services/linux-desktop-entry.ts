import path from "node:path";

const line = (value: string) =>
  value.replace(/[\r\n\0]/g, " ").replace(/\\/g, "\\\\");
export const quoteLinuxDesktopArgument = (value: string) => {
  if (/[\r\n\0]/.test(value))
    throw new Error("Invalid Linux shortcut argument");
  const quoted = value.replace(/%/g, "%%").replace(/[\\"`$]/g, "\\$&");
  return `"${quoted.replace(/\\/g, "\\\\")}"`;
};
export const getLinuxApplicationsDirectory = (
  home: string,
  env: NodeJS.ProcessEnv = process.env
) =>
  path.posix.join(
    env.XDG_DATA_HOME && path.posix.isAbsolute(env.XDG_DATA_HOME)
      ? env.XDG_DATA_HOME
      : path.posix.join(home, ".local", "share"),
    "applications"
  );
export const getLinuxLauncherExecutable = (
  execPath: string,
  env: NodeJS.ProcessEnv = process.env
) =>
  env.APPIMAGE && path.posix.isAbsolute(env.APPIMAGE) ? env.APPIMAGE : execPath;

export const buildLinuxGameDesktopEntry = ({
  name,
  executable,
  args,
  icon,
}: {
  name: string;
  executable: string;
  args: string[];
  icon?: string | null;
}) =>
  [
    "[Desktop Entry]",
    "Version=1.0",
    "Type=Application",
    `Name=${line(name)}`,
    `Exec=${[executable, ...args].map(quoteLinuxDesktopArgument).join(" ")}`,
    `Icon=${line(icon || "io.gamehub.launcher")}`,
    "Terminal=false",
    "Categories=Game;",
    "StartupNotify=false",
    "X-GameHub-Managed=true",
    "",
  ].join("\n");
