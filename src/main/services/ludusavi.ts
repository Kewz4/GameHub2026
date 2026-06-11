import type { GameShop, LudusaviBackup, LudusaviConfig } from "@types";

import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import cp from "node:child_process";
import { SystemPath } from "./system-path";
import { logger } from "./logger";

export class Ludusavi {
  private static ludusaviResourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, "ludusavi")
    : path.join(__dirname, "..", "..", "ludusavi");

  private static binaryName =
    process.platform === "win32" ? "ludusavi.exe" : "ludusavi";

  // Lazy getters so app.getPath() is called after app.setPath() runs in portable mode
  private static get configPath() {
    return path.join(SystemPath.getPath("userData"), "ludusavi");
  }

  private static get binaryPath() {
    return path.join(this.configPath, this.binaryName);
  }

  public static async getConfig() {
    const config = YAML.parse(
      fs.readFileSync(path.join(this.configPath, "config.yaml"), "utf-8")
    ) as LudusaviConfig;

    return config;
  }

  public static async copyConfigFileToUserData() {
    const configFile = path.join(this.configPath, "config.yaml");

    if (!fs.existsSync(this.configPath)) {
      fs.mkdirSync(this.configPath, { recursive: true });
    }

    if (!fs.existsSync(configFile)) {
      fs.cpSync(
        path.join(this.ludusaviResourcesPath, "config.yaml"),
        configFile
      );
      return;
    }

    // Self-heal configs from older versions that shipped with the primary
    // manifest disabled — without it ludusavi knows almost no games.
    try {
      const config = YAML.parse(fs.readFileSync(configFile, "utf-8"));
      if (config?.manifest && config.manifest.enable !== true) {
        config.manifest.enable = true;
        fs.writeFileSync(configFile, YAML.stringify(config));
        logger.info("[ludusavi] re-enabled primary manifest in config.yaml");
      }
    } catch (error) {
      logger.warn("[ludusavi] could not check/heal config.yaml", error);
    }
  }

  public static async copyBinaryToUserData() {
    if (!fs.existsSync(this.binaryPath)) {
      fs.cpSync(
        path.join(this.ludusaviResourcesPath, this.binaryName),
        this.binaryPath
      );
    }
  }

  /** Update the ludusavi manifest (downloads game database from CDN). */
  public static async updateManifest(): Promise<void> {
    return new Promise((resolve) => {
      logger.info("[ludusavi] updating manifest…");
      cp.execFile(
        this.binaryPath,
        ["--config", this.configPath, "manifest", "update"],
        { timeout: 60_000 },
        (err, stdout, stderr) => {
          if (err) {
            logger.warn(`[ludusavi] manifest update failed: ${err.message}`);
          } else {
            logger.info("[ludusavi] manifest updated successfully");
          }
          if (stderr?.trim())
            logger.verbose(`[ludusavi:manifest] ${stderr.trim()}`);
          if (stdout?.trim())
            logger.verbose(`[ludusavi:manifest] ${stdout.trim()}`);
          resolve();
        }
      );
    });
  }

  /** Make sure the game database (manifest) has been downloaded. */
  private static async ensureManifest(): Promise<void> {
    const manifestPath = path.join(this.configPath, "manifest.yaml");
    if (!fs.existsSync(manifestPath)) {
      await this.updateManifest();
    }
  }

  /**
   * Resolve the canonical manifest name for a game. The manifest is keyed by
   * exact title, so "Neon Abyss" only matches if it's spelled identically.
   * `find --steam-id` looks the game up by its Steam App ID (exact), and
   * `find --fuzzy <title>` tolerates spelling differences.
   */
  public static async findCanonicalName(
    shop: GameShop,
    title: string,
    objectId?: string | null
  ): Promise<string | null> {
    await this.ensureManifest();

    const attempts: string[][] = [];

    if (shop === "steam" && objectId && /^\d+$/.test(objectId)) {
      attempts.push(["find", "--api", "--steam-id", objectId]);
    }
    if (shop === "gog" && objectId && /^\d+$/.test(objectId)) {
      attempts.push(["find", "--api", "--gog-id", objectId]);
    }
    attempts.push(["find", "--api", "--fuzzy", title]);

    for (const findArgs of attempts) {
      const args = ["--config", this.configPath, ...findArgs];
      const result = await new Promise<string | null>((resolve) => {
        cp.execFile(
          this.binaryPath,
          args,
          { timeout: 30_000 },
          (err, stdout) => {
            if (err) return resolve(null);
            try {
              const parsed = JSON.parse(stdout) as {
                games?: Record<string, unknown>;
              };
              const names = Object.keys(parsed.games ?? {});
              resolve(names[0] ?? null);
            } catch {
              resolve(null);
            }
          }
        );
      });

      if (result) {
        if (result !== title) {
          logger.info(
            `[ludusavi] resolved "${title}" to manifest name "${result}"`
          );
        }
        return result;
      }
    }

    logger.warn(`[ludusavi] could not find "${title}" in manifest`);
    return null;
  }

  /**
   * Fast manifest-only save path lookup — no ludusavi binary invoked.
   * Reads manifest.yaml directly and expands variables. Returns only
   * fully-expanded paths (no templates). Falls back to the binary-based
   * canonical-name lookup if the title doesn't match the manifest directly.
   */
  public static async findSavePathsFast(
    shop: GameShop,
    title: string,
    objectId?: string | null,
    executablePathOverride?: string | null
  ): Promise<string[]> {
    await this.ensureManifest();

    const manifestPath = path.join(this.configPath, "manifest.yaml");
    if (!fs.existsSync(manifestPath)) return [];

    // Try exact title first (no binary)
    let { paths: rawPaths, installDirName } = this.extractPathsFromManifest(manifestPath, title);

    // If not found, try canonical name via ludusavi binary (slower, one shot)
    if (rawPaths.length === 0) {
      const canonical = await this.findCanonicalName(shop, title, objectId);
      if (canonical && canonical !== title) {
        ({ paths: rawPaths, installDirName } = this.extractPathsFromManifest(manifestPath, canonical));
      }
    }

    if (rawPaths.length === 0) return [];

    // Resolve install dir: prefer executablePathOverride if it's a real file path
    const platformUrlPrefixes = ["steam://", "legendary://", "gog://", "epic://", "heroic://"];
    const isPlatformUrl = executablePathOverride
      ? platformUrlPrefixes.some((prefix) => executablePathOverride.startsWith(prefix))
      : true;

    let resolvedInstallDir: string | null = null;
    if (executablePathOverride && !isPlatformUrl) {
      resolvedInstallDir = path.dirname(executablePathOverride);
    } else if (shop === "steam" && objectId) {
      resolvedInstallDir = await Promise.race([
        this.getSteamGameInstallDir(objectId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
      ]);
    }

    // If no full install path found but we have the manifest installDir name,
    // build a synthetic <base> using known Steam library roots
    if (!resolvedInstallDir && installDirName && shop === "steam") {
      const syntheticDir = await this.resolveSteamInstallDirByName(installDirName);
      if (syntheticDir) resolvedInstallDir = syntheticDir;
    }

    return rawPaths
      .map((p) => this.expandLudusaviPath(p, resolvedInstallDir, objectId))
      .filter((p) => !p.includes("<")); // only return fully-expanded paths
  }

  /**
   * Return path templates from the manifest for a game's save files by
   * parsing manifest.yaml directly. `find --api` only returns game names,
   * not file path templates, so we must read the YAML ourselves.
   */
  public static async findManifestSavePaths(
    shop: GameShop,
    title: string,
    objectId?: string | null
  ): Promise<string[]> {
    await this.ensureManifest();

    const canonicalName = await this.findCanonicalName(shop, title, objectId);
    if (!canonicalName) return [];

    const manifestPath = path.join(this.configPath, "manifest.yaml");
    if (!fs.existsSync(manifestPath)) return [];

    const { paths: rawPaths } = this.extractPathsFromManifest(manifestPath, canonicalName);
    if (rawPaths.length === 0) return [];

    const steamInstallDir =
      shop === "steam" && objectId
        ? await Promise.race([
            this.getSteamGameInstallDir(objectId),
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), 5_000)
            ),
          ])
        : null;

    return rawPaths.map((p) => this.expandLudusaviPath(p, steamInstallDir, objectId));
  }

  /**
   * Extract file path templates and installDir name for a game from manifest.yaml
   * using a line-by-line scan. Avoids loading the entire multi-MB YAML into memory.
   */
  private static extractPathsFromManifest(
    manifestPath: string,
    gameName: string
  ): { paths: string[]; installDirName: string | null } {
    const content = fs.readFileSync(manifestPath, "utf-8");
    const lines = content.split("\n");

    // Find the line that starts the game's section (exact key match)
    const gameHeader = `"${gameName}":`;
    const altHeader = `${gameName}:`;
    let gameStart = -1;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimEnd();
      if (trimmed === gameHeader || trimmed === altHeader) {
        gameStart = i;
        break;
      }
    }
    if (gameStart === -1) return { paths: [], installDirName: null };

    // Collect lines that belong to this game's section (until next top-level key)
    const sectionLines: string[] = [];
    for (let i = gameStart + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 0 && line[0] !== " " && line[0] !== "\t") break;
      sectionLines.push(line);
    }

    const paths: string[] = [];
    let inFiles = false;
    let inInstallDir = false;
    let installDirName: string | null = null;
    const filesIndent = /^(\s+)files:/;
    const installDirIndent = /^(\s+)installDir:/;
    let filesDepth = -1;
    let installDirDepth = -1;

    for (const line of sectionLines) {
      // Detect installDir section
      if (!inInstallDir && !inFiles) {
        const m = installDirIndent.exec(line);
        if (m) {
          inInstallDir = true;
          installDirDepth = m[1].length;
          continue;
        }
      }

      if (inInstallDir) {
        const keyMatch = /^(\s+)"?([^":]+)"?\s*:/.exec(line);
        if (keyMatch) {
          const indent = keyMatch[1].length;
          if (indent <= installDirDepth) {
            inInstallDir = false;
          } else if (indent === installDirDepth + 2 && !installDirName) {
            installDirName = keyMatch[2].trim() || null;
            continue;
          }
        } else {
          const spaceCount = line.length - line.trimStart().length;
          if (line.trim() && spaceCount <= installDirDepth) inInstallDir = false;
        }
      }

      // Detect files section
      if (!inFiles) {
        const m = filesIndent.exec(line);
        if (m) {
          inFiles = true;
          filesDepth = m[1].length;
          inInstallDir = false;
        }
        continue;
      }

      // A key at filesDepth+2 spaces is a path template entry
      const keyMatch = /^(\s+)"?([^":]+)"?\s*:/.exec(line);
      if (keyMatch) {
        const indent = keyMatch[1].length;
        if (indent <= filesDepth) break;
        if (indent === filesDepth + 2) {
          const raw = keyMatch[2].trim();
          if (raw) paths.push(raw);
        }
      } else if (line.trim() === "" || /^\s*#/.test(line)) {
        continue;
      } else {
        const spaceCount = line.length - line.trimStart().length;
        if (spaceCount <= filesDepth) break;
      }
    }

    return { paths, installDirName };
  }

  /** Expand ludusavi path template variables to real paths. */
  private static expandLudusaviPath(
    template: string,
    installDir: string | null,
    storeGameId?: string | null
  ): string {
    const home = os.homedir();
    const appData =
      process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    const localAppData =
      process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    // <root> = steamapps/common dir, <game> = folder name, <base> = <root>/<game>
    const installRoot = installDir ? path.dirname(installDir) : null;
    const gameFolderName = installDir ? path.basename(installDir) : null;

    const xdgData =
      process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share");
    const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");

    let result = template
      .replace(/<base>/g, installDir ?? "<base>")
      .replace(/<root>/g, installRoot ?? "<root>")
      .replace(/<game>/g, gameFolderName ?? "<game>")
      .replace(/<home>/g, home)
      .replace(/<winAppData>/g, appData)
      .replace(/<winLocalAppData>/g, localAppData)
      .replace(
        /<winLocalAppDataLow>/g,
        path.join(home, "AppData", "LocalLow")
      )
      .replace(/<winDocuments>/g, path.join(home, "Documents"))
      .replace(/<winPublic>/g, path.join("C:\\Users", "Public"))
      .replace(/<winProgramData>/g, process.env.PROGRAMDATA ?? "C:\\ProgramData")
      .replace(/<winDir>/g, process.env.WINDIR ?? "C:\\Windows")
      .replace(/<osUserName>/g, os.userInfo().username)
      .replace(/<xdgHome>/g, home)
      .replace(/<xdgData>/g, xdgData)
      .replace(/<xdgConfig>/g, xdgConfig);

    if (storeGameId) {
      result = result.replace(/<storeGameId>/g, storeGameId);
    }

    return result
      .replace(/\//g, path.sep)
      .replace(/\\/g, path.sep);
  }

  /** Find an install dir in Steam library roots by folder name (from manifest installDir). */
  private static async resolveSteamInstallDirByName(
    folderName: string
  ): Promise<string | null> {
    try {
      const { getSteamLocation } = await import("./steam");
      const steamPath = await getSteamLocation().catch(() => null);
      if (!steamPath) return null;

      const libraryPaths: string[] = [path.join(steamPath, "steamapps", "common")];

      const libraryFoldersPath = path.join(steamPath, "steamapps", "libraryfolders.vdf");
      if (fs.existsSync(libraryFoldersPath)) {
        const vdf = fs.readFileSync(libraryFoldersPath, "utf-8");
        for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
          libraryPaths.push(path.join(m[1], "steamapps", "common"));
        }
      }

      for (const commonDir of libraryPaths) {
        const candidate = path.join(commonDir, folderName);
        if (fs.existsSync(candidate)) return candidate;
      }
    } catch {
      // ignore
    }
    return null;
  }

  /** Look up the install directory for a Steam game by reading its appmanifest. */
  private static async getSteamGameInstallDir(
    appId: string
  ): Promise<string | null> {
    try {
      const { getSteamLocation } = await import("./steam");
      const steamPath = await getSteamLocation().catch(() => null);
      if (!steamPath) return null;

      const libraryPaths: string[] = [path.join(steamPath, "steamapps")];

      const libraryFoldersPath = path.join(
        steamPath,
        "steamapps",
        "libraryfolders.vdf"
      );
      if (fs.existsSync(libraryFoldersPath)) {
        const vdf = fs.readFileSync(libraryFoldersPath, "utf-8");
        const pathMatches = vdf.matchAll(/"path"\s+"([^"]+)"/g);
        for (const m of pathMatches) {
          libraryPaths.push(path.join(m[1], "steamapps"));
        }
      }

      for (const steamapps of libraryPaths) {
        const manifest = path.join(steamapps, `appmanifest_${appId}.acf`);
        if (!fs.existsSync(manifest)) continue;

        const acf = fs.readFileSync(manifest, "utf-8");
        const installDirMatch = acf.match(/"installdir"\s+"([^"]+)"/);
        if (installDirMatch) {
          return path.join(steamapps, "common", installDirMatch[1]);
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  public static async backupGame(
    _shop: GameShop,
    gameName: string,
    backupPath?: string | null,
    winePrefix?: string | null,
    preview?: boolean
  ): Promise<LudusaviBackup> {
    return new Promise((resolve, reject) => {
      const args = [
        "--config",
        this.configPath,
        "backup",
        gameName,
        "--api",
        "--force",
      ];

      if (preview) args.push("--preview");
      if (backupPath) args.push("--path", backupPath);
      if (winePrefix) args.push("--wine-prefix", winePrefix);

      logger.verbose(`[ludusavi] ${this.binaryPath} ${args.join(" ")}`);
      cp.execFile(
        this.binaryPath,
        args,
        { timeout: 60_000 },
        (err: cp.ExecFileException | null, stdout: string, stderr: string) => {
          if (stderr?.trim()) {
            logger.verbose(`[ludusavi:stderr] ${stderr.trim()}`);
          }
          if (err) {
            logger.error(`[ludusavi] error for ${gameName}: ${err.message}`);
            return reject(err);
          }

          try {
            const parsed = JSON.parse(stdout) as LudusaviBackup;
            const foundGames = Object.keys(parsed.games ?? {});
            logger.verbose(
              `[ludusavi] completed for ${gameName} — games found: ${
                foundGames.length ? foundGames.join(", ") : "none"
              }`
            );
            return resolve(parsed);
          } catch (parseErr) {
            logger.error(
              `[ludusavi] could not parse output for ${gameName}: ${stdout.slice(0, 500)}`
            );
            return reject(parseErr);
          }
        }
      );
    });
  }

  public static async getBackupPreview(
    shop: GameShop,
    gameTitle: string,
    objectId?: string | null,
    winePrefix?: string | null
  ): Promise<LudusaviBackup | null> {
    const config = await this.getConfig();

    await this.ensureManifest();

    let backupData = await this.backupGame(
      shop,
      gameTitle,
      null,
      winePrefix,
      true
    );

    // If the exact title isn't in the manifest, resolve the canonical name
    // (by Steam/GOG ID or fuzzy title) and retry.
    if (!backupData.games?.[gameTitle]) {
      const canonicalName = await this.findCanonicalName(
        shop,
        gameTitle,
        objectId
      );

      if (canonicalName && canonicalName !== gameTitle) {
        backupData = await this.backupGame(
          shop,
          canonicalName,
          null,
          winePrefix,
          true
        );

        // Alias under the requested title so callers can index by it
        if (backupData.games?.[canonicalName]) {
          backupData.games[gameTitle] = backupData.games[canonicalName];
        }
      }
    }

    const customGame = config.customGames.find(
      (game) => game.name === gameTitle
    );

    return {
      ...backupData,
      customBackupPath: customGame?.files[0] || null,
    };
  }

  static async addCustomGame(title: string, savePath: string | null) {
    const config = await this.getConfig();
    const filteredGames = config.customGames.filter(
      (game) => game.name !== title
    );

    if (savePath) {
      filteredGames.push({
        name: title,
        files: [savePath],
        registry: [],
      });
    }

    config.customGames = filteredGames;

    fs.writeFileSync(
      path.join(this.configPath, "config.yaml"),
      YAML.stringify(config)
    );
  }
}
