export type GameShop =
  | "steam"
  | "epic"
  | "gog"
  | "battlenet"
  | "xbox"
  | "riot"
  | "ubisoft"
  | "ea"
  | "launchbox"
  | "custom";

export type ShortcutLocation = "desktop" | "start_menu";

export interface UnlockedAchievement {
  name: string;
  unlockTime: number;
}

/** Fractional progress toward a stat-gated achievement (e.g. "kill 38/100
 *  enemies"). Sourced from the CurProgress/MaxProgress fields that CODEX-lineage
 *  achievements.ini files emit for locked achievements. Only meaningful while
 *  the achievement is still locked. */
export interface AchievementProgress {
  name: string;
  current: number;
  max: number;
}

export interface AchievementMetadataEntry {
  description: string;
  displayName: string;
  hidden: 0 | 1;
  icon: string;
  icongray: string;
  name: string;
}

export interface SteamAchievement {
  name: string;
  displayName: string;
  description?: string;
  icon: string;
  icongray: string;
  hidden: boolean;
  points?: number;
  /** RetroAchievements "missable" type — can be permanently missed during a
   *  normal playthrough (RA achievement `Type === "missable"`). */
  missable?: boolean;
}

export interface UserAchievement extends SteamAchievement {
  unlocked: boolean;
  unlockTime: number | null;
  /** Local/R2-backed image captured when this achievement was unlocked. */
  imageUrl?: string | null;
  /** Present only for locked, stat-gated achievements that report fractional
   *  progress in the local achievement file. */
  progress?: { current: number; max: number };
}
