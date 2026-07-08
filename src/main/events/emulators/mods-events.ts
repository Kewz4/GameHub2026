import { registerEvent } from "../register-event";
import { emulators, gamebanana } from "@main/services";
import { ukmmPaths } from "@main/services/emulators/ukmm";
import type {
  GameBananaMod,
  GameBananaModDetail,
  GameShop,
  ModManagerStatus,
} from "@types";
import path from "node:path";
import fs from "node:fs";

const getModStatus = async (
  _e: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<ModManagerStatus> => emulators.getModStatus(shop, objectId);

const installUkmm = async (): Promise<{ ok: boolean; reason?: string }> =>
  emulators.installUkmm();

const setModsEnabled = async (
  _e: Electron.IpcMainInvokeEvent,
  enabled: boolean
): Promise<{ ok: boolean }> => emulators.setModsEnabled(enabled);

const browseGameBananaMods = async (
  _e: Electron.IpcMainInvokeEvent,
  page: number
): Promise<GameBananaMod[]> => gamebanana.listBotwMods(page);

const getGameBananaMod = async (
  _e: Electron.IpcMainInvokeEvent,
  modId: number
): Promise<GameBananaModDetail | null> => gamebanana.getModDetail(modId);

/**
 * Install a mod: download the GameBanana file, then hand it to UKMM. `fileId`
 * is optional — when omitted the mod's first (usually only) file is used.
 */
const installMod = async (
  _e: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  modId: number,
  fileId?: number
): Promise<{ ok: boolean; reason?: string }> => {
  const detail = await gamebanana.getModDetail(modId);
  if (!detail || detail.files.length === 0) {
    return { ok: false, reason: "This mod has no downloadable files" };
  }
  const file =
    detail.files.find((f) => f.id === fileId) ?? detail.files[0];

  const downloadDir = ukmmPaths().downloadDir;
  fs.mkdirSync(downloadDir, { recursive: true });
  let filePath: string;
  try {
    filePath = await gamebanana.downloadModFile(
      file.downloadUrl,
      downloadDir,
      file.fileName
    );
  } catch (err) {
    return { ok: false, reason: `Download failed: ${err}` };
  }

  const res = await emulators.installModFromFile(shop, objectId, filePath, {
    gbModId: modId,
    name: detail.name,
    thumbnailUrl: detail.gallery[0] ?? null,
  });
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* best effort */
  }
  return res;
};

/** Install a mod from a bcml: 1-click URI (bcml:https://…/mmdl/<id>,Mod,<id>). */
const installModFromBcmlUri = async (
  _e: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  uri: string
): Promise<{ ok: boolean; reason?: string }> => {
  const url = gamebanana.resolveBcmlUri(uri);
  if (!url) return { ok: false, reason: "Invalid bcml install link" };
  const downloadDir = ukmmPaths().downloadDir;
  fs.mkdirSync(downloadDir, { recursive: true });
  const fileName = `bcml-${Date.now()}.bnp`;
  let filePath: string;
  try {
    filePath = await gamebanana.downloadModFile(url, downloadDir, fileName);
  } catch (err) {
    return { ok: false, reason: `Download failed: ${err}` };
  }
  const res = await emulators.installModFromFile(shop, objectId, filePath, {
    gbModId: 0,
    name: path.basename(fileName),
    thumbnailUrl: null,
  });
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* best effort */
  }
  return res;
};

const uninstallMod = async (
  _e: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  index: number
): Promise<{ ok: boolean; reason?: string }> =>
  emulators.uninstallMod(shop, objectId, index);

registerEvent("getModStatus", getModStatus);
registerEvent("installUkmm", installUkmm);
registerEvent("setModsEnabled", setModsEnabled);
registerEvent("browseGameBananaMods", browseGameBananaMods);
registerEvent("getGameBananaMod", getGameBananaMod);
registerEvent("installMod", installMod);
registerEvent("installModFromBcmlUri", installModFromBcmlUri);
registerEvent("uninstallMod", uninstallMod);
