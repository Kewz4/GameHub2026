import type { GameShop, UserAchievement } from "./game.types";

export interface HydraOverlayPreferences {
  overlayEnabled: boolean;
  overlayPerformanceEnabled: boolean;
  overlayPerformanceShowFps: boolean;
  overlayPerformanceShowAverageFps: boolean;
  overlayPerformanceShowFrameTime: boolean;
  overlayPerformanceShowOnePercentLow: boolean;
  /** Suspend the game's process tree while the overlay is open, so it stops
   *  reading the controller and the overlay has input to itself. */
  overlayPauseGameWhileOpen: boolean;
}

export interface HydraOverlayPerformanceRows {
  fps: boolean;
  averageFps: boolean;
  frameTime: boolean;
  onePercentLow: boolean;
}

export interface HydraOverlayGame {
  title: string;
  objectId: string;
  shop: GameShop;
  iconUrl: string | null;
  logoImageUrl: string | null;
  heroImageUrl: string | null;
  coverImageUrl: string | null;
  playTimeInMilliseconds: number;
  sessionStartedAt: number;
}

export interface HydraOverlayContext {
  game: HydraOverlayGame;
  user: {
    displayName: string;
    profileImageUrl: string | null;
  } | null;
  achievements: UserAchievement[];
  shortcut: string;
  controllerShortcut: string;
  performance: HydraOverlayPerformance;
  performancePinned: boolean;
  settings: HydraOverlaySettings;
}

export interface HydraOverlaySettings {
  performanceEnabled: boolean;
  performanceRows: HydraOverlayPerformanceRows;
}

export interface HydraOverlayPerformance {
  fps: number | null;
  averageFps: number | null;
  onePercentLow: number | null;
  frameTimeMs: number | null;
  updatedAt: number;
  captureStatus?:
    | "waiting"
    | "capturing"
    | "permission-required"
    | "unavailable"
    | "error";
  captureMessage?: string | null;
}

export type HydraOverlayGamepadAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "accept"
  | "back"
  | "previous-tab"
  | "next-tab";

/** An app the user pinned to the overlay's quick launcher. */
export interface PinnedApp {
  name: string;
  path: string;
  /**
   * The operating system's icon for the pinned executable or shortcut.
   * Optional because pinned apps saved by older GameHub versions only contain
   * the name and path.
   */
  iconUrl?: string | null;
}

/** A running app's audio session, surfaced by the overlay volume mixer. */
export interface AudioSession {
  pid: number;
  name: string;
  /** Session master volume, 0.0–1.0. */
  volume: number;
  muted: boolean;
}
