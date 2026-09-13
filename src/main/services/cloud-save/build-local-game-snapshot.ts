import { SystemPath } from "@main/services/system-path";
import { cloudSaveLocalHashCacheSublevel, levelKeys } from "@main/level";
import type {
  CloudSaveCustomPathBindings,
  GameShop,
  LocalGameSnapshotContext,
  StoreUserContext,
} from "@types";

import { NativeAddon } from "../native-addon";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { getUsableCloudSaveCustomPathBindings } from "./custom-path-overlap";
import { customPathToCloudSaveRule } from "./custom-path-store";
import { getGameHubSavePlanRules } from "./gamehub-save-plan-rules";
import type { EmulatorRemoteFile } from "./gamehub-emulator-rules";
import { canonicalizeEmulatorSnapshot } from "./canonicalize-emulator-snapshot";
import { getAuthoritativeCloudSaveCustomPathRawPaths } from "./authoritative-custom-paths";

interface BuildLocalGameSnapshotContextOptions {
  scanStoreUserContext?: StoreUserContext;
  customPathBindings?: CloudSaveCustomPathBindings;
  identityFiles?: readonly EmulatorRemoteFile[];
}

export const buildLocalGameSnapshotContext = async (
  objectId: string,
  shop: GameShop,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  options: BuildLocalGameSnapshotContextOptions = {}
): Promise<LocalGameSnapshotContext> => {
  const context =
    suppliedContext ?? (await getCloudSaveGameContext(objectId, shop));
  const { game, pathContext, environmentId } = context;
  const cacheKey = levelKeys.game(shop, objectId);
  const [hashCache, customPathBindings, gameHubRules] = await Promise.all([
    cloudSaveLocalHashCacheSublevel.get(cacheKey).then((value) => value ?? []),
    options.customPathBindings
      ? Promise.resolve(options.customPathBindings)
      : getUsableCloudSaveCustomPathBindings(objectId, shop, context),
    getGameHubSavePlanRules(
      objectId,
      shop,
      context.pathContext,
      undefined,
      options.identityFiles
    ),
  ]);
  const customRules = customPathBindings.ready.map(customPathToCloudSaveRule);
  const customPathRawPaths = getAuthoritativeCloudSaveCustomPathRawPaths(
    customPathBindings,
    gameHubRules
  );
  const extraRules = [...customRules, ...gameHubRules].filter(
    (rule, index, rules) =>
      rules.findIndex((candidate) => candidate.rawPath === rule.rawPath) ===
      index
  );
  const { hashCache: updatedHashCache, ...snapshot } =
    await NativeAddon.buildLocalGameSnapshotPipeline({
      ...pathContext,
      storeUserContext:
        options.scanStoreUserContext ?? pathContext.storeUserContext,
      environmentId,
      title: game?.title,
      remoteId: game?.remoteId ?? undefined,
      userDataPath: SystemPath.getPath("userData"),
      hashCache,
      extraRules: extraRules.map(
        ({ canonicalRelativePath: _, ...rule }) => rule
      ),
    });

  if (updatedHashCache.length === 0) {
    await cloudSaveLocalHashCacheSublevel.del(cacheKey);
  } else {
    await cloudSaveLocalHashCacheSublevel.put(cacheKey, updatedHashCache);
  }

  return {
    ...canonicalizeEmulatorSnapshot(
      snapshot,
      gameHubRules,
      pathContext.platform,
      (input) => NativeAddon.buildSnapshotAggregateHash(input)
    ),
    environmentId,
    pathContext,
    customPathRawPaths,
  };
};
