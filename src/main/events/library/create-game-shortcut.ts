import { registerEvent } from "../register-event";
import createDesktopShortcut from "create-desktop-shortcuts";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { app } from "electron";
import axios from "axios";
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { removeSymbolsFromName } from "@shared";
import { GameShop, ShortcutLocation } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { SystemPath } from "@main/services/system-path";
import { ASSETS_PATH } from "@main/constants";
import { getGameAssets } from "../catalogue/get-game-assets";
import { logger } from "@main/services";
import {
  buildLinuxGameDesktopEntry,
  getLinuxApplicationsDirectory,
  getLinuxLauncherExecutable,
} from "@main/services/linux-desktop-entry";

const isValidUrl = (url: string | null | undefined): url is string => {
  return (
    !!url &&
    (url.startsWith("http://") ||
      url.startsWith("https://") ||
      url.startsWith("local:"))
  );
};

const isIcoUrl = (url: string): boolean => {
  return url.toLowerCase().endsWith(".ico");
};

const downloadIcon = async (
  shop: GameShop,
  objectId: string,
  iconUrls: (string | null | undefined)[]
): Promise<string | null> => {
  const validUrls = iconUrls.filter(isValidUrl);

  if (validUrls.length === 0) {
    logger.warn("No valid icon URLs found for game shortcut");
    return null;
  }

  const urlHash = Buffer.from(validUrls[0])
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .substring(0, 16);
  const iconDir = path.join(ASSETS_PATH, `${shop}-${objectId}`);
  const useIco = process.platform === "win32";
  const iconPath = path.join(
    iconDir,
    `icon-${urlHash}.${useIco ? "ico" : "png"}`
  );

  try {
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
  } catch {
    // Ignore fs errors
  }

  fs.mkdirSync(iconDir, { recursive: true });

  for (const iconUrl of validUrls) {
    try {
      logger.log(`Trying to download/read icon from: ${iconUrl}`);

      let imageBuffer: Buffer;
      if (iconUrl.startsWith("local:")) {
        const localPath = iconUrl.slice("local:".length);
        imageBuffer = fs.readFileSync(localPath);
      } else {
        const response = await axios.get(iconUrl, {
          responseType: "arraybuffer",
        });
        imageBuffer = Buffer.from(response.data);
      }

      // If source is already ICO, use it directly
      if (useIco && isIcoUrl(iconUrl)) {
        fs.writeFileSync(iconPath, imageBuffer);
        logger.log(`Copied ICO directly to: ${iconPath}`);
        return iconPath;
      }

      // Convert to square PNG (256x256 is standard for ICO), then to ICO
      const pngBuffer = await sharp(imageBuffer)
        .resize(256, 256, { fit: "cover" })
        .png()
        .toBuffer();
      fs.writeFileSync(
        iconPath,
        useIco ? await pngToIco(pngBuffer) : pngBuffer
      );

      logger.log(`Successfully created icon at: ${iconPath}`);
      return iconPath;
    } catch (error) {
      logger.warn(`Failed to convert icon from ${iconUrl}:`, error);
    }
  }

  logger.error("Failed to download/convert game icon from any source");
  return null;
};

const createUrlShortcut = (
  shortcutPath: string,
  url: string,
  iconPath?: string | null
): boolean => {
  try {
    fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });

    // Delete existing shortcut first so icon updates properly
    if (fs.existsSync(shortcutPath)) {
      fs.unlinkSync(shortcutPath);
    }

    let content = `[InternetShortcut]\nURL=${url}\n`;

    if (iconPath) {
      content += `IconFile=${iconPath}\nIconIndex=0\n`;
    }

    logger.log(`Creating shortcut at: ${shortcutPath}`);
    logger.log(`Shortcut content:\n${content}`);

    fs.writeFileSync(shortcutPath, content);
    return true;
  } catch (error) {
    logger.error("Failed to create URL shortcut", error);
    return false;
  }
};

const deleteIfExists = (filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    logger.warn(`Failed to delete existing shortcut: ${filePath}`, error);
  }
};

const buildRunDeepLink = (shop: GameShop, objectId: string) => {
  const query = new URLSearchParams({
    shop,
    objectId,
  });

  return `hydralauncher://run?${query.toString()}`;
};

const quoteLinuxExecArg = (value: string) => {
  return `"${value.replaceAll('"', '\\"')}"`;
};

const getShortcutArguments = (deepLink: string) => {
  const deepLinkArgument =
    process.platform === "linux" ? quoteLinuxExecArg(deepLink) : deepLink;

  if (process.defaultApp && process.argv.length >= 2) {
    const appEntry = path.resolve(process.argv[1]);
    const appEntryArgument =
      process.platform === "linux" ? quoteLinuxExecArg(appEntry) : appEntry;

    return `${appEntryArgument} ${deepLinkArgument}`;
  }

  return deepLinkArgument;
};

const getWindowsOutputPath = (location: ShortcutLocation) => {
  return location === "desktop"
    ? SystemPath.getPath("desktop")
    : path.join(
        SystemPath.getPath("appData"),
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs"
      );
};

const createWindowsShortcut = (
  shortcutName: string,
  outputPath: string,
  deepLink: string,
  iconPath?: string | null
) => {
  const windowVbsPath = app.isPackaged
    ? path.join(process.resourcesPath, "windows.vbs")
    : undefined;

  const linkPath = path.join(outputPath, `${shortcutName}.lnk`);
  const urlPath = path.join(outputPath, `${shortcutName}.url`);

  deleteIfExists(linkPath);
  deleteIfExists(urlPath);

  const nativeShortcutCreated = createDesktopShortcut({
    windows: {
      filePath: process.execPath,
      arguments: deepLink,
      name: shortcutName,
      outputPath,
      icon: iconPath ?? process.execPath,
      VBScriptPath: windowVbsPath,
    },
  });

  if (nativeShortcutCreated) {
    return true;
  }

  return createUrlShortcut(urlPath, deepLink, iconPath ?? process.execPath);
};

const createGameShortcut = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  location: ShortcutLocation
): Promise<boolean> => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) {
    throw new Error("Could not find this game in your library.");
  }

  if (
    location === "start_menu" &&
    !["win32", "linux"].includes(process.platform)
  ) {
    throw new Error("Start Menu shortcuts are only available on Windows.");
  }

  const shortcutName =
    removeSymbolsFromName(game.title).trim() || game.objectId;
  const deepLink = buildRunDeepLink(shop, objectId);
  const shortcutArguments = getShortcutArguments(deepLink);
  const outputPath =
    process.platform === "win32"
      ? getWindowsOutputPath(location)
      : process.platform === "linux" && location === "start_menu"
        ? getLinuxApplicationsDirectory(SystemPath.getPath("home"))
        : SystemPath.getPath("desktop");

  if (!outputPath) {
    throw new Error("Could not resolve the shortcut output folder.");
  }

  fs.mkdirSync(outputPath, { recursive: true });

  const assets = shop === "custom" ? null : await getGameAssets(objectId, shop);
  const iconPath = await downloadIcon(shop, objectId, [
    game.customIconUrl,
    assets?.iconUrl,
    game.iconUrl,
    assets?.coverImageUrl,
  ]);

  if (process.platform === "win32") {
    const success = createWindowsShortcut(
      shortcutName,
      outputPath,
      deepLink,
      iconPath
    );

    if (!success) {
      const locationName = location === "desktop" ? "desktop" : "Start Menu";
      throw new Error(
        `Failed to create ${locationName} shortcut in ${outputPath}.`
      );
    }

    return true;
  }

  if (process.platform === "linux") {
    const id = crypto
      .createHash("sha256")
      .update(gameKey)
      .digest("hex")
      .slice(0, 20);
    const shortcut = path.join(outputPath, `io.gamehub.game-${id}.desktop`);
    const args =
      process.defaultApp && process.argv[1]
        ? [path.resolve(process.argv[1]), deepLink]
        : [deepLink];
    fs.writeFileSync(
      shortcut,
      buildLinuxGameDesktopEntry({
        name: game.title,
        executable: getLinuxLauncherExecutable(process.execPath),
        args,
        icon: iconPath,
      }),
      { mode: 0o755 }
    );
    if (location === "desktop") {
      // GNOME requires trust metadata for desktop launchers. Other desktops
      // can use the generated executable .desktop file without this helper.
      execFile("gio", ["set", shortcut, "metadata::trusted", "true"], () => {});
    } else {
      execFile("update-desktop-database", [outputPath], () => {});
    }
    return true;
  }

  const windowVbsPath = app.isPackaged
    ? path.join(process.resourcesPath, "windows.vbs")
    : undefined;

  const options = {
    filePath: process.execPath,
    arguments: shortcutArguments,
    name: shortcutName,
    outputPath,
    icon: iconPath ?? undefined,
  };

  const success = createDesktopShortcut({
    windows: { ...options, VBScriptPath: windowVbsPath },
    linux: options,
    osx: options,
  });

  if (!success) {
    throw new Error("Failed to create desktop shortcut.");
  }

  return true;
};

registerEvent("createGameShortcut", createGameShortcut);
