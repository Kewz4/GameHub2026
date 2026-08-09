import { gamesSublevel } from "@main/level";
import type { CloudSaveV2LibraryEntry } from "@types";

import { R2Sync } from "../r2-sync";
import {
  assertCloudSaveAccountSessionCurrent,
  runWithCloudSaveAccountSession,
} from "./account-session";
import { mergeCloudSaveV2LibraryMetadata } from "./cloud-save-v2-library-index";
import { getCloudSaveR2UserId } from "./r2-snapshot-store";

export const listCloudSaveV2Library = (): Promise<CloudSaveV2LibraryEntry[]> =>
  runWithCloudSaveAccountSession(async () => {
    const [entries, games] = await Promise.all([
      R2Sync.listCloudSaveV2Snapshots(await getCloudSaveR2UserId()),
      gamesSublevel.iterator().all(),
    ]);
    const library = mergeCloudSaveV2LibraryMetadata(
      entries,
      games.map(([, game]) => game)
    );
    assertCloudSaveAccountSessionCurrent();
    return library;
  });
