import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  resolveEmulatorRestorePatterns,
  resolveEmulatorSaveLocation,
} from "@main/services/emulators/emulator-save-dirs";
import { resolveSaveBackupPlan } from "@main/services/save-backup-plan";
import type { CloudSavePathContext, CloudSaveRule, GameShop } from "@types";

import {
  cloudSaveCustomPathContextFromPathContext,
  encodeCloudSaveCustomPath,
} from "./custom-path";
import {
  buildGameHubEmulatorRules,
  type EmulatorRemoteFile,
} from "./gamehub-emulator-rules";

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
  remoteFiles?: readonly EmulatorRemoteFile[]
): Promise<CloudSaveRule[]> => {
  const plan = await resolveSaveBackupPlan(shop, objectId);

  if (plan.status === "ready" && plan.source === "manual") {
    const customContext =
      cloudSaveCustomPathContextFromPathContext(pathContext);
    const paths = sortedUniquePaths(plan.paths, pathContext.platform);
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
  });
};
