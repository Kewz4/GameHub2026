import axios from "axios";
import { achievementsLogger } from "../../logger";

const RA_BASE_URL = "https://retroachievements.org/API/";

export const raBadgeUrl = (badgeName: string): string =>
  `https://media.retroachievements.org/Badge/${badgeName}.png`;

export interface RaRecentAchievement {
  achievementId: number;
  title: string;
  description: string;
  points: number;
  badgeName: string;
  gameId: number;
  gameTitle: string;
  date: string;
}

export interface RaGameAchievement {
  id: number;
  title: string;
  description: string;
  points: number;
  badgeName: string;
  numAwarded: number;
  dateEarned?: string;
}

export interface RaGameProgress {
  gameId: number;
  title: string;
  consoleName: string;
  imageIcon: string;
  numAchievements: number;
  numAwardedToUser: number;
  achievements: RaGameAchievement[];
}

interface RaRecentAchievementResponse {
  AchievementID: number;
  Title: string;
  Description: string;
  Points: number;
  BadgeName: string;
  GameID: number;
  GameTitle: string;
  Date: string;
  ConsoleName: string;
}

interface RaGameAchievementResponse {
  ID: number;
  Title: string;
  Description: string;
  Points: number;
  BadgeName: string;
  NumAwarded: number;
  DateEarned?: string;
  DateEarnedHardcore?: string;
}

interface RaGameProgressResponse {
  ID: number;
  Title: string;
  ConsoleName: string;
  ImageIcon: string;
  NumAchievements: number;
  NumAwardedToUser: number;
  Achievements: Record<string, RaGameAchievementResponse>;
}

interface RaLoginResponse {
  Success: boolean;
  Token?: string;
  User?: string;
  Error?: string;
  Code?: string;
}

/**
 * Exchange a RetroAchievements username + password for a login token. This is
 * the same request RALibretro makes to sign in; we do it once so the token can
 * be written into RALibretro's RAPrefs (the password is never stored). Returns
 * the token on success, or an error message.
 */
export async function loginRetroAchievements(
  username: string,
  password: string
): Promise<{ success: true; token: string } | { success: false; error: string }> {
  if (!username || !password) {
    return { success: false, error: "Enter your username and password." };
  }
  try {
    const { data } = await axios.get<RaLoginResponse>(
      "https://retroachievements.org/dorequest.php",
      {
        params: { r: "login2", u: username, p: password },
        timeout: 15000,
        // RA returns HTTP 401 (with a JSON error body) for a wrong password;
        // don't let axios throw on it or we'd report "couldn't reach" instead
        // of the real "invalid credentials" message. Read the body ourselves.
        validateStatus: () => true,
      }
    );
    if (data?.Success && data.Token) {
      return { success: true, token: data.Token };
    }
    return {
      success: false,
      error: data?.Error ?? "Invalid username or password.",
    };
  } catch (err) {
    achievementsLogger.warn(
      "RetroAchievements login failed",
      err instanceof Error ? err.message : err
    );
    return { success: false, error: "Couldn't reach RetroAchievements." };
  }
}

export async function getRecentAchievements(
  username: string,
  apiKey: string,
  minutes: number
): Promise<RaRecentAchievement[]> {
  if (!username || !apiKey) return [];

  try {
    const { data } = await axios.get<RaRecentAchievementResponse[]>(
      `${RA_BASE_URL}API_GetUserRecentAchievements.php`,
      {
        params: { u: username, y: apiKey, m: minutes },
        timeout: 15000,
      }
    );

    if (!Array.isArray(data)) return [];

    return data.map((a) => ({
      achievementId: a.AchievementID,
      title: a.Title,
      description: a.Description,
      points: a.Points,
      badgeName: a.BadgeName,
      gameId: a.GameID,
      gameTitle: a.GameTitle,
      date: a.Date,
    }));
  } catch (err) {
    achievementsLogger.warn(
      "Failed to fetch RetroAchievements recent achievements",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

export async function getGameInfoAndUserProgress(
  username: string,
  apiKey: string,
  gameId: number
): Promise<RaGameProgress | null> {
  if (!username || !apiKey || !gameId) return null;

  try {
    const { data } = await axios.get<RaGameProgressResponse>(
      `${RA_BASE_URL}API_GetGameInfoAndUserProgress.php`,
      {
        params: { u: username, y: apiKey, g: gameId },
        timeout: 15000,
      }
    );

    if (!data || typeof data !== "object") return null;

    const achievements: RaGameAchievement[] = Object.values(
      data.Achievements ?? {}
    ).map((a) => ({
      id: a.ID,
      title: a.Title,
      description: a.Description,
      points: a.Points,
      badgeName: a.BadgeName,
      numAwarded: a.NumAwarded,
      dateEarned: a.DateEarnedHardcore ?? a.DateEarned,
    }));

    return {
      gameId: data.ID,
      title: data.Title,
      consoleName: data.ConsoleName,
      imageIcon: data.ImageIcon,
      numAchievements: data.NumAchievements,
      numAwardedToUser: data.NumAwardedToUser,
      achievements,
    };
  } catch (err) {
    achievementsLogger.warn(
      "Failed to fetch RetroAchievements game progress",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
