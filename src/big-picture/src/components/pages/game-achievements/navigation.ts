export const GAME_ACHIEVEMENTS_PAGE_REGION_ID = "game-achievements-page";
export const GAME_ACHIEVEMENTS_LIST_REGION_ID = "game-achievements-list";
export const GAME_ACHIEVEMENTS_EMPTY_STATE_ID = "game-achievements-empty-state";

export const getAchievementRowId = (achievementName: string) =>
  `achievement-row-${achievementName}`;
