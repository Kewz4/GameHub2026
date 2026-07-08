import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { CemuGraphicPack, GameShop } from "@types";

const listCemuGraphicPacks = async (
  _event: Electron.IpcMainInvokeEvent,
  shop?: GameShop | null,
  objectId?: string | null,
  showAll?: boolean
): Promise<{
  hasLibrary: boolean;
  packs: CemuGraphicPack[];
  titleId: string | null;
  scoped: boolean;
}> => {
  // Resolve the specific game's Wii U title id so only its packs are listed.
  const titleId =
    shop && objectId
      ? await emulators.resolveWiiuTitleId(shop, objectId)
      : null;

  // Scope to the game's title id unless the caller explicitly wants everything
  // (or we couldn't identify the game, in which case listing all is the only
  // useful fallback).
  const filterId = showAll ? null : titleId;

  const [hasLibrary, packs] = await Promise.all([
    emulators.hasGraphicPacksLibrary(),
    emulators.listGraphicPacks(filterId),
  ]);
  return { hasLibrary, packs, titleId, scoped: Boolean(filterId) };
};

const downloadCemuGraphicPacks = async (): Promise<{
  ok: boolean;
  count: number;
  reason?: string;
}> => {
  return emulators.downloadGraphicPacks();
};

const setCemuGraphicPackEnabled = async (
  _event: Electron.IpcMainInvokeEvent,
  id: string,
  enabled: boolean
): Promise<boolean> => {
  return emulators.setGraphicPackEnabled(id, enabled);
};

const setCemuGraphicPackPreset = async (
  _event: Electron.IpcMainInvokeEvent,
  id: string,
  category: string,
  preset: string
): Promise<boolean> => {
  return emulators.setGraphicPackPreset(id, category, preset);
};

registerEvent("listCemuGraphicPacks", listCemuGraphicPacks);
registerEvent("downloadCemuGraphicPacks", downloadCemuGraphicPacks);
registerEvent("setCemuGraphicPackEnabled", setCemuGraphicPackEnabled);
registerEvent("setCemuGraphicPackPreset", setCemuGraphicPackPreset);
