import { registerEvent } from "../register-event";
import { ps1MemoryCardSavesSublevel, levelKeys } from "@main/level";
import type { MemoryCardSaveRecord } from "@types";

const listPs1MemcardSaves = async (): Promise<MemoryCardSaveRecord[]> => {
  return ps1MemoryCardSavesSublevel.values().all();
};

const forgetPs1MemcardSave = async (
  _event: Electron.IpcMainInvokeEvent,
  cardFilePath: string,
  identifier: string
): Promise<void> => {
  const key = levelKeys.ps1MemoryCardSave(cardFilePath, identifier);
  await ps1MemoryCardSavesSublevel.del(key).catch(() => undefined);
};

const forgetPs1MemcardCard = async (
  _event: Electron.IpcMainInvokeEvent,
  cardFilePath: string
): Promise<void> => {
  const all = await ps1MemoryCardSavesSublevel.values().all();
  const toDelete = all.filter((r) => r.cardFilePath === cardFilePath);
  for (const record of toDelete) {
    const key = levelKeys.ps1MemoryCardSave(
      record.cardFilePath,
      record.folderName
    );
    await ps1MemoryCardSavesSublevel.del(key).catch(() => undefined);
  }
};

registerEvent("listPs1MemcardSaves", listPs1MemcardSaves);
registerEvent("forgetPs1MemcardSave", forgetPs1MemcardSave);
registerEvent("forgetPs1MemcardCard", forgetPs1MemcardCard);
