/**
 * SteamAutoCrack integration types (shared main <-> renderer).
 */

export type CrackStatus =
  | "tool-unavailable"
  | "not-installed"
  | "cracked-goldberg"
  | "cracked-other"
  | "clean";

export interface CrackDetection {
  status: CrackStatus;
  /** Short human-readable reason for the status. */
  reason: string;
  /** Absolute path to the game directory that would be cracked. */
  gameDir?: string;
}

export interface CrackResult {
  success: boolean;
  /** Exit code of the CLI process (null if it never spawned). */
  exitCode: number | null;
  /** Tail of the CLI stdout/stderr for debugging. */
  output: string;
}
