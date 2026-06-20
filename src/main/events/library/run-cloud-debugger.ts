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

  // --- 1. Load local library ---
  const localGames = await gamesSublevel
    .values()
    .all()
    .then((all) => all.filter((g) => !g.isDeleted && g.shop !== "custom"));

  // --- 2. Load cloud library ---
  const cloudGames = await HydraApi.get<ProfileGame[]>("/profile/games").catch(
    () => [] as ProfileGame[]
  );

  const issues: DebugIssue[] = [];

  // Build lookup maps
  const cloudByKey = new Map<string, ProfileGame>();
  for (const cg of cloudGames) {
    cloudByKey.set(`${cg.shop}:${cg.objectId}`, cg);
  }

  const localByKey = new Map<string, (typeof localGames)[number]>();
  for (const lg of localGames) {
    localByKey.set(`${lg.shop}:${lg.objectId}`, lg);
  }

  // --- 3. Find local games missing from cloud ---
  const uploadable = localGames.filter(
    (g) =>
      g.remoteId === null &&
      g.libraryOrigin !== "sync" &&
      !cloudByKey.has(`${g.shop}:${g.objectId}`)
  );

  const toUpload = uploadable.map((g) => ({
    objectId: g.objectId,
    shop: g.shop,
    title: g.title,
  }));

  for (const g of uploadable) {
    issues.push({
      kind: "missing-from-cloud",
      gameTitle: g.title,
      shop: g.shop,
      objectId: g.objectId,
      detail: `Local game not found in cloud (remoteId = null, libraryOrigin = ${g.libraryOrigin ?? "?"})`,
      fixed: false,
    });
  }

  // Attempt to upload missing games in batches of 30
  if (toUpload.length) {
    const chunks = chunk(uploadable, 30);
    for (const ch of chunks) {
      const payload = ch.map((g) => ({
        objectId: g.objectId,
        playTimeInMilliseconds: Math.trunc(g.playTimeInMilliseconds),
        shop: g.shop,
        lastTimePlayed: g.lastTimePlayed,
        isFavorite: g.favorite ?? false,
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
        if (issue) issue.fixed = ok;
        if (!ok && issue) issue.fixError = "Batch upload failed";
      }
    }
  }

  // --- 4. Find cloud games missing from local ---
  for (const cg of cloudGames) {
    if (!localByKey.has(`${cg.shop}:${cg.objectId}`)) {
      issues.push({
        kind: "missing-from-local",
        gameTitle: cg.title,
        shop: cg.shop,
        objectId: cg.objectId,
        detail: `Cloud game not in local library (cloud id: ${cg.id})`,
        fixed: false,
        fixError: "Cannot auto-fix: manual re-add required",
      });
    }
  }

  // --- 5. Check achievement discrepancies ---
  for (const cg of cloudGames) {
    const localGame = localByKey.get(`${cg.shop}:${cg.objectId}`);
    if (!localGame) continue;

    const achKey = `${cg.shop}:${cg.objectId}`;
    const localAch = await gameAchievementsSublevel
      .get(achKey)
      .catch(() => null);

    const localUnlocked: UnlockedAchievement[] =
      localAch?.unlockedAchievements ?? [];
    const cloudUnlockedCount = cg.unlockedAchievementCount ?? 0;

    if (localUnlocked.length > cloudUnlockedCount) {
      const issue: DebugIssue = {
        kind: "achievement-count-mismatch",
        gameTitle: cg.title,
        shop: cg.shop,
        objectId: cg.objectId,
        detail: `Local has ${localUnlocked.length} unlocked achievements, cloud has ${cloudUnlockedCount}`,
        fixed: false,
      };

      // Attempt to push local achievements to cloud
      if (localGame.remoteId) {
        const ok = await HydraApi.put("/profile/games/achievements", {
          id: localGame.remoteId,
          achievements: localUnlocked,
        })
          .then(() => true)
          .catch(() => false);

        issue.fixed = ok;
        if (!ok) issue.fixError = "Achievement upload failed";
      } else {
        issue.fixError =
          "Game has no remoteId — upload games to cloud first, then re-run debugger";
      }

      issues.push(issue);
    }

    // Playtime discrepancies
    const localMs = Math.trunc(localGame.playTimeInMilliseconds);
    const cloudMs = Math.trunc(cg.playTimeInMilliseconds ?? 0);
    const diffMs = Math.abs(localMs - cloudMs);
    if (diffMs > 60_000 && localMs > cloudMs) {
      const issue: DebugIssue = {
        kind: "playtime-mismatch",
        gameTitle: cg.title,
        shop: cg.shop,
        objectId: cg.objectId,
        detail: `Local playtime ${Math.round(localMs / 60000)} min, cloud ${Math.round(cloudMs / 60000)} min`,
        fixed: false,
      };

      if (localGame.remoteId) {
        const ok = await HydraApi.put(`/profile/games/${localGame.remoteId}`, {
          playTimeInMilliseconds: localMs,
          lastTimePlayed: localGame.lastTimePlayed,
        })
          .then(() => true)
          .catch(() => false);

        issue.fixed = ok;
        if (!ok) issue.fixError = "Playtime update failed";
      } else {
        issue.fixError = "Game has no remoteId — upload games to cloud first";
      }

      issues.push(issue);
    }
  }

  const fixedCount = issues.filter((i) => i.fixed).length;
  const unfixedCount = issues.filter((i) => !i.fixed).length;

  logger.info(
    `[CloudDebugger] ${issues.length} issues found, ${fixedCount} fixed, ${unfixedCount} unfixed`
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
