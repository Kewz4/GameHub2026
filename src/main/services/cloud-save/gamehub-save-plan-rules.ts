import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  resolveEmulatorRestorePatterns,
  resolveEmulatorSaveLocation,
  resolveEmulatorSramAliasPolicy,
  systemForGame,
} from "@main/services/emulators/emulator-save-dirs";
import { resolveSaveBackupPlan } from "@main/services/save-backup-plan";
import { Ludusavi } from "@main/services/ludusavi";
import type { CloudSavePathContext, CloudSaveRule, GameShop } from "@types";

import {
  cloudSaveCustomPathContextFromPathContext,
  encodeCloudSaveCustomPath,
} from "./custom-path";
import {
  buildGameHubEmulatorRules,
  type EmulatorRemoteFile,
} from "./gamehub-emulator-rules";
import { selectGameHubSavePlanLookup } from "./gamehub-save-plan-policy";

const pathKind = async (candidate: string) =>
  fs.lstat(candidate).then(
    (stat) => (stat.isFile() ? "file" : "dir"),
    () => "dir"
  );

const sortedUniquePaths = (paths: readonly string[], platform: string) =>
  [...new Set(paths)].sort((left, right) =>
    left.localeCompare(right, undefined, {
      sensitivity: platform === "windows" ? "base" : "variant",
    })
  );

/**
 * Adapts GameHub's validated manual/emulator mapper into the V2 rule model.
 * Emulator rules use a stable logical identity while `preferredPath` binds
 * that identity to this installation's exact title-scoped destination.
 */
export const getGameHubSavePlanRules = async (
  objectId: string,
  shop: GameShop,
  pathContext: CloudSavePathContext,
  remoteFiles?: readonly EmulatorRemoteFile[],
  identityFiles?: readonly EmulatorRemoteFile[]
): Promise<CloudSaveRule[]> => {
  const manual = await Ludusavi.getManualCustomGame(shop, objectId);
  const emulatorSystem = manual?.files.length
    ? null
    : await systemForGame(shop, objectId);
  const lookup = selectGameHubSavePlanLookup(
    Boolean(manual?.files.length),
    emulatorSystem
  );

  if (lookup === "manual" && manual) {
    const customContext =
      cloudSaveCustomPathContextFromPathContext(pathContext);
    const paths = sortedUniquePaths(manual.files, pathContext.platform);
    return Promise.all(
      paths.map(async (preferredPath) => {
        const rawPath = encodeCloudSaveCustomPath(
          preferredPath,
          customContext
        ).rawPath;
        return {
          ruleId: `gamehub-manual-${crypto
            .createHash("sha256")
            .update(rawPath)
            .digest("hex")}`,
          kind: await pathKind(preferredPath),
          rawPath,
          source: "custom",
          tags: ["save"],
          when: [{ os: pathContext.platform }],
          preferredPath,
        };
      })
    );
  }

  // Native PC rules already come from the release-pinned V2 manifest. The
  // legacy PC plan ultimately returned [] here, but only after a possible
  // 60-second manifest refresh and two 30-second title lookups. Avoid that
  // discarded work (and its Ludusavi config rewrite) entirely.
  if (lookup !== "emulator") return [];

  const plan = await resolveSaveBackupPlan(shop, objectId);
  if (plan.source !== "emulator") return [];
  const location = await resolveEmulatorSaveLocation(shop, objectId);
  if (!location) return [];
  const restorePatterns = await resolveEmulatorRestorePatterns(shop, objectId);

  return buildGameHubEmulatorRules({
    shop,
    objectId,
    platform: pathContext.platform,
    binary: location.binary,
    system: location.system,
    emulatorInstallDir: path.dirname(location.executablePath),
    saveRoots: location.folders,
    backupPaths: plan.status === "ready" ? plan.paths : [],
    restorePatterns,
    remoteFiles,
    identityFiles,
    sramAlias: await resolveEmulatorSramAliasPolicy(
      location,
      shop,
      objectId,
      pathContext.platform
    ),
  });
};
