import type {
  OverlayQaAuthorizationState,
  OverlayQaSupervisedTargetIdentity,
  OverlaySupervisedLaunchPhase,
  OverlaySupervisedQaRuntime,
} from "./overlay-supervised-launch-contract";
import {
  isOverlaySupervisedQaRuntimeAllowed,
  isValidOverlayQaSessionId,
  normalizeOverlayQaExecutablePath,
} from "./overlay-supervised-launch-policy";

const MAX_WINDOWS_PID = 0xffff_ffff;
const MAX_CREATION_TICKS = 0xffff_ffff_ffff_ffffn;
const CREATION_TICKS = /^[1-9]\d*$/;
const VOLUME_SERIAL = /^(?!0{16}$)[0-9A-F]{16}$/u;
const FILE_ID = /^(?!0{32}$)[0-9A-F]{32}$/u;

export type OverlayQaRuntimeProvider = () => OverlaySupervisedQaRuntime;

const normalizeIdentity = (
  identity: OverlayQaSupervisedTargetIdentity
): OverlayQaSupervisedTargetIdentity | null => {
  if (!isValidOverlayQaSessionId(identity.sessionId)) return null;
  if (
    !Number.isInteger(identity.pid) ||
    identity.pid <= 4 ||
    identity.pid > MAX_WINDOWS_PID
  ) {
    return null;
  }
  if (!CREATION_TICKS.test(identity.creationTicks)) return null;
  try {
    if (BigInt(identity.creationTicks) > MAX_CREATION_TICKS) return null;
  } catch {
    return null;
  }
  const canonicalExecutablePath = normalizeOverlayQaExecutablePath(
    identity.canonicalExecutablePath
  );
  if (
    !canonicalExecutablePath ||
    !VOLUME_SERIAL.test(identity.volumeSerial) ||
    !FILE_ID.test(identity.fileId)
  ) {
    return null;
  }
  return Object.freeze({
    sessionId: identity.sessionId,
    pid: identity.pid,
    creationTicks: identity.creationTicks,
    canonicalExecutablePath,
    volumeSerial: identity.volumeSerial,
    fileId: identity.fileId,
  });
};

const sameIdentity = (
  left: OverlayQaSupervisedTargetIdentity,
  right: OverlayQaSupervisedTargetIdentity
) =>
  left.sessionId === right.sessionId &&
  left.pid === right.pid &&
  left.creationTicks === right.creationTicks &&
  left.canonicalExecutablePath === right.canonicalExecutablePath &&
  left.volumeSerial === right.volumeSerial &&
  left.fileId === right.fileId;

/**
 * Process-lifetime, one-session-at-a-time authorization for the unpackaged QA
 * supervisor. Every operation is fenced by the full process identity; a PID,
 * session ID, creation-time replay or swapped executable file can never
 * advance another target.
 */
export class OverlayQaAuthorizationRegistry {
  private active: OverlayQaAuthorizationState | null = null;
  private readonly consumedSessionIds = new Set<string>();

  public constructor(private readonly runtime: OverlayQaRuntimeProvider) {}

  public beginSuspended(identity: OverlayQaSupervisedTargetIdentity): boolean {
    if (!this.runtimeAllowed() || this.active) return false;
    const normalized = normalizeIdentity(identity);
    if (!normalized || this.consumedSessionIds.has(normalized.sessionId)) {
      return false;
    }

    this.consumedSessionIds.add(normalized.sessionId);
    this.active = Object.freeze({ ...normalized, phase: "suspended" });
    return true;
  }

  public markPrepared(identity: OverlayQaSupervisedTargetIdentity): boolean {
    return this.transition(identity, "suspended", "prepared");
  }

  public markResumed(identity: OverlayQaSupervisedTargetIdentity): boolean {
    return this.transition(identity, "prepared", "resumed");
  }

  public markInteractive(identity: OverlayQaSupervisedTargetIdentity): boolean {
    return this.transition(identity, "resumed", "interactive");
  }

  /** True only while this exact suspended target may be prepared/injected. */
  public canPrepare(identity: OverlayQaSupervisedTargetIdentity): boolean {
    return this.matches(identity, "suspended");
  }

  /** True only after the exact target completed every one-shot transition. */
  public canInteract(identity: OverlayQaSupervisedTargetIdentity): boolean {
    return this.matches(identity, "interactive");
  }

  public isCurrent(identity: OverlayQaSupervisedTargetIdentity): boolean {
    return this.matches(identity);
  }

  public getState(): Readonly<OverlayQaAuthorizationState> | null {
    if (!this.runtimeAllowed()) return null;
    return this.active ? Object.freeze({ ...this.active }) : null;
  }

  /** Re-check the two QA gates before a supervisor is allowed to start. */
  public isRuntimeAllowed(): boolean {
    return this.runtimeAllowed();
  }

  /**
   * Revoke only the exact active identity. A delayed cleanup from an earlier
   * PID/session cannot tear down a newer supervised launch.
   */
  public revoke(identity: OverlayQaSupervisedTargetIdentity): boolean {
    const normalized = normalizeIdentity(identity);
    if (!normalized || !this.active || !sameIdentity(this.active, normalized)) {
      return false;
    }
    this.active = null;
    return true;
  }

  /** Owner-death/app-shutdown cleanup when no external identity is available. */
  public revokeCurrent(): boolean {
    if (!this.active) return false;
    this.active = null;
    return true;
  }

  private transition(
    identity: OverlayQaSupervisedTargetIdentity,
    expected: OverlaySupervisedLaunchPhase,
    next: OverlaySupervisedLaunchPhase
  ): boolean {
    if (!this.runtimeAllowed()) return false;
    const normalized = normalizeIdentity(identity);
    if (
      !normalized ||
      !this.active ||
      this.active.phase !== expected ||
      !sameIdentity(this.active, normalized)
    ) {
      return false;
    }
    this.active = Object.freeze({ ...this.active, phase: next });
    return true;
  }

  private matches(
    identity: OverlayQaSupervisedTargetIdentity,
    phase?: OverlaySupervisedLaunchPhase
  ) {
    if (!this.runtimeAllowed()) return false;
    const normalized = normalizeIdentity(identity);
    return Boolean(
      normalized &&
        this.active &&
        (!phase || this.active.phase === phase) &&
        sameIdentity(this.active, normalized)
    );
  }

  private runtimeAllowed() {
    let allowed = false;
    try {
      allowed = isOverlaySupervisedQaRuntimeAllowed(this.runtime());
    } catch {
      allowed = false;
    }
    if (!allowed) this.active = null;
    return allowed;
  }
}
