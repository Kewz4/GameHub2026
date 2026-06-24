import { registerEvent } from "../register-event";
import { ps2MemoryCardSavesSublevel, levelKeys } from "@main/level";
import type { MemoryCardSaveRecord } from "@types";

const listPs2MemcardSaves = async (): Promise<MemoryCardSaveRecord[]> => {
  return ps2MemoryCardSavesSublevel.values().all();
};

const forgetPs2MemcardSave = async (
  _event: Electron.IpcMainInvokeEvent,
  cardFilePath: string,
  folderName: string
): Promise<void> => {
  const key = levelKeys.ps2MemoryCardSave(cardFilePath, folderName);
  await ps2MemoryCardSavesSublevel.del(key).catch(() => undefined);
};

const forgetPs2MemcardCard = async (
  _event: Electron.IpcMainInvokeEvent,
  cardFilePath: string
): Promise<void> => {
  const all = await ps2MemoryCardSavesSublevel.values().all();
  const toDelete = all.filter((r) => r.cardFilePath === cardFilePath);
  for (const record of toDelete) {
    const key = levelKeys.ps2MemoryCardSave(record.cardFilePath, record.folderName);
    await ps2MemoryCardSavesSublevel.del(key).catch(() => undefined);
  }
};

registerEvent("listPs2MemcardSaves", listPs2MemcardSaves);
registerEvent("forgetPs2MemcardSave", forgetPs2MemcardSave);
registerEvent("forgetPs2MemcardCard", forgetPs2MemcardCard);
