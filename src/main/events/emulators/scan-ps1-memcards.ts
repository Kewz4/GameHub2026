import { randomUUID } from "node:crypto";
import path from "node:path";

import { registerEvent } from "../register-event";
import { WindowManager, emulators, logger } from "@main/services";
import { ps1MemoryCardSavesSublevel, levelKeys, gamesShopAssetsSublevel, gamesSublevel } from "@main/level";
import type { Ps2MemcardScanInput, Ps2MemcardScanProgress, MemoryCardSaveRecord } from "@types";

const CHANNEL = "on-ps1-memcard-scan-progress";
const inflight = new Map<string, { cancelled: boolean }>();

const send = (requestId: string, progress: Ps2MemcardScanProgress): void => {
  WindowManager.sendToAppWindows(`${CHANNEL}:${requestId}`, progress);
};

const scanPs1Memcards = async (
  _event: Electron.IpcMainInvokeEvent,
  input: Ps2MemcardScanInput
): Promise<void> => {
  const requestId = randomUUID();
  const signal = { cancelled: false };
  inflight.set(requestId, signal);

  try {
    const cardFiles = emulators.findPs1MemcardFiles();

    if (input.autoDetect === false && input.manualPaths?.length) {
      cardFiles.push(...input.manualPaths);
    }

    send(requestId, { type: "scan_progress", processed: 0, total: cardFiles.length, currentCard: null });

    let totalSaveCount = 0;
    let matched = 0;
    let unmatched = 0;

    for (let i = 0; i < cardFiles.length; i++) {
      if (signal.cancelled) {
        send(requestId, { type: "cancelled", cardCount: i, saveCount: totalSaveCount });
        return;
      }

      const cardFilePath = cardFiles[i];
      const cardLabel = path.basename(cardFilePath);

      send(requestId, { type: "scan_progress", processed: i, total: cardFiles.length, currentCard: cardLabel });

      let saveEntries: { identifier: string; fileSize: number; blockCount: number; blockIndices: number[] }[] = [];
      try {
        saveEntries = await emulators.scanPs1MemoryCard(cardFilePath);
      } catch (err) {
        logger.error("Failed to scan PS1 memcard", { cardFilePath, err });
        continue;
      }

      for (let j = 0; j < saveEntries.length; j++) {
        if (signal.cancelled) break;
        const save = saveEntries[j];
        totalSaveCount++;

        const existingKey = levelKeys.ps1MemoryCardSave(cardFilePath, save.identifier);
        const existing = await ps1MemoryCardSavesSublevel.get(existingKey).catch(() => undefined);

        let objectId: string | null = existing?.objectId ?? null;
        let title: string | null = existing?.title ?? null;
        let iconUrl: string | null = existing?.iconUrl ?? null;
        let libraryImageUrl: string | null = existing?.libraryImageUrl ?? null;
        let libraryHeroImageUrl: string | null = existing?.libraryHeroImageUrl ?? null;
        let logoImageUrl: string | null = existing?.logoImageUrl ?? null;
        let shop: "launchbox" | null = existing?.shop ?? null;

        if (!objectId) {
          try {
            const normalizedId = save.identifier.toUpperCase().replace(/[_-]/g, "");
            const allGames = await gamesSublevel.values().all();
            for (const game of allGames) {
              if (game.shop !== "launchbox") continue;
              const gameSkus: string[] = (game as unknown as Record<string, unknown>).skus as string[] ?? [];
              const matches = gameSkus.some(
                (sku) => sku.toUpperCase().replace(/[_-]/g, "") === normalizedId
              );
              if (matches) {
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
          } catch { /* ignore */ }
        }

        const sizeBytes = save.blockCount * 8192;
        const record: MemoryCardSaveRecord = {
          cardFilePath, cardLabel,
          folderName: save.identifier,
          sku: null, objectId, shop, title,
          iconUrl, libraryImageUrl, libraryHeroImageUrl, logoImageUrl,
          fileCount: save.blockCount,
          sizeBytes,
          createdAt: 0,
          modifiedAt: 0,
          detectedAt: Date.now(),
        };

        await ps1MemoryCardSavesSublevel.put(existingKey, record);
        if (objectId) matched++; else unmatched++;

        send(requestId, {
          type: "match_progress", processed: j + 1, total: saveEntries.length,
          currentSave: save.identifier, status: objectId ? "matched" : "unmatched",
          matched, unmatched,
        });
      }
    }

    send(requestId, { type: "done", cardCount: cardFiles.length, saveCount: totalSaveCount, matched, unmatched });
  } catch (err) {
    logger.error("PS1 memcard scan failed", err);
    send(requestId, { type: "error", message: String(err) });
  } finally {
    inflight.delete(requestId);
  }
};

const cancelPs1MemcardScan = async (
  _event: Electron.IpcMainInvokeEvent,
  requestId: string
): Promise<void> => {
  const signal = inflight.get(requestId);
  if (signal) signal.cancelled = true;
};

registerEvent("scanPs1Memcards", scanPs1Memcards);
registerEvent("cancelPs1MemcardScan", cancelPs1MemcardScan);
