import type {
  EmulatorSystem,
  Game,
  GameAchievement,
  SteamAchievement,
  UnlockedAchievement,
  UserPreferences,
} from "@types";
import { db, gameAchievementsSublevel, levelKeys } from "@main/level";
import { resolveEffectiveSystem } from "@main/helpers";
import { achievementsLogger } from "../../logger";
import { systemHasRetroAchievements } from "../../emulators/known-binaries";
import { publishNewAchievementNotification } from "../../notifications";
import { WindowManager } from "../../window-manager";
import {
  getGameInfoAndUserProgress,
  getRecentAchievements,
  raBadgeUrl,
  type RaRecentAchievement,
} from "./ra-api";
import { AchievementSouvenirService } from "../achievement-souvenir-service";
import { supportsDesktopGameCapture } from "../../desktop-capture-capability";

/**
 * Maps a launchbox game's `platform` string back to its EmulatorSystem.
 * Phase 1-3 persisted the platform from SYSTEM_DEFAULT_PLATFORM /
 * SYSTEM_CATALOGUE_PLATFORM; both spellings are accepted here so a game
 * imported from either source resolves to its system.
 */
const PLATFORM_TO_SYSTEM: Record<string, EmulatorSystem> = {
  // SYSTEM_DEFAULT_PLATFORM
  playstation: "ps1",
  "playstation 2": "ps2",
  "playstation 3": "ps3",
  "playstation portable": "psp",
  "nintendo 3ds": "n3ds",
  "nintendo ds": "nds",
  "nintendo dsi": "dsi",
  "nintendo 64": "n64",
  "game boy": "gb",
  "game boy color": "gbc",
  "game boy advance": "gba",
  "nintendo wii u": "wiiu",
  "nintendo wii": "wii",
  "nintendo gamecube": "gc",
  // SYSTEM_CATALOGUE_PLATFORM
  "sony playstation": "ps1",
  "sony playstation 2": "ps2",
  "sony playstation 3": "ps3",
  "sony psp": "psp",
  "nintendo game boy": "gb",
  "nintendo game boy color": "gbc",
  "nintendo game boy advance": "gba",
};

const systemForGame = (game: Game): EmulatorSystem | null => {
  if (!game.platform) return null;
  const normalized = game.platform.trim().toLowerCase().replace(/\s+/g, " ");
  const stored = PLATFORM_TO_SYSTEM[normalized] ?? null;
  // GB/GBC/GBA are stamped "gba" by the merged catalogue; the bound ROM's
  // extension is the real console, so RA polls under the correct system id.
  return resolveEffectiveSystem(
    stored,
    game.selectedDiscPath ?? game.discs?.[0]?.path
  );
};

interface RaPollState {
  game: Game;
  username: string;
  apiKey: string;
  /** RA AchievementIDs that were already earned when polling started, plus any
   *  unlocked while we were watching — never re-notified. */
  seen: Set<number>;
}

export class RaWatcherManager {
  /** Keyed by levelKeys.game(shop, objectId). */
  private static readonly active = new Map<string, RaPollState>();

  private static async getCredentials(): Promise<{
    username: string;
    apiKey: string;
  } | null> {
    const prefs = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    const username = prefs?.retroAchievementsUsername?.trim();
    const apiKey = prefs?.retroAchievementsApiKey?.trim();
    if (!username || !apiKey) return null;
    return { username, apiKey };
  }

  /** Called on onOpenGame for RA-capable emulated games. */
  public static async startPolling(game: Game) {
    if (game.shop !== "launchbox") return;

    const system = systemForGame(game);
    if (!system || !systemHasRetroAchievements(system)) return;

    const credentials = await this.getCredentials();
    if (!credentials) return;

    const gameKey = levelKeys.game(game.shop, game.objectId);
    if (this.active.has(gameKey)) return;

    // Baseline: everything earned in the last hour so we don't re-notify
    // achievements the user already had when the game launched.
    const seen = new Set<number>();
    const baseline = await getRecentAchievements(
      credentials.username,
      credentials.apiKey,
      60
    );
    for (const a of baseline) seen.add(a.achievementId);

    this.active.set(gameKey, { game, ...credentials, seen });

    achievementsLogger.log(
      "Started RetroAchievements polling for",
      game.title,
      `(baseline ${seen.size} earned)`
    );
  }

  /** Called on the main loop cadence. */
  public static async watch() {
    if (this.active.size === 0) return;

    for (const state of this.active.values()) {
      const recent = await getRecentAchievements(
        state.username,
        state.apiKey,
        5
      );

      const newlyUnlocked = recent.filter(
        (a) => !state.seen.has(a.achievementId)
      );
      if (newlyUnlocked.length === 0) continue;

      for (const achievement of newlyUnlocked) {
        state.seen.add(achievement.achievementId);
        await this.notifyAndPersist(state.game, achievement).catch((err) =>
          achievementsLogger.error("Failed to process RA achievement", err)
        );
      }
    }
  }

  /** Whether the given game currently has an armed poll. (Used by tests.) */
  public static isPolling(game: Game): boolean {
    return this.active.has(levelKeys.game(game.shop, game.objectId));
  }

  /** Called on onCloseGame. */
  public static stopPolling(game: Game) {
    const gameKey = levelKeys.game(game.shop, game.objectId);
    if (this.active.delete(gameKey)) {
      achievementsLogger.log(
        "Stopped RetroAchievements polling for",
        game.title
      );
    }
  }

  private static async notifyAndPersist(
    game: Game,
    achievement: RaRecentAchievement
  ) {
    const credentials = await this.getCredentials();

    // Pull the full schema so the achievements UI shows e.g. 11/34 rather than
    // just the unlocked rows. Best-effort: fall back to the single unlock.
    const progress = credentials
      ? await getGameInfoAndUserProgress(
          credentials.username,
          credentials.apiKey,
          achievement.gameId
        )
      : null;

    const gameKey = levelKeys.game(game.shop, game.objectId);
    const cached = await gameAchievementsSublevel
      .get(gameKey)
      .catch(() => null);

    let definitions: SteamAchievement[];
    let unlocked: UnlockedAchievement[];

    if (progress) {
      definitions = progress.achievements.map((a) => ({
        name: String(a.id),
        displayName: a.title,
        description: a.description,
        icon: raBadgeUrl(a.badgeName),
        icongray: raBadgeUrl(a.badgeName),
        hidden: false,
        points: a.points,
        missable: a.missable ?? false,
      }));
      unlocked = progress.achievements
        .filter((a) => !!a.dateEarned)
        .map((a) => ({
          name: String(a.id),
          unlockTime: Math.floor(new Date(a.dateEarned!).getTime() / 1000),
        }));
    } else {
      // Merge this single unlock into whatever we already have cached.
      definitions = cached?.achievements ?? [];
      if (
        !definitions.some((d) => d.name === String(achievement.achievementId))
      ) {
        definitions = [
          ...definitions,
          {
            name: String(achievement.achievementId),
            displayName: achievement.title,
            description: achievement.description,
            icon: raBadgeUrl(achievement.badgeName),
            icongray: raBadgeUrl(achievement.badgeName),
            hidden: false,
            points: achievement.points,
          },
        ];
      }
      unlocked = [...(cached?.unlockedAchievements ?? [])];
      if (!unlocked.some((u) => u.name === String(achievement.achievementId))) {
        unlocked.push({
          name: String(achievement.achievementId),
          unlockTime: Math.floor(new Date(achievement.date).getTime() / 1000),
        });
      }
    }

    const record: GameAchievement = {
      achievements: definitions,
      unlockedAchievements: unlocked,
      updatedAt: Date.now(),
      language: cached?.language ?? "en",
      source: "retroachievements",
    };

    await gameAchievementsSublevel.put(gameKey, record);

    const totalAchievementCount = definitions.length || unlocked.length;
    const prefs = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);
    const customEnabled =
      (prefs?.achievementCustomNotificationsEnabled ?? true) &&
      process.platform !== "darwin";
    const position = prefs?.achievementCustomNotificationPosition ?? "top-left";
    let souvenirRecordKey: string | null = null;
    if (
      prefs?.enableAchievementSouvenirs === true &&
      supportsDesktopGameCapture(process.platform)
    ) {
      const definition = definitions.find(
        (candidate) => candidate.name === String(achievement.achievementId)
      );
      const earned = unlocked.find(
        (candidate) => candidate.name === String(achievement.achievementId)
      );
      if (definition && earned) {
        souvenirRecordKey = await AchievementSouvenirService.capture(
          game,
          definition,
          earned.unlockTime
        ).catch((error) => {
          achievementsLogger.warn(
            "Failed to capture RetroAchievements souvenir",
            game.objectId,
            achievement.achievementId,
            error
          );
          return null;
        });
      }
    }
    const achievementsInfo = [
      {
        title: achievement.title,
        description: achievement.description,
        iconUrl: raBadgeUrl(achievement.badgeName),
        isHidden: false,
        isRare: false,
        isPlatinum: unlocked.length === totalAchievementCount,
        points: achievement.points,
      },
    ];

    // Prefer the in-app surface over the OS toast — on Windows/Linux that's
    // the custom always-on-top overlay, which (unlike the OS toast) shows over
    // a game running in (borderless) fullscreen, which is how RALibretro and
    // most emulators run. Native Wayland posts into the focused application;
    // X11 may use the external toast when a compositor is actually available.
    const shownInOverlay =
      customEnabled &&
      (process.platform === "linux" &&
      !supportsDesktopGameCapture(process.platform)
        ? WindowManager.sendAchievementToFocusedWindow(
            position,
            achievementsInfo
          )
        : await WindowManager.showAchievementNotification(
            position,
            achievementsInfo
          ));

    if (!shownInOverlay) {
      await publishNewAchievementNotification({
        achievements: [
          {
            title: achievement.title,
            iconUrl: raBadgeUrl(achievement.badgeName),
          },
        ],
        unlockedAchievementCount: unlocked.length,
        totalAchievementCount,
        gameTitle: achievement.gameTitle || game.title,
        gameIcon: game.iconUrl ?? null,
      });
    }

    if (souvenirRecordKey) {
      void AchievementSouvenirService.sync(souvenirRecordKey);
    }

    WindowManager.sendToAppWindows("on-achievement-unlocked");

    achievementsLogger.log(
      "RetroAchievements unlock",
      game.title,
      achievement.title,
      `(${achievement.points} pts)`
    );
  }
}
