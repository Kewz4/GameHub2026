import { ASSETS_PATH } from "@main/constants";
import { getGameAssets } from "@main/events/catalogue/get-game-assets";
import { getDirectorySize } from "@main/events/helpers/get-directory-size";
import { db, downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import {
  Downloader,
  FILE_EXTENSIONS_TO_EXTRACT,
  removeSymbolsFromName,
} from "@shared";
import type { GameShop, UserPreferences } from "@types";
import axios from "axios";
import createDesktopShortcut from "create-desktop-shortcuts";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import pngToIco from "png-to-ico";
import sharp from "sharp";
import { ExtractionProgress, SevenZip } from "./7zip";
import { getPathType } from "./extraction-path";
import { GameExecutables } from "./game-executables";
import { logger } from "./logger";
import { deleteArchiveFile } from "@main/events/library/delete-archive";
import { publishExtractionCompleteNotification } from "./notifications";
import { SystemPath } from "./system-path";
import { WindowManager } from "./window-manager";
import { selectCustomGameExecutable } from "./download/custom-game-executable";

const PROGRESS_THROTTLE_MS = 1000;

/**
 * Collect file paths (relative to `root`) under a directory, descending up to
 * `maxDepth` levels. Used to locate ROM archives that torrent sources bury
 * inside a deep directory tree. Bounded so a pathological tree can't hang.
 */
async function collectFilesRecursive(
  root: string,
  maxDepth = 6
): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth || out.length > 5000) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        out.push(path.relative(root, full));
      }
    }
  };
  await walk(root, 0);
  return out;
}

export class GameFilesManager {
  private lastProgressUpdateTime = 0;
  private lastProgressUpdateValue = 0;

  constructor(
    private readonly shop: GameShop,
    private readonly objectId: string
  ) {}

  private get gameKey() {
    return levelKeys.game(this.shop, this.objectId);
  }

  private updateExtractionProgress(progress: number, force = false) {
    const now = Date.now();

    if (!force && now - this.lastProgressUpdateTime < PROGRESS_THROTTLE_MS) {
      return;
    }

    if (!force && progress < this.lastProgressUpdateValue) {
      return;
    }

    this.lastProgressUpdateValue = progress;
    this.lastProgressUpdateTime = now;

    WindowManager.sendToAppWindows(
      "on-extraction-progress",
      this.shop,
      this.objectId,
      progress
    );
  }

  private async setExtractionFailedState(error: unknown, targetPath?: string) {
    logger.error(
      `[GameFilesManager] Extraction failed for ${this.objectId}${targetPath ? ` at ${targetPath}` : ""}`,
      error
    );

    const download = await downloadsSublevel.get(this.gameKey);

    if (download) {
      const status =
        download.progress === 1
          ? download.shouldSeed && download.downloader === Downloader.Torrent
            ? "seeding"
            : "complete"
          : download.status;

      await downloadsSublevel.put(this.gameKey, {
        ...download,
        status,
        queued: false,
        extracting: false,
      });
      WindowManager.sendDownloadsUpdated();
    }

    WindowManager.sendToAppWindows(
      "on-extraction-failed",
      this.shop,
      this.objectId
    );

    this.lastProgressUpdateTime = 0;
    this.lastProgressUpdateValue = 0;
  }

  async failExtraction(error: unknown, targetPath?: string) {
    await this.setExtractionFailedState(error, targetPath);
  }

  private readonly handleProgress = (progress: ExtractionProgress) => {
    console.log(`handleProgress: ${progress.percent}% - ${progress.file}`);
    this.updateExtractionProgress(progress.percent / 100);
  };

  async extractFilesInDirectory(directoryPath: string): Promise<boolean> {
    let pathType: Awaited<ReturnType<typeof getPathType>>;
    try {
      pathType = await getPathType(directoryPath);
    } catch (error) {
      await this.setExtractionFailedState(error, directoryPath);
      return false;
    }

    if (pathType !== "directory") {
      await this.setExtractionFailedState(
        new Error(
          `Expected extraction directory but got "${pathType}" for ${directoryPath}`
        ),
        directoryPath
      );
      return false;
    }

    let files: string[];
    try {
      // Walk recursively: torrent sources (e.g. minerva/Myrient) nest the ROM
      // archive several directories deep (No-Intro/<console>/<game>.zip), so a
      // top-level readdir would miss it and the ROM would stay zipped. Paths are
      // relative to directoryPath; extraction below joins them back.
      files = await collectFilesRecursive(directoryPath);
    } catch (error) {
      await this.setExtractionFailedState(error, directoryPath);
      return false;
    }

    const compressedFiles = files.filter((file) =>
      FILE_EXTENSIONS_TO_EXTRACT.some((ext) => file.toLowerCase().endsWith(ext))
    );

    const filesToExtract = compressedFiles.filter(
      (file) => /part1\.rar$/i.test(file) || !/part\d+\.rar$/i.test(file)
    );

    if (filesToExtract.length === 0) return true;

    this.updateExtractionProgress(0, true);

    const totalFiles = filesToExtract.length;
    let completedFiles = 0;

    for (const file of filesToExtract) {
      try {
        const result = await SevenZip.extractFile(
          {
            filePath: path.join(directoryPath, file),
            cwd: directoryPath,
            passwords: ["online-fix.me", "steamrip.com"],
          },
          (progress) => {
            const overallProgress =
              (completedFiles + progress.percent / 100) / totalFiles;
            this.updateExtractionProgress(overallProgress);
          }
        );

        if (result.success) {
          completedFiles++;
          this.updateExtractionProgress(completedFiles / totalFiles, true);
        } else {
          await this.setExtractionFailedState(
            new Error(`7zip returned unsuccessful extraction for ${file}`),
            path.join(directoryPath, file)
          );
          return false;
        }
      } catch (err) {
        await this.setExtractionFailedState(
          err,
          path.join(directoryPath, file)
        );
        return false;
      }
    }

    const archivePaths = compressedFiles
      .map((file) => path.join(directoryPath, file))
      .filter((archivePath) => fs.existsSync(archivePath));

    if (archivePaths.length > 0) {
      const [download, userPreferences] = await Promise.all([
        downloadsSublevel.get(this.gameKey),
        db.get<string, UserPreferences | null>(levelKeys.userPreferences, {
          valueEncoding: "json",
        }),
      ]);

      const shouldDelete =
        download?.automaticallyDeleteArchiveFiles ??
        userPreferences?.deleteArchiveFilesAfterExtractionByDefault ??
        false;

      if (shouldDelete) {
        for (const archivePath of archivePaths) {
          await deleteArchiveFile(archivePath);
        }
      } else {
        WindowManager.sendToAppWindows(
          "on-archive-deletion-prompt",
          archivePaths
        );
      }
    }

    await this.flattenSingleWrapperDirectory(directoryPath);

    return true;
  }

  /**
   * Many archives wrap their payload in a single redundant top-level folder
   * (e.g. `Game.zip` → `Game/Game.exe`, or a console ROM → `Game/Game.wua`).
   * After extraction that leaves the game one directory deeper than expected,
   * which breaks executable/ROM detection ("extraction output is a folder with
   * the game inside, not the game"). If — and only if — the directory now holds
   * exactly one non-archive entry and it's a folder, we lift its contents up one
   * level and drop the empty wrapper. Anything with multiple top-level entries
   * is left untouched, so legitimate multi-folder layouts are never disturbed.
   */
  private async flattenSingleWrapperDirectory(
    directoryPath: string
  ): Promise<void> {
    try {
      const entries = await fs.promises.readdir(directoryPath, {
        withFileTypes: true,
      });

      // Ignore leftover archive parts and hidden/metadata files when deciding
      // whether a single wrapper folder is all that's here.
      const meaningful = entries.filter(
        (entry) =>
          !entry.name.startsWith(".") &&
          !FILE_EXTENSIONS_TO_EXTRACT.some((ext) =>
            entry.name.toLowerCase().endsWith(ext)
          )
      );

      if (meaningful.length !== 1 || !meaningful[0].isDirectory()) return;

      const wrapper = path.join(directoryPath, meaningful[0].name);
      const children = await fs.promises.readdir(wrapper);
      if (children.length === 0) return;

      // Abort if lifting any child would collide with an existing entry (e.g. a
      // leftover archive of the same name) — never overwrite.
      for (const child of children) {
        if (fs.existsSync(path.join(directoryPath, child))) return;
      }

      for (const child of children) {
        await fs.promises.rename(
          path.join(wrapper, child),
          path.join(directoryPath, child)
        );
      }
      await fs.promises.rmdir(wrapper).catch(() => {});
      logger.log(
        `[GameFilesManager] Flattened redundant wrapper folder "${meaningful[0].name}" in ${directoryPath}`
      );
    } catch (error) {
      // Best-effort: a flatten failure must never fail an otherwise-good
      // extraction. Downstream ROM/exe scanning walks recursively anyway.
      logger.log(
        `[GameFilesManager] Wrapper-folder flatten skipped: ${
          (error as Error).message
        }`
      );
    }
  }

  async setExtractionComplete(publishNotification = true) {
    const [download, game] = await Promise.all([
      downloadsSublevel.get(this.gameKey),
      gamesSublevel.get(this.gameKey),
    ]);

    if (!download) return;

    await downloadsSublevel.put(this.gameKey, {
      ...download,
      extracting: false,
    });
    WindowManager.sendDownloadsUpdated();

    // Calculate and store the installed size
    if (game && download.folderName) {
      const gamePath = path.join(download.downloadPath, download.folderName);
      const installedSizeInBytes = await getDirectorySize(gamePath);

      await gamesSublevel.put(this.gameKey, {
        ...game,
        installedSizeInBytes,
      });
    }

    WindowManager.sendToAppWindows(
      "on-extraction-complete",
      this.shop,
      this.objectId
    );

    if (publishNotification && game) {
      publishExtractionCompleteNotification(game);
    }

    this.lastProgressUpdateTime = 0;
    this.lastProgressUpdateValue = 0;

    await this.searchAndBindExecutable();
  }

  async searchAndBindExecutable(): Promise<void> {
    try {
      const [download, game] = await Promise.all([
        downloadsSublevel.get(this.gameKey),
        gamesSublevel.get(this.gameKey),
      ]);

      if (!download || !game || game.executablePath) {
        return;
      }

      if (!download.folderName) {
        return;
      }

      const gameFolderPath = path.join(
        download.downloadPath,
        download.folderName
      );

      if (!fs.existsSync(gameFolderPath)) {
        return;
      }

      const executableNames = GameExecutables.getExecutablesForGame(
        this.objectId
      );
      let foundExePath: string | null = null;

      if (executableNames?.length) {
        foundExePath = await this.findExecutableInFolder(
          gameFolderPath,
          executableNames
        );
      } else if (download.customDownload) {
        const gameFolderStats = await fs.promises.stat(gameFolderPath);
        if (gameFolderStats.isFile()) {
          foundExePath = selectCustomGameExecutable(game.title, [
            { path: gameFolderPath, size: gameFolderStats.size },
          ]);
        } else if (gameFolderStats.isDirectory()) {
          const relativeFiles = await collectFilesRecursive(gameFolderPath);
          const candidates = await Promise.all(
            relativeFiles
              .filter(
                (filePath) => path.extname(filePath).toLowerCase() === ".exe"
              )
              .map(async (relativePath) => {
                const absolutePath = path.join(gameFolderPath, relativePath);
                const stats = await fs.promises.stat(absolutePath);
                return { path: absolutePath, size: stats.size };
              })
          );
          foundExePath = selectCustomGameExecutable(game.title, candidates);
        }
      }

      if (foundExePath) {
        logger.info(
          `[GameFilesManager] Auto-detected executable for ${this.objectId}: ${foundExePath}`
        );

        await gamesSublevel.put(this.gameKey, {
          ...game,
          executablePath: foundExePath,
          nativeExecutablePath: foundExePath,
          isInstalledLocally: true,
        });

        WindowManager.sendToAppWindows("on-library-batch-complete");

        await this.createDesktopShortcutForGame(game.title);
      }
    } catch (err) {
      logger.error(
        `[GameFilesManager] Error searching for executable: ${this.objectId}`,
        err
      );
    }
  }

  private isValidHttpUrl(url: string | null | undefined): url is string {
    return !!url && (url.startsWith("http://") || url.startsWith("https://"));
  }

  private isIcoUrl(url: string): boolean {
    return url.toLowerCase().endsWith(".ico");
  }

  private async downloadGameIcon(): Promise<string | null> {
    if (this.shop === "custom") {
      return null;
    }

    const iconDir = path.join(ASSETS_PATH, `${this.shop}-${this.objectId}`);
    const iconPath = path.join(iconDir, "icon.ico");

    try {
      if (fs.existsSync(iconPath)) {
        return iconPath;
      }
    } catch {
      // Ignore fs errors
    }

    const game = await gamesSublevel.get(this.gameKey);
    const assets = await getGameAssets(this.objectId, this.shop);

    const iconUrls = [
      assets?.iconUrl,
      game?.iconUrl,
      assets?.coverImageUrl,
    ].filter(this.isValidHttpUrl);

    if (iconUrls.length === 0) {
      logger.warn(
        `[GameFilesManager] No valid icon URLs found for: ${this.objectId}`
      );
      return null;
    }

    fs.mkdirSync(iconDir, { recursive: true });

    for (const iconUrl of iconUrls) {
      try {
        logger.log(
          `[GameFilesManager] Trying to download icon from: ${iconUrl}`
        );
        const response = await axios.get(iconUrl, {
          responseType: "arraybuffer",
        });
        const imageBuffer = Buffer.from(response.data);

        // If source is already ICO, use it directly
        if (this.isIcoUrl(iconUrl)) {
          fs.writeFileSync(iconPath, imageBuffer);
          logger.log(`[GameFilesManager] Copied ICO directly to: ${iconPath}`);
          return iconPath;
        }

        // Convert to square PNG (256x256 is standard for ICO), then to ICO
        const pngBuffer = await sharp(imageBuffer)
          .resize(256, 256, { fit: "cover" })
          .png()
          .toBuffer();
        const icoBuffer = await pngToIco(pngBuffer);
        fs.writeFileSync(iconPath, icoBuffer);

        logger.log(
          `[GameFilesManager] Successfully created icon at: ${iconPath}`
        );
        return iconPath;
      } catch (error) {
        logger.warn(
          `[GameFilesManager] Failed to convert icon from ${iconUrl}:`,
          error
        );
      }
    }

    logger.error(
      `[GameFilesManager] Failed to download/convert icon from any source: ${this.objectId}`
    );
    return null;
  }

  private createUrlShortcut(
    shortcutPath: string,
    url: string,
    iconPath?: string | null
  ): boolean {
    try {
      fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });

      if (fs.existsSync(shortcutPath)) {
        fs.unlinkSync(shortcutPath);
      }

      let content = `[InternetShortcut]\nURL=${url}\n`;

      if (iconPath) {
        content += `IconFile=${iconPath}\nIconIndex=0\n`;
      }

      fs.writeFileSync(shortcutPath, content);
      return true;
    } catch (error) {
      logger.error(
        `[GameFilesManager] Failed to create URL shortcut: ${this.objectId}`,
        error
      );
      return false;
    }
  }

  private deleteShortcutIfExists(shortcutPath: string) {
    try {
      if (fs.existsSync(shortcutPath)) {
        fs.unlinkSync(shortcutPath);
      }
    } catch (error) {
      logger.warn(
        `[GameFilesManager] Failed to delete existing shortcut: ${shortcutPath}`,
        error
      );
    }
  }

  private buildRunDeepLink() {
    const query = new URLSearchParams({
      shop: this.shop,
      objectId: this.objectId,
    });

    return `hydralauncher://run?${query.toString()}`;
  }

  private quoteLinuxExecArg(value: string) {
    return `"${value.replaceAll('"', '\\"')}"`;
  }

  private getShortcutArguments(deepLink: string) {
    const deepLinkArgument =
      process.platform === "linux"
        ? this.quoteLinuxExecArg(deepLink)
        : deepLink;

    if (process.defaultApp && process.argv.length >= 2) {
      const appEntry = path.resolve(process.argv[1]);
      const appEntryArgument =
        process.platform === "linux"
          ? this.quoteLinuxExecArg(appEntry)
          : appEntry;

      return `${appEntryArgument} ${deepLinkArgument}`;
    }

    return deepLinkArgument;
  }

  private createWindowsShortcut(
    shortcutName: string,
    outputPath: string,
    deepLink: string,
    iconPath?: string | null
  ): boolean {
    fs.mkdirSync(outputPath, { recursive: true });

    const linkPath = path.join(outputPath, `${shortcutName}.lnk`);
    const urlPath = path.join(outputPath, `${shortcutName}.url`);

    this.deleteShortcutIfExists(linkPath);
    this.deleteShortcutIfExists(urlPath);

    const windowVbsPath = app.isPackaged
      ? path.join(process.resourcesPath, "windows.vbs")
      : undefined;

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

    return this.createUrlShortcut(
      urlPath,
      deepLink,
      iconPath ?? process.execPath
    );
  }

  private async createDesktopShortcutForGame(gameTitle: string): Promise<void> {
    try {
      const shortcutName =
        removeSymbolsFromName(gameTitle).trim() || this.objectId;
      const deepLink = this.buildRunDeepLink();
      const shortcutArguments = this.getShortcutArguments(deepLink);
      const iconPath = await this.downloadGameIcon();

      if (process.platform === "win32") {
        const userPreferences = await db.get<string, UserPreferences | null>(
          levelKeys.userPreferences,
          { valueEncoding: "json" }
        );

        const shouldCreateDownloadShortcuts =
          userPreferences?.createStartMenuShortcut ?? true;

        if (!shouldCreateDownloadShortcuts) {
          return;
        }

        const desktopSuccess = this.createWindowsShortcut(
          shortcutName,
          SystemPath.getPath("desktop"),
          deepLink,
          iconPath
        );

        if (desktopSuccess) {
          logger.info(
            `[GameFilesManager] Created desktop shortcut for ${this.objectId}`
          );
        }

        const startMenuPath = path.join(
          SystemPath.getPath("appData"),
          "Microsoft",
          "Windows",
          "Start Menu",
          "Programs"
        );

        const startMenuSuccess = this.createWindowsShortcut(
          shortcutName,
          startMenuPath,
          deepLink,
          iconPath
        );

        if (startMenuSuccess) {
          logger.info(
            `[GameFilesManager] Created Start Menu shortcut for ${this.objectId}`
          );
        }
      } else {
        const windowVbsPath = app.isPackaged
          ? path.join(process.resourcesPath, "windows.vbs")
          : undefined;

        const options = {
          filePath: process.execPath,
          arguments: shortcutArguments,
          name: shortcutName,
          outputPath: SystemPath.getPath("desktop"),
          icon: iconPath ?? undefined,
        };

        const desktopSuccess = createDesktopShortcut({
          windows: { ...options, VBScriptPath: windowVbsPath },
          linux: options,
          osx: options,
        });

        if (desktopSuccess) {
          logger.info(
            `[GameFilesManager] Created desktop shortcut for ${this.objectId}`
          );
        }
      }
    } catch (err) {
      logger.error(
        `[GameFilesManager] Error creating desktop shortcut: ${this.objectId}`,
        err
      );
    }
  }

  private async findExecutableInFolder(
    folderPath: string,
    executableNames: string[]
  ): Promise<string | null> {
    const normalizedNames = new Set(
      executableNames.map((name) => name.toLowerCase())
    );

    try {
      const entries = await fs.promises.readdir(folderPath, {
        withFileTypes: true,
        recursive: true,
      });

      for (const entry of entries) {
        if (!entry.isFile()) continue;

        const fileName = entry.name.toLowerCase();

        if (normalizedNames.has(fileName)) {
          const parentPath =
            "parentPath" in entry
              ? entry.parentPath
              : (entry as unknown as { path?: string }).path || folderPath;

          return path.join(parentPath, entry.name);
        }
      }
    } catch {
      // Silently fail if folder cannot be read
    }

    return null;
  }

  async extractDownloadedFile() {
    const [download, game] = await Promise.all([
      downloadsSublevel.get(this.gameKey),
      gamesSublevel.get(this.gameKey),
    ]);

    if (!download || !game) return false;

    if (!download.folderName) {
      await this.setExtractionFailedState(
        new Error("No downloaded archive was found to extract")
      );
      return false;
    }

    const filePath = path.join(download.downloadPath, download.folderName);

    const extractionPath = path.join(
      download.downloadPath,
      path.parse(download.folderName!).name
    );

    this.updateExtractionProgress(0, true);

    try {
      const result = await SevenZip.extractFile(
        {
          filePath,
          outputPath: extractionPath,
          passwords: ["online-fix.me", "steamrip.com"],
        },
        this.handleProgress
      );

      if (result.success) {
        const extractedNestedArchives =
          await this.extractFilesInDirectory(extractionPath);

        if (!extractedNestedArchives) {
          return false;
        }

        if (fs.existsSync(extractionPath) && fs.existsSync(filePath)) {
          const userPreferences = await db.get<string, UserPreferences | null>(
            levelKeys.userPreferences,
            { valueEncoding: "json" }
          );

          const shouldDelete =
            download.automaticallyDeleteArchiveFiles ??
            userPreferences?.deleteArchiveFilesAfterExtractionByDefault ??
            false;

          if (shouldDelete) {
            await deleteArchiveFile(filePath);
          } else {
            WindowManager.sendToAppWindows("on-archive-deletion-prompt", [
              filePath,
            ]);
          }
        }

        await downloadsSublevel.put(this.gameKey, {
          ...download,
          folderName: path.parse(download.folderName!).name,
        });

        await this.setExtractionComplete();
      } else {
        await this.setExtractionFailedState(
          new Error("7zip returned unsuccessful extraction"),
          filePath
        );
        return false;
      }
    } catch (err) {
      await this.setExtractionFailedState(err, filePath);
      return false;
    }

    return true;
  }
}
