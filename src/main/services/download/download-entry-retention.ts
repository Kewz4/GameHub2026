import { canDiscardDownload } from "../../../types/download-contract";
import type { GameShop } from "../../../types/game.types";
import type { Download } from "../../../types/level.types";

export type DiscardDownloadEntryResult = "missing" | "preserved" | "discarded";

interface DiscardDownloadEntryDependencies {
  read: (downloadKey: string) => Promise<Download | null | undefined>;
  remove: (downloadKey: string) => Promise<void>;
  afterRemove: (identity: {
    shop: GameShop;
    objectId: string;
  }) => Promise<void>;
}

/**
 * Remove terminal history while preserving every record that can still own
 * work (active JS/Python transfer, extraction, queue/pause/error, or seeding).
 * Keeping the storage operations injectable makes the ownership rule
 * deterministic to test without opening the application LevelDB.
 */
export const discardDownloadEntryIfSafe = async (
  downloadKey: string,
  identity: { shop: GameShop; objectId: string },
  dependencies: DiscardDownloadEntryDependencies
): Promise<DiscardDownloadEntryResult> => {
  const download = await dependencies.read(downloadKey);

  if (!download) return "missing";
  if (!canDiscardDownload(download)) return "preserved";

  await dependencies.remove(downloadKey);
  await dependencies.afterRemove(identity);

  return "discarded";
};
