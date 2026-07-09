import { registerEvent } from "../register-event";
import { dialog } from "electron";
import { emulators, gamebanana } from "@main/services";
import { WindowManager } from "@main/services/window-manager";
import { ukmmPaths } from "@main/services/emulators/ukmm";
import type {
  GameBananaMod,
  GameBananaModDetail,
  GameShop,
  ModInstallPrep,
  ModManagerStatus,
} from "@types";
import fs from "node:fs";
import path from "node:path";

const getModStatus = async (
  _e: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<ModManagerStatus> => emulators.getModStatus(shop, objectId);

const installUkmm = async (): Promise<{ ok: boolean; reason?: string }> =>
  emulators.installUkmm();

const setModsEnabled = async (
  _e: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  enabled: boolean
): Promise<{ ok: boolean }> =>
  emulators.setModsEnabled(shop, objectId, enabled);

const browseGameBananaMods = async (
  _e: Electron.IpcMainInvokeEvent,
  opts: {
    page?: number;
    sort?: "newest" | "updated" | "likes" | "downloads";
    categoryId?: number | null;
    search?: string;
  }
): Promise<GameBananaMod[]> => gamebanana.listBotwMods(opts ?? {});

const listModCategories = async (): Promise<{ id: number; name: string }[]> =>
  gamebanana.listCategories();

const getGameBananaMod = async (
  _e: Electron.IpcMainInvokeEvent,
  modId: number
): Promise<GameBananaModDetail | null> => gamebanana.getModDetail(modId);

/**
 * Install a mod fully headlessly: download the GameBanana file, extract + stage
 * it, and either finalize immediately or — when the mod has selectable options —
 * return them so the renderer can show the chooser and call `finalizeModInstall`.
 * No UKMM CLI, no GUI: the mod is deployed straight into Cemu as a graphic pack.
 */
const installMod = async (
  _e: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  modId: number,
  fileId?: number
): Promise<ModInstallPrep> => {
  const detail = await gamebanana.getModDetail(modId);
  if (!detail || detail.files.length === 0) {
    return { ok: false, reason: "This mod has no downloadable files" };
  }
  const file = detail.files.find((f) => f.id === fileId) ?? detail.files[0];

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

  const prep = await emulators.prepareBnpInstall(filePath, {
    gbModId: modId,
    name: detail.name,
    thumbnailUrl: detail.gallery[0] ?? null,
  });
  if (!prep.ok) {
    cleanupFile(filePath);
    return prep;
  }
  if (prep.needsOptions) return prep; // renderer will show the chooser
  // No options — install + deploy now, then clean up the download.
  const res = await emulators.finalizeBnpInstall(
    shop,
    objectId,
    prep.stagingId!,
    []
  );
  cleanupFile(filePath);
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
};

/** Delete a downloaded mod file once we're done with it (best effort). */
const cleanupFile = (filePath: string): void => {
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* best effort */
  }
};

/** Finalize a staged install with the user's chosen option folders. */
const finalizeModInstall = async (
  _e: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  stagingId: string,
  selectedFolders: string[]
): Promise<{ ok: boolean; reason?: string }> =>
  emulators.finalizeBnpInstall(shop, objectId, stagingId, selectedFolders ?? []);

/** Discard a staged install the user backed out of (frees temp files). */
const cancelModInstall = async (
  _e: Electron.IpcMainInvokeEvent,
  stagingId: string
): Promise<void> => emulators.cancelBnpInstall(stagingId);

/**
 * Install a mod from a `bcml:` 1-click URI, fully headlessly: resolve the URI to
 * a GameBanana download, fetch it, and route it through the same native staging
 * pipeline as a normal install.
 */
const installModFromBcmlUri = async (
  _e: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  uri: string
): Promise<ModInstallPrep> => {
  if (!/^bcml:/i.test(uri)) return { ok: false, reason: "Invalid bcml link" };
  const url = gamebanana.resolveBcmlUri(uri);
  if (!url) return { ok: false, reason: "Couldn't parse the bcml link" };

  const downloadDir = ukmmPaths().downloadDir;
  fs.mkdirSync(downloadDir, { recursive: true });
  let filePath: string;
  try {
    filePath = await gamebanana.downloadModFile(
      url,
      downloadDir,
      `oneclick-${Date.now()}.bnp`
    );
  } catch (err) {
    return { ok: false, reason: `Download failed: ${err}` };
  }

  const prep = await emulators.prepareBnpInstall(filePath, {
    gbModId: 0,
    name: path.basename(uri).slice(0, 40) || "BOTW mod",
    thumbnailUrl: null,
  });
  if (!prep.ok) {
    cleanupFile(filePath);
    return prep;
  }
  if (prep.needsOptions) return prep;
  const res = await emulators.finalizeBnpInstall(
    shop,
    objectId,
    prep.stagingId!,
    []
  );
  cleanupFile(filePath);
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
};

const uninstallMod = async (
  _e: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  index: number
): Promise<{ ok: boolean; reason?: string }> =>
  emulators.uninstallMod(shop, objectId, index);

const exportModpack = async (
  _e: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<{ ok: boolean; reason?: string; canceled?: boolean }> => {
  const win = WindowManager.mainWindow;
  const result = await dialog.showSaveDialog(win!, {
    title: "Export modpack",
    defaultPath: "botw-modpack.ghmods",
    filters: [{ name: "GameHub modpack", extensions: ["ghmods"] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  return emulators.exportModpack(shop, objectId, result.filePath);
};

const importModpack = async (
  _e: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<{ ok: boolean; reason?: string; canceled?: boolean }> => {
  const win = WindowManager.mainWindow;
  const result = await dialog.showOpenDialog(win!, {
    title: "Import modpack",
    properties: ["openFile"],
    filters: [{ name: "GameHub modpack", extensions: ["ghmods"] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }
  return emulators.importModpack(shop, objectId, result.filePaths[0]);
};

registerEvent("getModStatus", getModStatus);
registerEvent("installUkmm", installUkmm);
registerEvent("setModsEnabled", setModsEnabled);
registerEvent("browseGameBananaMods", browseGameBananaMods);
registerEvent("listModCategories", listModCategories);
registerEvent("getGameBananaMod", getGameBananaMod);
registerEvent("installMod", installMod);
registerEvent("finalizeModInstall", finalizeModInstall);
registerEvent("cancelModInstall", cancelModInstall);
registerEvent("installModFromBcmlUri", installModFromBcmlUri);
registerEvent("uninstallMod", uninstallMod);
registerEvent("exportModpack", exportModpack);
registerEvent("importModpack", importModpack);
