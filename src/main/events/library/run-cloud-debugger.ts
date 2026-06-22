import { chunk } from "lodash-es";
import { registerEvent } from "../register-event";
import { HydraApi, logger } from "@main/services";
import { gameAchievementsSublevel, gamesSublevel } from "@main/level";
import { searchCatalogueForAchievements } from "@main/services/achievements/exophase/exophase-catalogue";
import { resolveCanonicalUnlocked } from "@main/services/achievements/exophase/exophase-cache";
import type {
  UnlockedAchievement,
  DebugIssue,
  CloudDebugReport,
} from "@types";

export type { DebugIssue, CloudDebugReport };

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
  // The cloud API only accepts shop="steam" (and "launchbox"). Non-Steam games
  // (Epic/EA/GOG/Riot/etc.) are resolved to their Steam catalogue equivalent
  // by title and uploaded under that Steam objectId — the same mapping the
  // catalogue uses for achievement matching. We track each candidate's local
  // key → resolved Steam objectId so achievements and playtime can be pushed
  // to the right cloud record afterward.
  type UploadCandidate = {
    localKey: string;
    game: (typeof localGames)[number];
    steamObjectId: string;
  };

  const missingFromCloud = localGames.filter(
    (g) => !cloudByKey.has(`${g.shop}:${g.objectId}`)
  );

  // Maps the local game key → the cloud (steam) game it corresponds to, so the
  // achievement/playtime passes can find the remote record even when the local
  // game is Epic/EA/GOG/etc. but the cloud record is Steam.
  const localKeyToCloud = new Map<string, ProfileGame>();
  for (const [key, lg] of localByKey) {
    const direct = cloudByKey.get(`${lg.shop}:${lg.objectId}`);
    if (direct) localKeyToCloud.set(key, direct);
  }

  const candidates: UploadCandidate[] = [];

  for (const g of missingFromCloud) {
    const localKey = `${g.shop}:${g.objectId}`;

    if (g.shop === "steam") {
      candidates.push({ localKey, game: g, steamObjectId: g.objectId });
      issues.push({
        kind: "missing-from-cloud",
        gameTitle: g.title,
        shop: g.shop,
        objectId: g.objectId,
        detail: `Local Steam game not in cloud (libraryOrigin=${g.libraryOrigin ?? "?"}, remoteId=${g.remoteId ?? "null"})`,
        fixed: false,
      });
      continue;
    }

    // Non-Steam: resolve to a Steam catalogue entry by title.
    const match = await searchCatalogueForAchievements(g.title).catch(
      () => null
    );

    if (match && match.shop === "steam") {
      candidates.push({
        localKey,
        game: g,
        steamObjectId: match.objectId,
      });
      issues.push({
        kind: "missing-from-cloud",
        gameTitle: g.title,
        shop: g.shop,
        objectId: g.objectId,
        detail: `${g.shop.toUpperCase()} game matched to Steam catalogue (steam:${match.objectId} — "${match.title}")`,
        fixed: false,
      });
    } else {
      issues.push({
        kind: "missing-from-cloud",
        gameTitle: g.title,
        shop: g.shop,
        objectId: g.objectId,
        detail: `No Steam catalogue match found for "${g.title}" — cannot upload to cloud`,
        fixed: false,
        fixError: "No Steam match",
      });
    }
  }

  // Build the upload payload, deduped by Steam objectId, and skip any that
  // already exist in the cloud as Steam (just link those instead).
  const toUpload = new Map<string, UploadCandidate>();
  for (const c of candidates) {
    const cloudKey = `steam:${c.steamObjectId}`;
    if (cloudByKey.has(cloudKey)) {
      // Already in cloud under Steam — link it without re-uploading.
      localKeyToCloud.set(c.localKey, cloudByKey.get(cloudKey)!);
      const issue = issues.find(
        (i) =>
          i.kind === "missing-from-cloud" &&
          i.shop === c.game.shop &&
          i.objectId === c.game.objectId
      );
      if (issue) issue.fixed = true;
      continue;
    }
    if (!toUpload.has(c.steamObjectId)) toUpload.set(c.steamObjectId, c);
  }

  if (toUpload.size) {
    const uploadList = [...toUpload.values()];
    const toPayload = (c: UploadCandidate) => ({
      objectId: c.steamObjectId,
      playTimeInMilliseconds: Math.trunc(c.game.playTimeInMilliseconds),
      shop: "steam",
      lastTimePlayed: c.game.lastTimePlayed
        ? new Date(c.game.lastTimePlayed).toISOString()
        : null,
      isFavorite: (c.game as any).favorite ?? false,
      isPinned: c.game.isPinned ?? false,
    });

    const chunks = chunk(uploadList, 10);
    for (const ch of chunks) {
      const ok = await HydraApi.post("/profile/games/batch", ch.map(toPayload))
        .then(() => true)
        .catch(() => false);

      if (!ok) {
        // A single bad objectId 500s the whole chunk. Retry each game on its own
        // so the rest still upload, and we learn exactly which ones the server
        // rejects (recorded as a fixError on the matching issue below).
        for (const c of ch) {
          const single = await HydraApi.post("/profile/games/batch", [
            toPayload(c),
          ])
            .then(() => true)
            .catch(() => false);
          if (!single) {
            logger.warn(
              `[CloudDebugger] batch upload rejected steam:${c.steamObjectId} ("${c.game.title}")`
            );
            const issue = issues.find(
              (i) =>
                i.kind === "missing-from-cloud" &&
                i.shop === c.game.shop &&
                i.objectId === c.game.objectId
            );
            if (issue) issue.fixError = "Server rejected upload (500)";
          }
        }
      }
    }

    // Re-fetch cloud after upload so we get the new remoteIds.
    const refreshed = await HydraApi.get<ProfileGame[]>("/profile/games").catch(
      () => cloudGames
    );
    cloudGames = refreshed;
    cloudByKey = buildCloudMap(cloudGames);
  }

  // Reconcile every candidate against the refreshed cloud, mark issue status,
  // stamp the local remoteId, and record the local→cloud mapping.
  for (const c of candidates) {
    const cloudGame = cloudByKey.get(`steam:${c.steamObjectId}`);
    const issue = issues.find(
      (i) =>
        i.kind === "missing-from-cloud" &&
        i.shop === c.game.shop &&
        i.objectId === c.game.objectId
    );

    if (cloudGame) {
      localKeyToCloud.set(c.localKey, cloudGame);
      if (issue) {
        issue.fixed = true;
        if (issue.fixError) delete issue.fixError;
      }

      // Stamp remoteId on the local game so future syncs link correctly.
      const current = await gamesSublevel.get(c.localKey).catch(() => null);
      if (current && !current.remoteId) {
        await gamesSublevel
          .put(c.localKey, { ...current, remoteId: cloudGame.id })
          .catch(() => {});
      }
    } else if (issue && !issue.fixError) {
      issue.fixed = false;
      issue.fixError = "Batch upload failed";
    }
  }

  // --- 4. Cloud games not in local (informational only) ---
  for (const cg of cloudGames) {
    if (!localByKey.has(`${cg.shop}:${cg.objectId}`)) {
      // Skip ones we just uploaded by mapping a non-steam local game onto them.
      const mappedFromLocal = [...localKeyToCloud.values()].some(
        (m) => m.id === cg.id
      );
      if (mappedFromLocal) continue;

      // Skip achievement-only cloud registrations (zero playtime, no local game).
      // These are auto-created by Exophase/PSN sync so the cloud can credit
      // unlocks — they are NOT missing games and should not be flagged as issues.
      if ((cg.playTimeInMilliseconds ?? 0) === 0) continue;

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
    const cloudGame = localKeyToCloud.get(key) ?? cloudByKey.get(key);
    if (!cloudGame) continue;

    const localAch = await gameAchievementsSublevel.get(key).catch(() => null);
    const localUnlocked: UnlockedAchievement[] =
      localAch?.unlockedAchievements ?? [];
    const cloudUnlockedCount = cloudGame.unlockedAchievementCount ?? 0;

    if (localUnlocked.length === 0) continue;

    // The cloud only credits achievements whose names match the Steam apiName
    // schema. Exophase-imported unlocks carry `exophase_*` names that return 204
    // but never raise unlockedAchievementCount — translate them to canonical
    // Steam apiNames (via the resolved cloud Steam objectId) before pushing.
    const canonicalUnlocked =
      (await resolveCanonicalUnlocked(
        cloudGame.objectId,
        localAch?.achievements ?? [],
        localUnlocked,
        localAch?.language ?? "en"
      ).catch(() => null)) ?? localUnlocked;

    const pushCount = canonicalUnlocked.length;
    if (pushCount === 0) continue;

    if (pushCount > cloudUnlockedCount) {
      const translatedNote =
        canonicalUnlocked !== localUnlocked &&
        pushCount !== localUnlocked.length
          ? ` (${localUnlocked.length} local → ${pushCount} matched to Steam)`
          : "";
      const issue: DebugIssue = {
        kind: "achievement-count-mismatch",
        gameTitle: localGame.title,
        shop: localGame.shop,
        objectId: localGame.objectId,
        detail: `Local: ${pushCount} unlocked, Cloud: ${cloudUnlockedCount}${translatedNote}`,
        fixed: false,
      };

      const freshGame = await gamesSublevel.get(key).catch(() => localGame);
      const remoteId = freshGame?.remoteId ?? cloudGame.id;

      if (remoteId) {
        const ok = await HydraApi.put("/profile/games/achievements", {
          id: remoteId,
          achievements: canonicalUnlocked,
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
    const cloudGame = localKeyToCloud.get(key) ?? cloudByKey.get(key);
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
      const remoteId = freshGame?.remoteId ?? cloudGame.id;

      if (remoteId) {
        let remainingSeconds = Math.round((localMs - cloudMs) / 1000);
        const lastTimePlayed = localGame.lastTimePlayed
          ? new Date(localGame.lastTimePlayed).toISOString()
          : new Date().toISOString();
        let ok = true;

        while (remainingSeconds > 0 && ok) {
          const chunk = Math.min(remainingSeconds, 86400);
          ok = await HydraApi.put(`/profile/games/${remoteId}`, {
            playTimeDeltaInSeconds: chunk,
            lastTimePlayed,
          })
            .then(() => true)
            .catch(() => false);
          remainingSeconds -= chunk;
        }

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

/** Internal entry point so post-sync paths can trigger the debugger without
 *  an IPC round-trip. Silently no-ops when not logged in. */
export const runCloudDebuggerInternal = (): Promise<void> =>
  runCloudDebugger(null as unknown as Electron.IpcMainInvokeEvent)
    .then(() => {})
    .catch(() => {});
