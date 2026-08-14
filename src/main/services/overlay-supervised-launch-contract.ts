export const OVERLAY_SUPERVISED_QA_ENV = {
  readOnlyVisualQa: "GAMEHUB_READ_ONLY_VISUAL_QA",
  supervisedLaunchQa: "GAMEHUB_OVERLAY_SUPERVISED_LAUNCH_QA",
} as const;

export const OVERLAY_SUPERVISED_QA_ENV_VALUE = "true";

export type OverlaySupervisedLaunchPhase =
  | "suspended"
  | "prepared"
  | "resumed"
  | "interactive";

export interface OverlaySupervisedQaRuntime {
  platform: string;
  isPackaged: boolean;
  environment: Readonly<Record<string, string | undefined>>;
}

export interface OverlaySupervisedLaunchGame {
  libraryOrigin?: "sync" | "catalog" | "custom";
  executablePath?: string | null;
  nativeExecutablePath?: string | null;
  trackingExecutablePaths?: readonly string[] | null;
}

export interface OverlaySupervisedResolvedCommand {
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
}

/**
 * Input to the QA-only direct-process launch policy.
 *
 * `canonicalExecutablePath` must come from a trusted filesystem/native
 * resolver. The policy intentionally requires it to match the configured and
 * resolved executable exactly; following a junction or handing supervision to
 * a renderer child belongs to a later supervisor version.
 */
export interface OverlaySupervisedLaunchPolicyInput {
  runtime: OverlaySupervisedQaRuntime;
  sessionId: string;
  game: OverlaySupervisedLaunchGame;
  executablePath: string;
  canonicalExecutablePath: string;
  resolvedCommand: OverlaySupervisedResolvedCommand;
  workingDirectory: string;
}

export interface OverlaySupervisedLaunchPlan {
  sessionId: string;
  executablePath: string;
  canonicalExecutablePath: string;
  command: string;
  args: readonly string[];
  workingDirectory: string;
  env: Readonly<Record<string, string>>;
}

export type OverlaySupervisedLaunchPolicyFailureReason =
  | "unsupported-platform"
  | "packaged-build"
  | "read-only-qa-required"
  | "supervised-launch-qa-required"
  | "invalid-session-id"
  | "platform-managed-title"
  | "missing-configured-executable"
  | "protocol-executable"
  | "non-local-executable"
  | "unc-or-device-path"
  | "non-executable-target"
  | "shell-target"
  | "drive-root-target"
  | "unrelated-target-executable"
  | "requires-child-propagation"
  | "wrapper-command"
  | "working-directory-mismatch"
  | "environment-overrides-unsupported"
  | "invalid-argument";

export type OverlaySupervisedLaunchPolicyResult =
  | { allowed: true; plan: OverlaySupervisedLaunchPlan }
  | {
      allowed: false;
      reason: OverlaySupervisedLaunchPolicyFailureReason;
    };

/** Exact identity used for every state transition and native revalidation. */
export interface OverlayQaSupervisedTargetIdentity {
  sessionId: string;
  pid: number;
  creationTicks: string;
  canonicalExecutablePath: string;
}

export interface OverlayQaAuthorizationState
  extends OverlayQaSupervisedTargetIdentity {
  phase: OverlaySupervisedLaunchPhase;
}
