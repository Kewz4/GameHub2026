export type OverlayInputGateAdapter = {
  create: () => boolean;
  set: (targetPid: number, blocked: boolean) => boolean;
  inject: (targetPid: number) => Promise<boolean>;
  log?: (
    level: "info" | "warn",
    message: string,
    details?: Record<string, unknown>
  ) => void;
};

/**
 * Fail-open lifecycle for the DLL-backed game input gate.
 *
 * Injection is prepared while the overlay is hidden, but the shared flag can
 * only become blocked after the overlay reports both visible and focused. Any
 * blur, hide, target transition, failed native call, or disposal clears it
 * synchronously before doing anything else.
 */
export class OverlayInputGateController {
  private created = false;
  private targetPid = 0;
  private preparedPid = 0;
  private visible = false;
  private focused = false;
  private blockedPid = 0;
  private generation = 0;
  private readonly adapter: OverlayInputGateAdapter;

  constructor(adapter: OverlayInputGateAdapter) {
    this.adapter = adapter;
  }

  public initialize() {
    if (this.created) return true;
    this.created = this.adapter.create();
    if (this.created) this.adapter.set(0, false);
    return this.created;
  }

  public setTarget(targetPid: number) {
    const nextPid =
      Number.isInteger(targetPid) && targetPid > 0 ? targetPid : 0;
    if (nextPid === this.targetPid) return;

    this.failOpen();
    this.generation += 1;
    this.targetPid = nextPid;
    this.preparedPid = 0;
    if (!nextPid) return;

    const generation = this.generation;
    void this.prepare(nextPid, generation);
  }

  public setOverlayState(visible: boolean, focused: boolean) {
    this.visible = visible;
    this.focused = visible && focused;
    this.synchronize();
  }

  public dispose() {
    this.visible = false;
    this.focused = false;
    this.failOpen();
    this.generation += 1;
    this.targetPid = 0;
    this.preparedPid = 0;
  }

  private async prepare(targetPid: number, generation: number) {
    try {
      if (!this.initialize()) {
        this.adapter.log?.("warn", "Overlay input gate is unavailable");
        return;
      }
      const injected = await this.adapter.inject(targetPid);
      if (generation !== this.generation || targetPid !== this.targetPid) {
        return;
      }
      if (!injected) {
        this.failOpen();
        this.adapter.log?.("warn", "Overlay input hook was not injected", {
          targetPid,
        });
        return;
      }
      this.preparedPid = targetPid;
      this.adapter.log?.("info", "Overlay input hook is ready", {
        targetPid,
      });
      this.synchronize();
    } catch (error) {
      if (generation === this.generation) this.failOpen();
      this.adapter.log?.("warn", "Overlay input hook preparation failed", {
        targetPid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private synchronize() {
    const shouldBlock =
      this.created &&
      this.visible &&
      this.focused &&
      this.targetPid > 0 &&
      this.preparedPid === this.targetPid;

    if (!shouldBlock) {
      this.failOpen();
      return;
    }
    if (this.blockedPid === this.targetPid) return;

    const blocked = this.adapter.set(this.targetPid, true);
    this.blockedPid = blocked ? this.targetPid : 0;
    if (!blocked) {
      this.adapter.set(0, false);
      this.adapter.log?.("warn", "Overlay input gate refused to block", {
        targetPid: this.targetPid,
      });
    }
  }

  private failOpen() {
    if (this.created) this.adapter.set(0, false);
    this.blockedPid = 0;
  }
}
