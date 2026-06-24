import { randomUUID } from "node:crypto";
import path from "node:path";

import { registerEvent } from "../register-event";
import { WindowManager, emulators, logger } from "@main/services";
import {
  ps2MemoryCardSavesSublevel,
  levelKeys,
  gamesShopAssetsSublevel,
  gamesSublevel,
} from "@main/level";
import type {
  Ps2MemcardScanInput,
  Ps2MemcardScanProgress,
  MemoryCardSaveRecord,
} from "@types";

const CHANNEL = "on-ps2-memcard-scan-progress";
const inflight = new Map<string, { cancelled: boolean }>();

const send = (requestId: string, progress: Ps2MemcardScanProgress): void => {
  WindowManager.sendToAppWindows(`${CHANNEL}:${requestId}`, progress);
};

const scanPs2Memcards = async (
  _event: Electron.IpcMainInvokeEvent,
  input: Ps2MemcardScanInput
): Promise<void> => {
  const requestId = randomUUID();
  const signal = { cancelled: false };
  inflight.set(requestId, signal);

  try {
    const config = await emulators.getEmulatorConfig("ps2");
    const cardFiles = emulators.findPs2MemcardFiles(
      config.executablePath ?? null
    );

    if (input.autoDetect === false && input.manualPaths?.length) {
      cardFiles.push(...input.manualPaths);
    }

    send(requestId, {
      type: "scan_progress",
      processed: 0,
      total: cardFiles.length,
      currentCard: null,
    });

    let totalSaveCount = 0;
    let matched = 0;
    let unmatched = 0;

    for (let i = 0; i < cardFiles.length; i++) {
      if (signal.cancelled) {
        send(requestId, {
          type: "cancelled",
          cardCount: i,
          saveCount: totalSaveCount,
        });
        return;
      }

      const cardFilePath = cardFiles[i];
      const cardLabel = path.basename(cardFilePath);

      send(requestId, {
        type: "scan_progress",
        processed: i,
        total: cardFiles.length,
        currentCard: cardLabel,
      });

      let saveEntries: {
        folderName: string;
        fileCount: number;
        sizeBytes: number;
        createdAt: number;
        modifiedAt: number;
      }[] = [];
      try {
        saveEntries = await emulators.scanPs2MemoryCard(cardFilePath);
      } catch (err) {
        logger.error("Failed to scan PS2 memcard", { cardFilePath, err });
        continue;
      }

      for (let j = 0; j < saveEntries.length; j++) {
        if (signal.cancelled) break;
        const save = saveEntries[j];
        totalSaveCount++;

        const existingKey = levelKeys.ps2MemoryCardSave(
          cardFilePath,
          save.folderName
        );
        const existing = await ps2MemoryCardSavesSublevel
          .get(existingKey)
          .catch(() => undefined);

        let objectId: string | null = existing?.objectId ?? null;
        let title: string | null = existing?.title ?? null;
        let iconUrl: string | null = existing?.iconUrl ?? null;
        let libraryImageUrl: string | null = existing?.libraryImageUrl ?? null;
        let libraryHeroImageUrl: string | null =
          existing?.libraryHeroImageUrl ?? null;
        let logoImageUrl: string | null = existing?.logoImageUrl ?? null;
        let shop: "launchbox" | null = existing?.shop ?? null;

        if (!objectId) {
          try {
            const normalizedFolder = save.folderName
              .toUpperCase()
              .replace(/[_-]/g, "");
            const allGames = await gamesSublevel.values().all();
            for (const game of allGames) {
              if (game.shop !== "launchbox") continue;
              const gameSkus: string[] =
                ((game as unknown as Record<string, unknown>)
                  .skus as string[]) ?? [];
              const matchesSku = gameSkus.some(
                (sku) =>
                  sku.toUpperCase().replace(/[_-]/g, "") === normalizedFolder
              );
              if (matchesSku) {
                objectId = game.objectId;
                shop = "launchbox";
                title = game.title ?? null;
                const assets = await gamesShopAssetsSublevel
                  .get(levelKeys.game(game.shop, game.objectId))
                  .catch(() => undefined);
                if (assets) {
                  iconUrl = assets.iconUrl ?? null;
                  libraryImageUrl = assets.libraryImageUrl ?? null;
                  libraryHeroImageUrl = assets.libraryHeroImageUrl ?? null;
                  logoImageUrl = assets.logoImageUrl ?? null;
                }
                break;
              }
            }
          } catch {
            /* ignore */
          }
        }

        const record: MemoryCardSaveRecord = {
          cardFilePath,
          cardLabel,
          folderName: save.folderName,
          sku: null,
          objectId,
          shop,
          title,
          iconUrl,
          libraryImageUrl,
          libraryHeroImageUrl,
          logoImageUrl,
          fileCount: save.fileCount,
          sizeBytes: save.sizeBytes,
          createdAt: save.createdAt,
          modifiedAt: save.modifiedAt,
          detectedAt: Date.now(),
        };

        await ps2MemoryCardSavesSublevel.put(existingKey, record);
        if (objectId) matched++;
        else unmatched++;

        send(requestId, {
          type: "match_progress",
          processed: j + 1,
          total: saveEntries.length,
          currentSave: save.folderName,
          status: objectId ? "matched" : "unmatched",
          matched,
          unmatched,
        });
      }
    }

    send(requestId, {
      type: "done",
      cardCount: cardFiles.length,
      saveCount: totalSaveCount,
      matched,
      unmatched,
    });
  } catch (err) {
    logger.error("PS2 memcard scan failed", err);
    send(requestId, { type: "error", message: String(err) });
  } finally {
    inflight.delete(requestId);
  }
};

const cancelPs2MemcardScan = async (
  _event: Electron.IpcMainInvokeEvent,
  requestId: string
): Promise<void> => {
  const signal = inflight.get(requestId);
  if (signal) signal.cancelled = true;
};

registerEvent("scanPs2Memcards", scanPs2Memcards);
registerEvent("cancelPs2MemcardScan", cancelPs2MemcardScan);
