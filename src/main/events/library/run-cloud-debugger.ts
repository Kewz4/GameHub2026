import { chunk } from "lodash-es";
import { registerEvent } from "../register-event";
import { HydraApi, logger } from "@main/services";
import { gameAchievementsSublevel, gamesSublevel } from "@main/level";
import type { UnlockedAchievement } from "@types";

export interface DebugIssue {
  kind:
    | "missing-from-cloud"
    | "missing-from-local"
    | "achievement-count-mismatch"
    | "playtime-mismatch";
  gameTitle: string;
  shop: string;
  objectId: string;
  detail: string;
  fixed: boolean;
  fixError?: string;
}

export interface CloudDebugReport {
  checkedAt: string;
  localCount: number;
  cloudCount: number;
  issues: DebugIssue[];
  fixedCount: number;
  unfixedCount: number;
  notLoggedIn?: boolean;
}

type ProfileGame = {
  id: string;
  objectId: string;
  shop: string;
  title: string;
  achievementCount: number;
  unlockedAchievementCount: number;
  playTimeInMilliseconds: number;
  lastTimePlayed: Date | null;
};

const runCloudDebugger = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<CloudDebugReport> => {
  if (!HydraApi.isLoggedIn()) {
    return {
      checkedAt: new Date().toISOString(),
      localCount: 0,
      cloudCount: 0,
      issues: [],
      fixedCount: 0,
      unfixedCount: 0,
      notLoggedIn: true,
    };
  }

  // --- 1. Load local library (all non-deleted, non-custom games) ---
  const localGames = await gamesSublevel
    .values()
    .all()
    .then((all) => all.filter((g) => !g.isDeleted && g.shop !== "custom"));

  // --- 2. Load cloud library ---
  let cloudGames = await HydraApi.get<ProfileGame[]>("/profile/games").catch(
    () => [] as ProfileGame[]
  );

  const issues: DebugIssue[] = [];

  const buildCloudMap = (games: ProfileGame[]) => {
    const m = new Map<string, ProfileGame>();
    for (const cg of games) m.set(`${cg.shop}:${cg.objectId}`, cg);
    return m;
  };

  let cloudByKey = buildCloudMap(cloudGames);

  const localByKey = new Map<string, (typeof localGames)[number]>();
  for (const lg of localGames) {
    localByKey.set(`${lg.shop}:${lg.objectId}`, lg);
  }

  // --- 3. Find local games missing from cloud ---
  // Include ALL games (including libraryOrigin="sync" platform games) so that
  // achievements from Steam/Epic/GOG can be pushed to the cloud profile.
  const missingFromCloud = localGames.filter(
    (g) => !cloudByKey.has(`${g.shop}:${g.objectId}`)
  );

  for (const g of missingFromCloud) {
    issues.push({
      kind: "missing-from-cloud",
      gameTitle: g.title,
      shop: g.shop,
      objectId: g.objectId,
      detail: `Local game not in cloud (libraryOrigin=${g.libraryOrigin ?? "?"}, remoteId=${g.remoteId ?? "null"})`,
      fixed: false,
    });
  }

  // Attempt batch upload for all missing games
  if (missingFromCloud.length) {
    const chunks = chunk(missingFromCloud, 30);
    for (const ch of chunks) {
      const payload = ch.map((g) => ({
        objectId: g.objectId,
        playTimeInMilliseconds: Math.trunc(g.playTimeInMilliseconds),
        shop: g.shop,
        lastTimePlayed: g.lastTimePlayed,
        isFavorite: (g as any).favorite ?? false,
        isPinned: g.isPinned ?? false,
      }));

      const ok = await HydraApi.post("/profile/games/batch", payload)
        .then(() => true)
        .catch(() => false);

      for (const g of ch) {
        const issue = issues.find(
          (i) =>
            i.kind === "missing-from-cloud" &&
            i.shop === g.shop &&
            i.objectId === g.objectId
        );
        if (issue) {
          issue.fixed = ok;
          if (!ok) issue.fixError = "Batch upload failed";
        }
      }
    }

    // Re-fetch cloud after upload so we get the new remoteIds and can push achievements
    const refreshed = await HydraApi.get<ProfileGame[]>("/profile/games").catch(
      () => cloudGames
    );
    cloudGames = refreshed;
    cloudByKey = buildCloudMap(cloudGames);

    // Stamp remoteId on local games that now exist in cloud
    for (const g of missingFromCloud) {
      const cloudGame = cloudByKey.get(`${g.shop}:${g.objectId}`);
      if (cloudGame) {
        const key = `${g.shop}:${g.objectId}`;
        const current = await gamesSublevel.get(key).catch(() => null);
        if (current && !current.remoteId) {
          await gamesSublevel
            .put(key, { ...current, remoteId: cloudGame.id })
            .catch(() => {});
        }
      }
    }
  }

  // --- 4. Cloud games not in local (informational only) ---
  for (const cg of cloudGames) {
    if (!localByKey.has(`${cg.shop}:${cg.objectId}`)) {
      issues.push({
        kind: "missing-from-local",
        gameTitle: cg.title,
        shop: cg.shop,
        objectId: cg.objectId,
        detail: `Cloud game not in local library (cloud id: ${cg.id})`,
        fixed: false,
        fixError: "Informational — add the game locally to sync achievements",
      });
    }
  }

  // --- 5. Achievement discrepancies: push local → cloud ---
  for (const localGame of localGames) {
    const key = `${localGame.shop}:${localGame.objectId}`;
    const cloudGame = cloudByKey.get(key);
    if (!cloudGame) continue;

    const localAch = await gameAchievementsSublevel.get(key).catch(() => null);
    const localUnlocked: UnlockedAchievement[] =
      localAch?.unlockedAchievements ?? [];
    const cloudUnlockedCount = cloudGame.unlockedAchievementCount ?? 0;

    if (localUnlocked.length === 0) continue;

    if (localUnlocked.length > cloudUnlockedCount) {
      const issue: DebugIssue = {
        kind: "achievement-count-mismatch",
        gameTitle: localGame.title,
        shop: localGame.shop,
        objectId: localGame.objectId,
        detail: `Local: ${localUnlocked.length} unlocked, Cloud: ${cloudUnlockedCount}`,
        fixed: false,
      };

      // Get the current remoteId (may have been stamped above)
      const freshGame = await gamesSublevel.get(key).catch(() => localGame);
      const remoteId = freshGame.remoteId ?? cloudGame.id;

      if (remoteId) {
        const ok = await HydraApi.put("/profile/games/achievements", {
          id: remoteId,
          achievements: localUnlocked,
        })
          .then(() => true)
          .catch(() => false);

        issue.fixed = ok;
        if (!ok) issue.fixError = "Achievement push failed";
      } else {
        issue.fixError = "No remoteId — game not linked to cloud";
      }

      issues.push(issue);
    }
  }

  // --- 6. Playtime discrepancies ---
  for (const localGame of localGames) {
    const key = `${localGame.shop}:${localGame.objectId}`;
    const cloudGame = cloudByKey.get(key);
    if (!cloudGame) continue;

    const localMs = Math.trunc(localGame.playTimeInMilliseconds);
    const cloudMs = Math.trunc(cloudGame.playTimeInMilliseconds ?? 0);

    if (localMs > cloudMs && localMs - cloudMs > 60_000) {
      const issue: DebugIssue = {
        kind: "playtime-mismatch",
        gameTitle: localGame.title,
        shop: localGame.shop,
        objectId: localGame.objectId,
        detail: `Local: ${Math.round(localMs / 60000)} min, Cloud: ${Math.round(cloudMs / 60000)} min`,
        fixed: false,
      };

      const freshGame = await gamesSublevel.get(key).catch(() => localGame);
      const remoteId = freshGame.remoteId ?? cloudGame.id;

      if (remoteId) {
        const ok = await HydraApi.put(`/profile/games/${remoteId}`, {
          playTimeInMilliseconds: localMs,
          lastTimePlayed: localGame.lastTimePlayed,
        })
          .then(() => true)
          .catch(() => false);

        issue.fixed = ok;
        if (!ok) issue.fixError = "Playtime update failed";
      } else {
        issue.fixError = "No remoteId";
      }

      issues.push(issue);
    }
  }

  const fixedCount = issues.filter((i) => i.fixed).length;
  const unfixedCount = issues.filter((i) => !i.fixed).length;

  logger.info(
    `[CloudDebugger] local=${localGames.length} cloud=${cloudGames.length} issues=${issues.length} fixed=${fixedCount} unfixed=${unfixedCount}`
  );

  return {
    checkedAt: new Date().toISOString(),
    localCount: localGames.length,
    cloudCount: cloudGames.length,
    issues,
    fixedCount,
    unfixedCount,
  };
};

registerEvent("runCloudDebugger", runCloudDebugger);
