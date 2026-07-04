import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { CemuGraphicPack } from "@types";

const listCemuGraphicPacks = async (
  _event: Electron.IpcMainInvokeEvent,
  titleId?: string | null
): Promise<{ hasLibrary: boolean; packs: CemuGraphicPack[] }> => {
  const [hasLibrary, packs] = await Promise.all([
    emulators.hasGraphicPacksLibrary(),
    emulators.listGraphicPacks(titleId ?? null),
  ]);
  return { hasLibrary, packs };
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
