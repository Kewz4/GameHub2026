import path from "node:path";

/** Interpret persisted Windows paths independently of the OS running the test
 * or launcher. POSIX paths retain case: /Games/Foo and /games/foo differ. */
export const isWindowsProcessPath = (value: string) =>
  /^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\");

export const normalizeProcessPath = (value: string) =>
  isWindowsProcessPath(value)
    ? path.win32.normalize(value).replaceAll("\\", "/").toLowerCase()
    : path.posix.normalize(value);

export const processPathBasename = (value: string) =>
  path.posix.basename(normalizeProcessPath(value));

export const processPathDirectory = (value: string) =>
  path.posix.dirname(normalizeProcessPath(value));

export const isProcessPathWithinDirectory = (
  candidate: string,
  directory: string
) => {
  const relative = path.posix.relative(
    normalizeProcessPath(directory),
    normalizeProcessPath(candidate)
  );
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith("../") &&
    !path.posix.isAbsolute(relative)
  );
};
