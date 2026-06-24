import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import { ps1MemoryCardSavesSublevel, ps2MemoryCardSavesSublevel } from "@main/level";
import type { EmulationCloudSave, EmulationSavePlatform, MemcardRestoreTarget } from "@types";

const listEmulationSaves = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform,
  objectId?: string | null
): Promise<EmulationCloudSave[]> => {
  return emulators.listEmulationSaves(platform, objectId ?? undefined);
};

const getMemcardRestoreTargets = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform
): Promise<MemcardRestoreTarget[]> => {
  const sublevel = platform === "ps2" ? ps2MemoryCardSavesSublevel : ps1MemoryCardSavesSublevel;
  const records = await sublevel.values().all();

  const seen = new Set<string>();
  const targets: MemcardRestoreTarget[] = [];

  for (const record of records) {
    if (!seen.has(record.cardFilePath)) {
      seen.add(record.cardFilePath);
      targets.push({
        cardFilePath: record.cardFilePath,
        cardLabel: record.cardLabel,
      });
    }
  }

  return targets;
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
