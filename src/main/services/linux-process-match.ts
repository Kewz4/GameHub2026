import path from "node:path";

export interface LinuxProcessInfo {
  name: string;
  cwd: string;
  exe: string;
  pid: number;
  appImagePath: string | null;
  steamCompatDataPath: string | null;
}

export const hasLinuxNativeOrAppImageMatch = (
  executablePath: string,
  linuxProcesses: LinuxProcessInfo[]
) => {
  const target = path.posix.normalize(executablePath);

  return linuxProcesses.some(
    (matchedProcess) =>
      (matchedProcess.exe &&
        path.posix.normalize(matchedProcess.exe) === target) ||
      (matchedProcess.appImagePath &&
        path.posix.normalize(matchedProcess.appImagePath) === target)
  );
};

interface ProcessLocation {
  cwd?: string | null;
  exe?: string | null;
  appImagePath?: string | null;
}

export const processReferencesExecutable = (
  matchedProcess: ProcessLocation,
  executablePath: string
) => {
  const target = path.posix.normalize(executablePath);
  const gameDirectory = path.posix.dirname(target);
  const executable = matchedProcess.exe
    ? path.posix.normalize(matchedProcess.exe)
    : null;
  const sameWineDirectory =
    /\.exe$/i.test(target) &&
    Boolean(
      matchedProcess.cwd &&
        path.posix.normalize(matchedProcess.cwd) === gameDirectory
    ) &&
    Boolean(
      executable &&
        /^wine(?:64)?(?:-preloader)?$/i.test(path.posix.basename(executable))
    );

  return (
    sameWineDirectory ||
    executable === target ||
    Boolean(
      matchedProcess.appImagePath &&
        path.posix.normalize(matchedProcess.appImagePath) === target
    )
  );
};

export const hasLaunchedPidMatch = (
  launchedPid: number | undefined,
  executablePath: string,
  pidToProcess: Map<number, LinuxProcessInfo>
) => {
  if (launchedPid === undefined) return false;

  const matchedProcess = pidToProcess.get(launchedPid);
  if (!matchedProcess) return false;

  return processReferencesExecutable(matchedProcess, executablePath);
};
