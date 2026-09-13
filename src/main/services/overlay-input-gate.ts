export const OVERLAY_INPUT_CAPABILITY = {
  xinput: 1 << 0,
  win32Keyboard: 1 << 1,
  rawInput: 1 << 2,
  lateBinding: 1 << 3,
  directInput: 1 << 4,
  windowsGamingInput: 1 << 5,
} as const;

export const OVERLAY_INPUT_REQUIRED_CAPABILITIES =
  OVERLAY_INPUT_CAPABILITY.xinput |
  OVERLAY_INPUT_CAPABILITY.win32Keyboard |
  OVERLAY_INPUT_CAPABILITY.rawInput |
  OVERLAY_INPUT_CAPABILITY.lateBinding;

export const OVERLAY_INPUT_UNSUPPORTED_MODULE = {
  directInput: 1 << 0,
  gameInput: 1 << 1,
  windowsGamingInput: 1 << 2,
} as const;

// Live IAT-only attachment cannot revoke polling function pointers that a game
// cached before the first overlay shortcut. Keep interactive Win32 activation
// disabled until the launcher has a proven pre-entry isolation bootstrap. This
// is deliberately checked by the controller (not only by its inject adapter),
// so a stale/resident DLL or forged shared-memory readiness record cannot
// authorize a visible overlay.
export const OVERLAY_LIVE_INPUT_ISOLATION_ENABLED = false;

export type OverlayInputGateNativeStatus = {
  ready: boolean;
  ownerPid: number;
  targetPid: number;
  blocked: boolean;
  generation: number;
  readyPid: number;
  readyGeneration: number;
  capabilityMask: number;
  unsupportedModuleMask: number;
  hookStatus: number;
};

export type OverlayInputGateFailureReason =
  | "unavailable"
  | "timeout"
  | "unsupported"
  | "target-changed";

export type OverlayInputGateReadiness =
  | { ready: true; status: OverlayInputGateNativeStatus }
  | {
      ready: false;
      reason: OverlayInputGateFailureReason;
      status: OverlayInputGateNativeStatus | null;
    };

export type OverlayInputGateAdapter = {
  create: () => boolean;
  set: (targetPid: number, blocked: boolean) => boolean;
  inject: (targetPid: number, targetIdentity: string) => Promise<boolean>;
  status: (targetPid: number) => OverlayInputGateNativeStatus;
  authorized?: () => boolean;
  log?: (
    level: "info" | "warn",
    message: string,
    details?: Record<string, unknown>
  ) => void;
};

const EMPTY_STATUS: OverlayInputGateNativeStatus = {
  ready: false,
  ownerPid: 0,
  targetPid: 0,
  blocked: false,
  generation: 0,
  readyPid: 0,
  readyGeneration: 0,
  capabilityMask: 0,
  unsupportedModuleMask: 0,
  hookStatus: 0,
};

/**
 * Target-scoped lifecycle for the injected game input gate.
 *
 * Starting an injection only proves that LoadLibrary ran. It does not prove
 * that the DLL mapped the shared section, patched the target's imports, or is
 * still attached to the selected render process. Interactive overlay opening
 * therefore requires a positive, generation-matched readiness record written
 * by the injected worker after its first complete module sweep.
 *
 * DirectInput, GameInput and Windows.Gaming.Input are deliberately fail-safe:
 * if the worker observes one of those modules, readiness is rejected. Raw HID
 * calls cannot be attributed safely from module presence alone (`hid.dll` is
 * commonly loaded transitively), so they remain a documented limitation and
 * are never presented as absolute input isolation.
 */
export class OverlayInputGateController {
  private created = false;
  private targetPid = 0;
  private targetIdentity = "";
  private generation = 0;
  private preparation: Promise<boolean> | null = null;
  private readonly adapter: OverlayInputGateAdapter;

  constructor(adapter: OverlayInputGateAdapter) {
    this.adapter = adapter;
  }

  public initialize() {
    if (this.created) return true;
    this.created = this.adapter.create();
    if (this.created && !this.adapter.set(0, false)) {
      this.created = false;
    }
    return this.created;
  }

  /**
   * Clear the previous target synchronously and publish its PID/generation.
   * Injection is deliberately lazy: merely detecting or foregrounding a game
   * must never load a DLL. Only the explicit shortcut/Guide activation path
   * calls waitUntilReady(), which starts preparation.
   */
  public setTarget(targetPid: number, targetIdentity = "") {
    const nextPid =
      Number.isInteger(targetPid) && targetPid > 0 ? targetPid : 0;
    const nextIdentity = nextPid ? targetIdentity : "";
    if (nextPid === this.targetPid && nextIdentity === this.targetIdentity) {
      return;
    }
    const reusingPidWithNewIdentity = nextPid > 0 && nextPid === this.targetPid;

    this.release();
    this.generation += 1;
    this.targetPid = nextPid;
    this.targetIdentity = nextIdentity;
    this.preparation = null;

    if (!this.initialize()) return;
    if (reusingPidWithNewIdentity && !this.adapter.set(0, false)) {
      this.created = false;
      return;
    }
    if (!this.adapter.set(nextPid, false)) {
      this.created = false;
      return;
    }
  }

  /** Wait for the target DLL's positive, generation-scoped handshake. */
  public async waitUntilReady(
    targetPid: number,
    timeoutMs = 3_000,
    pollIntervalMs = 25
  ): Promise<OverlayInputGateReadiness> {
    if (!this.isAuthorized()) {
      this.release();
      return { ready: false, reason: "unavailable", status: null };
    }
    if (!this.created || targetPid !== this.targetPid || targetPid <= 0) {
      return {
        ready: false,
        reason:
          targetPid > 0 && targetPid !== this.targetPid
            ? "target-changed"
            : "unavailable",
        status: null,
      };
    }

    const generation = this.generation;
    const targetIdentity = this.targetIdentity;
    const deadline = Date.now() + Math.max(0, timeoutMs);
    if (!this.preparation) {
      const preparation = this.prepare(targetPid, targetIdentity, generation);
      this.preparation = preparation;
      void preparation.then((prepared) => {
        if (!prepared && this.preparation === preparation) {
          // A transient injection refusal must not poison this PID forever.
          // The next explicit shortcut may retry; target/generation fencing
          // still prevents a late completion from authorizing another game.
          this.preparation = null;
        }
      });
    }
    const preparation = this.preparation;
    let preparationTimer: ReturnType<typeof setTimeout> | null = null;
    const prepared = await Promise.race([
      preparation,
      new Promise<false>((resolve) => {
        preparationTimer = setTimeout(
          () => resolve(false),
          Math.max(0, deadline - Date.now())
        );
      }),
    ]);
    if (preparationTimer) clearTimeout(preparationTimer);
    if (generation !== this.generation || targetPid !== this.targetPid) {
      return { ready: false, reason: "target-changed", status: null };
    }
    let status = this.readStatus();
    for (;;) {
      const evaluated = this.evaluateStatus(targetPid, status);
      if (evaluated.ready || evaluated.reason === "unsupported") {
        return evaluated;
      }
      if (generation !== this.generation || targetPid !== this.targetPid) {
        return { ready: false, reason: "target-changed", status };
      }
      if (Date.now() >= deadline) {
        return {
          ready: false,
          reason: prepared ? "timeout" : "unavailable",
          status,
        };
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(1, pollIntervalMs))
      );
      status = this.readStatus();
    }
  }

  /**
   * Synchronous final check used immediately before showing/focusing Electron.
   * The native setter independently enforces the same readiness record.
   */
  public activate(targetPid: number) {
    if (!this.isAuthorized()) {
      this.release();
      return false;
    }
    if (!this.created || targetPid !== this.targetPid || targetPid <= 0) {
      return false;
    }
    const currentStatus = this.readStatus();
    const readiness = this.evaluateStatus(targetPid, currentStatus);
    if (!readiness.ready) {
      // If native isolation is already latched, keep it latched until the
      // caller hides the overlay. Releasing here creates a visible double-input
      // interval during a focus-triggered revalidation failure.
      if (!currentStatus.blocked) this.release();
      return false;
    }
    const blocked = this.adapter.set(targetPid, true);
    if (!blocked) {
      // Native activation preserves an existing fail-safe latch when its
      // post-arm read detects concurrent invalidation. The caller will hide
      // synchronously and release afterwards.
      if (!currentStatus.blocked) this.adapter.set(targetPid, false);
      this.adapter.log?.("warn", "Overlay input gate refused activation", {
        targetPid,
      });
    }
    return blocked;
  }

  /** Revalidate an active target, including newly observed input modules. */
  public inspect(targetPid = this.targetPid): OverlayInputGateReadiness {
    if (!this.isAuthorized()) {
      this.release();
      return { ready: false, reason: "unavailable", status: null };
    }
    if (!this.created || targetPid !== this.targetPid || targetPid <= 0) {
      return {
        ready: false,
        reason:
          targetPid > 0 && targetPid !== this.targetPid
            ? "target-changed"
            : "unavailable",
        status: null,
      };
    }
    return this.evaluateStatus(targetPid, this.readStatus());
  }

  /**
   * Blur/hide calls this synchronously. Keeping the same target preserves the
   * worker's readiness generation for the next open while clearing BLOCKED.
   */
  public release() {
    if (this.created) this.adapter.set(this.targetPid, false);
  }

  public dispose() {
    this.release();
    this.generation += 1;
    this.targetPid = 0;
    this.targetIdentity = "";
    this.preparation = null;
    if (this.created) this.adapter.set(0, false);
    this.created = false;
  }

  private async prepare(
    targetPid: number,
    targetIdentity: string,
    generation: number
  ) {
    if (!this.isAuthorized()) return false;
    try {
      const injected = await this.adapter.inject(targetPid, targetIdentity);
      if (
        generation !== this.generation ||
        targetPid !== this.targetPid ||
        targetIdentity !== this.targetIdentity
      ) {
        return false;
      }
      if (!injected) {
        this.adapter.log?.("warn", "Overlay input hook was not injected", {
          targetPid,
        });
        return false;
      }
      this.adapter.log?.("info", "Overlay input hook injection started", {
        targetPid,
      });
      return true;
    } catch (error) {
      this.adapter.log?.("warn", "Overlay input hook preparation failed", {
        targetPid,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private readStatus() {
    try {
      return this.adapter.status(this.targetPid);
    } catch {
      return EMPTY_STATUS;
    }
  }

  private isAuthorized() {
    return this.adapter.authorized?.() ?? true;
  }

  private evaluateStatus(
    targetPid: number,
    status: OverlayInputGateNativeStatus
  ): OverlayInputGateReadiness {
    const generationMatches =
      status.ready &&
      status.targetPid === targetPid &&
      status.readyPid === targetPid &&
      status.generation !== 0 &&
      status.readyGeneration === status.generation;
    const capabilitiesComplete =
      (status.capabilityMask & OVERLAY_INPUT_REQUIRED_CAPABILITIES) ===
      OVERLAY_INPUT_REQUIRED_CAPABILITIES;

    if (status.unsupportedModuleMask !== 0) {
      return { ready: false, reason: "unsupported", status };
    }
    if (generationMatches && !capabilitiesComplete) {
      return { ready: false, reason: "unsupported", status };
    }
    if (generationMatches && capabilitiesComplete) {
      return { ready: true, status };
    }
    return { ready: false, reason: "timeout", status };
  }
}
