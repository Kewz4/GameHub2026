/**
 * Steam emulator integration types (shared main <-> renderer).
 */

export type SteamEmulatorStatus =
  | "tool-unavailable"
  | "not-installed"
  | "emulator-ready"
  | "emulator-present"
  | "clean";

export interface SteamEmulatorDetection {
  status: SteamEmulatorStatus;
  /** Short human-readable reason for the status. */
  reason: string;
  /** Absolute path to the game directory that would be set up. */
  gameDir?: string;
}

export interface SteamEmulatorResult {
  success: boolean;
  /** Exit code of the CLI process (null if it never spawned). */
  exitCode: number | null;
  /** Tail of the CLI stdout/stderr for debugging. */
  output: string;
}
