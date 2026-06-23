export type GameShop =
  | "steam"
  | "epic"
  | "gog"
  | "battlenet"
  | "xbox"
  | "riot"
  | "ubisoft"
  | "ea"
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

export interface SteamAchievement {
  name: string;
  displayName: string;
  description?: string;
  icon: string;
  icongray: string;
  hidden: boolean;
  points?: number;
}

export interface UserAchievement extends SteamAchievement {
  unlocked: boolean;
  unlockTime: number | null;
  /** Present only for locked, stat-gated achievements that report fractional
   *  progress in the local achievement file. */
  progress?: { current: number; max: number };
}
