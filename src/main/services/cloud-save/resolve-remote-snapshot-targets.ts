import { logger } from "@main/services/logger";
import { SystemPath } from "@main/services/system-path";
import { Wine } from "@main/services/wine";
import type {
  CloudSavePathContext,
  CloudSaveGameId,
  RemoteGameSnapshot,
  RemoteSnapshotSummary,
  RestoreManifestResponse,
  ResolveRestoreTargetsResult,
} from "@types";

import { NativeAddon } from "../native-addon";
import { validateRestoreManifest } from "./cloud-save-contract";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { cloudSaveCustomPathContextFromPathContext } from "./custom-path";
import { customPathToCloudSaveRule } from "./custom-path-store";
import { getUsableCloudSaveCustomPathBindings } from "./custom-path-overlap";
import { storeUserContextWithSnapshotAccounts } from "./snapshot-store-user-context";
import { getR2CloudSaveSnapshot } from "./r2-snapshot-store";
import { getGameHubSavePlanRules } from "./gamehub-save-plan-rules";

const isWinePrefixValid = (winePrefixPath?: string) => {
  if (!winePrefixPath) return false;
  try {
    return Wine.validatePrefix(winePrefixPath);
  } catch {
    return false;
  }
};

export const getRemoteSnapshotRestoreManifest = async (
  snapshot: RemoteSnapshotSummary | RemoteGameSnapshot,
  gameId: CloudSaveGameId
): Promise<RestoreManifestResponse> => {
  const document = await getR2CloudSaveSnapshot(
    gameId.objectId,
    gameId.shop,
    snapshot.id,
    snapshot.version
  );
  if (!document) throw new Error("cloud_save_restore_snapshot_not_found");
  const manifest = validateRestoreManifest({
    snapshot: {
      id: document.snapshot.id,
      version: document.snapshot.version,
      shop: document.snapshot.shop,
      objectId: document.snapshot.objectId,
    },
    variants: document.variants,
    files: document.files,
  });
  const totalSizeBytes = manifest.files.reduce(
    (total, file) => total + file.sizeBytes,
    0
  );
  if (
    manifest.snapshot.id !== snapshot.id ||
    manifest.snapshot.version !== snapshot.version ||
    manifest.snapshot.shop !== gameId.shop ||
    manifest.snapshot.objectId !== gameId.objectId ||
    manifest.files.length !== snapshot.fileCount ||
    totalSizeBytes !== snapshot.totalSizeBytes ||
    NativeAddon.buildSnapshotAggregateHash({
      variants: manifest.variants,
      files: manifest.files,
    }) !== snapshot.aggregateHash
  ) {
    throw new Error("Restore manifest does not match its snapshot summary");
  }
  return manifest;
};

export const resolveRestoreManifestTargets = async (
  manifest: RestoreManifestResponse,
  suppliedPathContext?: CloudSavePathContext
): Promise<ResolveRestoreTargetsResult> => {
  const gameContext = await getCloudSaveGameContext(
    manifest.snapshot.objectId,
    manifest.snapshot.shop
  );
  const pathContext = suppliedPathContext ?? gameContext.pathContext;
  const effectiveGameContext =
    pathContext === gameContext.pathContext
      ? gameContext
      : { ...gameContext, pathContext };
  const approved = await NativeAddon.getSaveRulesForGame({
    shop: manifest.snapshot.shop,
    objectId: manifest.snapshot.objectId,
    title: gameContext.game?.title,
    remoteId: gameContext.game?.remoteId ?? undefined,
    userDataPath: SystemPath.getPath("userData"),
  });
  const customPathContext =
    cloudSaveCustomPathContextFromPathContext(pathContext);
  const [customPathResult, gameHubRules] = await Promise.all([
    getUsableCloudSaveCustomPathBindings(
      manifest.snapshot.objectId,
      manifest.snapshot.shop,
      effectiveGameContext,
      {
        approvedRules: approved.rules,
        remoteFiles: manifest.files,
      }
    ),
    getGameHubSavePlanRules(
      manifest.snapshot.objectId,
      manifest.snapshot.shop,
      pathContext,
      manifest.files
    ),
  ]);
  const { ready: customPaths } = customPathResult;

  const effectiveWinePrefixPath = customPathContext.winePrefixPath;
  const wineUserProfilePath = customPathContext.wineUserProfilePath;
  const wineProfiles = effectiveWinePrefixPath
    ? Wine.getPrefixUserProfiles(effectiveWinePrefixPath)
    : [];
  const usesWindowsCompatibility =
    pathContext.platform === "linux" &&
    pathContext.executablePath?.toLowerCase().endsWith(".exe") === true;
  const winePrefixIsValid = isWinePrefixValid(effectiveWinePrefixPath);
  logger.info("[Cloud Save] Resolving remote snapshot targets", {
    shop: manifest.snapshot.shop,
    objectId: manifest.snapshot.objectId,
    fileCount: manifest.files.length,
    winePrefixPath: effectiveWinePrefixPath ?? null,
    winePrefixIsValid,
    wineUserProfilePath: wineUserProfilePath ?? null,
    wineProfileCount: wineProfiles.length,
    hasActiveStoreUser: Boolean(pathContext.storeUserContext.active),
    knownStoreUsers: pathContext.storeUserContext.known.length,
  });

  if (usesWindowsCompatibility && !effectiveWinePrefixPath) {
    throw new Error("cloud_save_restore_prefix_unresolved");
  }
  if (usesWindowsCompatibility && !winePrefixIsValid) {
    throw new Error("cloud_save_restore_prefix_invalid");
  }
  if (usesWindowsCompatibility && wineProfiles.length === 0) {
    throw new Error("cloud_save_restore_profile_unresolved");
  }

  const targets = await NativeAddon.resolveRestoreTargets({
    ...pathContext,
    storeUserContext: storeUserContextWithSnapshotAccounts(
      pathContext.storeUserContext,
      manifest.variants
    ),
    winePrefixPath: effectiveWinePrefixPath,
    approvedRules: [
      ...approved.rules.map(({ kind, rawPath, source }) => ({
        kind,
        rawPath,
        source,
        preferredPath: undefined,
      })),
      ...gameHubRules.map(({ kind, rawPath, source, preferredPath }) => ({
        kind,
        rawPath,
        source,
        preferredPath,
      })),
      ...customPaths.map(customPathToCloudSaveRule),
    ].map(({ kind, rawPath, source, preferredPath }) => ({
      kind,
      rawPath,
      source,
      preferredPath,
    })),
    variants: manifest.variants,
    files: manifest.files,
  });
  return targets;
};
