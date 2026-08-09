/**
 * Returns a user-facing form of a local filesystem path.
 *
 * Windows may expose absolute paths with its extended-length prefix (`\\\\?\\`),
 * which is useful for filesystem calls but distracting in the UI. This helper is
 * intentionally presentation-only: callers must retain the original path for
 * storage and filesystem operations.
 */
export const formatLocalPathForDisplay = (path: string) => {
  const normalized = path.replaceAll("\\", "/");

  if (normalized.toLowerCase().startsWith("//?/unc/")) {
    return `\\\\${normalized.slice(8).replaceAll("/", "\\")}`;
  }

  const withoutExtendedPrefix = normalized.startsWith("//?/")
    ? normalized.slice(4)
    : normalized;

  if (/^[a-zA-Z]:\//.test(withoutExtendedPrefix)) {
    return withoutExtendedPrefix.replaceAll("/", "\\");
  }

  return path;
};
