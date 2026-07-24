import { appVersion, defaultDownloadsPath, isStaging } from "@main/constants";
import { ipcMain } from "electron";

import "./achievements";
import "./auth";
import "./autoupdater";
import "./main-window-controls";
import "./emulators";
import "./friends";
import "./big-picture";
import "./catalogue";
import "./cloud-save";
import "./connectivity";
import "./download-sources";
import "./hardware";
import "./library";
import "./leveldb";
import "./misc";
import "./notifications";
import "./overlay";
import "./profile";
import "./themes";
import "./torrenting";
import "./user";
import "./user-preferences";
import "./library/transfer-game-files";
import "./library/run-cloud-debugger";
import "./installer";

import { isPortableVersion } from "@main/helpers";
import { WindowManager } from "@main/services";

ipcMain.handle("ping", () => "pong");
ipcMain.handle("getVersion", () => appVersion);
ipcMain.handle("isStaging", () => isStaging);
ipcMain.handle("isPortableVersion", () => isPortableVersion());
ipcMain.handle("getDefaultDownloadsPath", () => defaultDownloadsPath);
ipcMain.handle("openConsoleWindow", () => WindowManager.createConsoleWindow());
