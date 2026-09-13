import { existsSync } from "node:fs";
import path from "node:path";

import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import {
  ps1MemoryCardSavesSublevel,
  ps2MemoryCardSavesSublevel,
} from "@main/level";
import type {
  EmulationCloudSave,
  EmulationSavePlatform,
  MemcardRestoreTarget,
} from "@types";

const listEmulationSaves = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform,
  objectId?: string | null
): Promise<EmulationCloudSave[]> => {
  emulators.assertEmulationSavePlatform(platform);
  return emulators.listEmulationSaves(platform, objectId ?? undefined);
};

const getMemcardRestoreTargets = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform
): Promise<MemcardRestoreTarget[]> => {
  emulators.assertEmulationSavePlatform(platform);
  const sublevel =
    platform === "ps2"
      ? ps2MemoryCardSavesSublevel
      : ps1MemoryCardSavesSublevel;
  const records = await sublevel.values().all();

  const seen = new Set<string>();
  const targets: MemcardRestoreTarget[] = [];

  for (const record of records) {
    const cardFilePath = path.resolve(record.cardFilePath);
    const identity =
      process.platform === "win32" ? cardFilePath.toLowerCase() : cardFilePath;
    if (
      !seen.has(identity) &&
      existsSync(cardFilePath) &&
      emulators.isMemoryCardPathForPlatform(platform, cardFilePath)
    ) {
      seen.add(identity);
      targets.push({
        cardFilePath,
        cardLabel: record.cardLabel,
      });
    }
  }

  return targets.sort((left, right) =>
    left.cardFilePath.localeCompare(right.cardFilePath)
  );
};

const deleteEmulationSave = async (
  _event: Electron.IpcMainInvokeEvent,
  saveId: string
): Promise<void> => {
  await emulators.deleteEmulationSave(saveId);
};

const updateEmulationSaveLabel = async (
  _event: Electron.IpcMainInvokeEvent,
  saveId: string,
  label: string
): Promise<EmulationCloudSave> => {
  return emulators.updateEmulationSaveLabel(saveId, label);
};

registerEvent("listEmulationSaves", listEmulationSaves);
registerEvent("getMemcardRestoreTargets", getMemcardRestoreTargets);
registerEvent("deleteEmulationSave", deleteEmulationSave);
registerEvent("updateEmulationSaveLabel", updateEmulationSaveLabel);
