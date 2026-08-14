import path from "node:path";

import {
  OVERLAY_SUPERVISED_QA_ENV,
  OVERLAY_SUPERVISED_QA_ENV_VALUE,
  type OverlaySupervisedLaunchPolicyFailureReason,
  type OverlaySupervisedLaunchPolicyInput,
  type OverlaySupervisedLaunchPolicyResult,
  type OverlaySupervisedQaRuntime,
} from "./overlay-supervised-launch-contract";

const URI_EXECUTABLE = /^[a-z][a-z\d+.-]*:\/\//i;
const LOCAL_DRIVE_PATH = /^[a-z]:\\/i;
const SESSION_ID = /^[a-z\d_-]{32,128}$/i;
const WINDOWS_SHELL_EXECUTABLES = new Set([
  "bash.exe",
  "cmd.exe",
  "conhost.exe",
  "cscript.exe",
  "explorer.exe",
  "mshta.exe",
  "powershell.exe",
  "pwsh.exe",
  "rundll32.exe",
  "sh.exe",
  "wscript.exe",
]);

const containsNull = (value: string) => value.includes("\0");

const comparablePath = (value: string) =>
  path.win32.normalize(value).toLowerCase();

const samePath = (left: string, right: string) =>
  comparablePath(left) === comparablePath(right);

export const isValidOverlayQaSessionId = (sessionId: string) =>
  SESSION_ID.test(sessionId) && !containsNull(sessionId);

/**
 * Normalizes only an ordinary drive-qualified local `.exe` path. UNC, Win32
 * device namespaces, shell hosts and drive-root executables fail closed.
 */
export const normalizeOverlayQaExecutablePath = (
  value: string
): string | null => {
  if (!value || containsNull(value) || URI_EXECUTABLE.test(value)) return null;

  const windowsPath = value.replaceAll("/", "\\");
  // Reject UNC plus \\?\ / \\.\ device namespaces. A single-rooted NT path
  // such as \??\ or \Device\ is rejected by the drive-qualified check below.
  if (windowsPath.startsWith("\\\\")) return null;
  if (!LOCAL_DRIVE_PATH.test(windowsPath)) return null;

  const normalized = path.win32.normalize(windowsPath);
  if (!path.win32.isAbsolute(normalized)) return null;
  if (path.win32.extname(normalized).toLowerCase() !== ".exe") return null;
  if (
    WINDOWS_SHELL_EXECUTABLES.has(path.win32.basename(normalized).toLowerCase())
  ) {
    return null;
  }

  const parsed = path.win32.parse(normalized);
  if (samePath(path.win32.dirname(normalized), parsed.root)) return null;
  return normalized;
};

export const getOverlaySupervisedQaRuntimeFailure = (
  runtime: OverlaySupervisedQaRuntime
): OverlaySupervisedLaunchPolicyFailureReason | null => {
  if (runtime.platform !== "win32") return "unsupported-platform";
  if (runtime.isPackaged) return "packaged-build";
  if (
    runtime.environment[OVERLAY_SUPERVISED_QA_ENV.readOnlyVisualQa] !==
    OVERLAY_SUPERVISED_QA_ENV_VALUE
  ) {
    return "read-only-qa-required";
  }
  if (
    runtime.environment[OVERLAY_SUPERVISED_QA_ENV.supervisedLaunchQa] !==
    OVERLAY_SUPERVISED_QA_ENV_VALUE
  ) {
    return "supervised-launch-qa-required";
  }
  return null;
};

export const isOverlaySupervisedQaRuntimeAllowed = (
  runtime: OverlaySupervisedQaRuntime
) => getOverlaySupervisedQaRuntimeFailure(runtime) === null;

const classifyUnsafeExecutable = (
  value: string
): OverlaySupervisedLaunchPolicyFailureReason => {
  if (URI_EXECUTABLE.test(value)) return "protocol-executable";
  const windowsPath = value.replaceAll("/", "\\");
  if (windowsPath.startsWith("\\\\")) return "unc-or-device-path";
  if (
    !LOCAL_DRIVE_PATH.test(windowsPath) ||
    !path.win32.isAbsolute(windowsPath)
  ) {
    return "non-local-executable";
  }
  if (path.win32.extname(windowsPath).toLowerCase() !== ".exe") {
    return "non-executable-target";
  }
  if (
    WINDOWS_SHELL_EXECUTABLES.has(
      path.win32.basename(windowsPath).toLowerCase()
    )
  ) {
    return "shell-target";
  }
  const normalized = path.win32.normalize(windowsPath);
  if (
    samePath(path.win32.dirname(normalized), path.win32.parse(normalized).root)
  ) {
    return "drive-root-target";
  }
  return "non-local-executable";
};

export const evaluateOverlaySupervisedLaunchPolicy = ({
  runtime,
  sessionId,
  game,
  executablePath,
  canonicalExecutablePath,
  resolvedCommand,
  workingDirectory,
}: OverlaySupervisedLaunchPolicyInput): OverlaySupervisedLaunchPolicyResult => {
  const runtimeFailure = getOverlaySupervisedQaRuntimeFailure(runtime);
  if (runtimeFailure) return { allowed: false, reason: runtimeFailure };
  if (!isValidOverlayQaSessionId(sessionId)) {
    return { allowed: false, reason: "invalid-session-id" };
  }
  if (game.libraryOrigin !== "catalog" && game.libraryOrigin !== "custom") {
    return { allowed: false, reason: "platform-managed-title" };
  }

  const configuredExecutable = game.executablePath?.trim();
  if (!configuredExecutable) {
    return { allowed: false, reason: "missing-configured-executable" };
  }

  const normalizedConfigured =
    normalizeOverlayQaExecutablePath(configuredExecutable);
  if (!normalizedConfigured) {
    return {
      allowed: false,
      reason: classifyUnsafeExecutable(configuredExecutable),
    };
  }
  const normalizedRequested = normalizeOverlayQaExecutablePath(executablePath);
  if (!normalizedRequested) {
    return {
      allowed: false,
      reason: classifyUnsafeExecutable(executablePath),
    };
  }
  const normalizedCanonical = normalizeOverlayQaExecutablePath(
    canonicalExecutablePath
  );
  if (!normalizedCanonical) {
    return {
      allowed: false,
      reason: classifyUnsafeExecutable(canonicalExecutablePath),
    };
  }

  if (
    !samePath(normalizedConfigured, normalizedRequested) ||
    !samePath(normalizedRequested, normalizedCanonical)
  ) {
    return { allowed: false, reason: "unrelated-target-executable" };
  }

  if (
    game.nativeExecutablePath?.trim() &&
    !samePath(game.nativeExecutablePath, normalizedCanonical)
  ) {
    return { allowed: false, reason: "requires-child-propagation" };
  }
  if (
    (game.trackingExecutablePaths ?? []).some(
      (candidate) =>
        !candidate?.trim() || !samePath(candidate, normalizedCanonical)
    )
  ) {
    return { allowed: false, reason: "requires-child-propagation" };
  }

  const normalizedCommand = normalizeOverlayQaExecutablePath(
    resolvedCommand.command
  );
  if (!normalizedCommand || !samePath(normalizedCommand, normalizedCanonical)) {
    return { allowed: false, reason: "wrapper-command" };
  }
  if (
    !workingDirectory ||
    containsNull(workingDirectory) ||
    !samePath(workingDirectory, path.win32.dirname(normalizedCanonical))
  ) {
    return { allowed: false, reason: "working-directory-mismatch" };
  }
  if (Object.keys(resolvedCommand.env).length > 0) {
    return {
      allowed: false,
      reason: "environment-overrides-unsupported",
    };
  }
  if (resolvedCommand.args.some((argument) => containsNull(argument))) {
    return { allowed: false, reason: "invalid-argument" };
  }

  const args = Object.freeze([...resolvedCommand.args]);
  const env = Object.freeze({ ...resolvedCommand.env });
  return {
    allowed: true,
    plan: Object.freeze({
      sessionId,
      executablePath: normalizedRequested,
      canonicalExecutablePath: normalizedCanonical,
      command: normalizedCommand,
      args,
      workingDirectory: path.win32.dirname(normalizedCanonical),
      env,
    }),
  };
};
