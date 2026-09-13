import type {
  GameShop,
  LudusaviBackup,
  LudusaviConfig,
  LudusaviCustomGame,
} from "@types";

import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import cp from "node:child_process";
import { SystemPath } from "./system-path";
import { logger } from "./logger";
import {
  resolveLudusaviPathMatches,
  toProspectiveLudusaviPath,
} from "./ludusavi-path-discovery";
import {
  extractLudusaviManifestSaveMapping,
  getBuiltInSaveOverride,
  getLudusaviManifestOs,
  isAcceptedLudusaviFuzzyScore,
  resolveInstallDirFromExecutable,
} from "./ludusavi-game-mapping";

export interface LudusaviResolvedSaveMapping {
  paths: string[];
  registry: string[];
}

export class Ludusavi {
  private static manifestCheckPromise: Promise<void> | null = null;
  private static manifestCheckedThisSession = false;

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

  private static writeConfig(config: LudusaviConfig): void {
    fs.writeFileSync(
      path.join(this.configPath, "config.yaml"),
      YAML.stringify(config)
    );
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

  /**
   * Make sure the game database (manifest, PCGamingWiki-derived) has been
   * downloaded, and refresh it when it's older than a week so save locations
   * for new/updated games keep resolving.
   */
  private static ensureManifest(): Promise<void> {
    if (this.manifestCheckedThisSession) return Promise.resolve();
    if (this.manifestCheckPromise) return this.manifestCheckPromise;

    this.manifestCheckPromise = (async () => {
      const manifestPath = path.join(this.configPath, "manifest.yaml");
      if (!fs.existsSync(manifestPath)) {
        await this.updateManifest();
        return;
      }
      try {
        const ageMs = Date.now() - fs.statSync(manifestPath).mtimeMs;
        if (ageMs > 7 * 24 * 60 * 60 * 1000) {
          await this.updateManifest();
        }
      } catch {
        // stat failed — keep the existing manifest
      }
    })().finally(() => {
      this.manifestCheckedThisSession = true;
      this.manifestCheckPromise = null;
    });

    return this.manifestCheckPromise;
  }

  /** One de-duplicated startup/lazy manifest freshness check per app session. */
  public static prepareManifest(): Promise<void> {
    return this.ensureManifest();
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

    const attempts: { args: string[]; fuzzy: boolean }[] = [];

    if (shop === "steam" && objectId && /^\d+$/.test(objectId)) {
      attempts.push({
        args: ["find", "--api", "--steam-id", objectId],
        fuzzy: false,
      });
    }
    if (shop === "gog" && objectId && /^\d+$/.test(objectId)) {
      attempts.push({
        args: ["find", "--api", "--gog-id", objectId],
        fuzzy: false,
      });
    }
    attempts.push({
      args: ["find", "--api", "--fuzzy", title],
      fuzzy: true,
    });

    for (const attempt of attempts) {
      const args = [
        "--no-manifest-update",
        "--config",
        this.configPath,
        ...attempt.args,
      ];
      const result = await new Promise<string | null>((resolve) => {
        cp.execFile(
          this.binaryPath,
          args,
          { timeout: 30_000 },
          (err, stdout) => {
            if (err) return resolve(null);
            try {
              const parsed = JSON.parse(stdout) as {
                games?: Record<string, { score?: number }>;
              };
              const first = Object.entries(parsed.games ?? {})[0];
              if (!first) return resolve(null);
              const [name, metadata] = first;
              if (
                attempt.fuzzy &&
                !isAcceptedLudusaviFuzzyScore(metadata.score ?? 0)
              ) {
                logger.warn(
                  `[ludusavi] rejected low-confidence match "${title}" -> "${name}" (${(metadata.score ?? 0).toFixed(3)})`
                );
                return resolve(null);
              }
              resolve(name);
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
   * Compatibility wrapper for callers that only need filesystem locations.
   * Generated backup mappings should use `findSaveMappingFast` so registry
   * saves are not silently dropped.
   */
  public static async findSavePathsFast(
    shop: GameShop,
    title: string,
    objectId?: string | null,
    executablePathOverride?: string | null
  ): Promise<string[]> {
    const mapping = await this.findSaveMappingFast(
      shop,
      title,
      objectId,
      executablePathOverride
    );
    return mapping.paths;
  }

  /**
   * Read one manifest section and resolve only entries whose `when` clauses
   * apply to the current OS and game store. The exact-title path stays binary
   * free; the Ludusavi binary is only used to resolve a canonical fallback.
   */
  public static async findSaveMappingFast(
    shop: GameShop,
    title: string,
    objectId?: string | null,
    executablePathOverride?: string | null
  ): Promise<LudusaviResolvedSaveMapping> {
    await this.ensureManifest();

    const manifestPath = path.join(this.configPath, "manifest.yaml");
    if (!fs.existsSync(manifestPath)) return { paths: [], registry: [] };

    // Try exact title first (no binary)
    let {
      paths: rawPaths,
      registry: rawRegistry,
      installDirName,
    } = this.extractPathsFromManifest(manifestPath, title, shop);

    // Exact store-ID overrides take precedence over fuzzy title matching. They
    // are intentionally tiny and only cover entries proven missing upstream.
    if (rawPaths.length === 0 && rawRegistry.length === 0 && objectId) {
      const override = getBuiltInSaveOverride(shop, objectId);
      if (override) {
        rawPaths = [...override.paths];
        rawRegistry = [];
        installDirName = override.installDirName;
      }
    }

    // If not found, try canonical name via ludusavi binary (slower, one shot)
    if (rawPaths.length === 0 && rawRegistry.length === 0) {
      const canonical = await this.findCanonicalName(shop, title, objectId);
      if (canonical && canonical !== title) {
        ({
          paths: rawPaths,
          registry: rawRegistry,
          installDirName,
        } = this.extractPathsFromManifest(manifestPath, canonical, shop));
      }
    }

    if (rawPaths.length === 0 && rawRegistry.length === 0) {
      return { paths: [], registry: [] };
    }

    // Resolve install dir from the physical executable. The executable may be
    // nested several folders below the game root (Khazan), or may be a shared
    // launcher beside the real game directory (League of Legends), so use the
    // manifest installDir name to find the matching ancestor/sibling first.
    const platformUrlPrefixes = [
      "steam://",
      "legendary://",
      "gog://",
      "epic://",
      "heroic://",
    ];
    const isPlatformUrl = executablePathOverride
      ? platformUrlPrefixes.some((prefix) =>
          executablePathOverride.startsWith(prefix)
        )
      : true;

    let resolvedInstallDir: string | null = null;
    if (executablePathOverride && !isPlatformUrl) {
      resolvedInstallDir = resolveInstallDirFromExecutable(
        executablePathOverride,
        installDirName
      );
    } else if (shop === "steam" && objectId) {
      resolvedInstallDir = await Promise.race([
        this.getSteamGameInstallDir(objectId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
      ]);
    }

    // If no full install path found but we have the manifest installDir name,
    // build a synthetic <base> using known Steam library roots
    if (!resolvedInstallDir && installDirName && shop === "steam") {
      const syntheticDir =
        await this.resolveSteamInstallDirByName(installDirName);
      if (syntheticDir) resolvedInstallDir = syntheticDir;
    }

    const expanded = rawPaths.map((p) =>
      this.expandLudusaviPath(p, resolvedInstallDir, objectId)
    );

    // For paths still containing <storeUserId> or other unknown variables,
    // scan every matching directory so saves from multiple local profiles are
    // not silently discarded.
    const resolved: string[] = [];
    for (const p of expanded) {
      if (!p.includes("<")) {
        resolved.push(p);
      } else {
        const matches = resolveLudusaviPathMatches(p);
        if (matches.length > 0) {
          resolved.push(...matches);
        } else {
          const prospective = toProspectiveLudusaviPath(p);
          if (prospective) resolved.push(prospective);
        }
      }
    }
    return {
      paths: [...new Set(resolved)],
      registry: [...new Set(rawRegistry)],
    };
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

    const { paths: rawPaths } = this.extractPathsFromManifest(
      manifestPath,
      canonicalName,
      shop
    );
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

    return rawPaths.map((p) =>
      this.expandLudusaviPath(p, steamInstallDir, objectId)
    );
  }

  /**
   * Extract the applicable file, registry, and install-directory entries for a
   * game. Only the selected game section is parsed as YAML, avoiding a large
   * object graph for the multi-megabyte manifest.
   */
  private static extractPathsFromManifest(
    manifestPath: string,
    gameName: string,
    shop: GameShop
  ): {
    paths: string[];
    registry: string[];
    installDirName: string | null;
  } {
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
    if (gameStart === -1) {
      return { paths: [], registry: [], installDirName: null };
    }

    // Collect lines that belong to this game's section (until next top-level key)
    const sectionLines: string[] = [];
    for (let i = gameStart + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 0 && line[0] !== " " && line[0] !== "\t") break;
      sectionLines.push(line);
    }

    return extractLudusaviManifestSaveMapping(sectionLines, {
      os: getLudusaviManifestOs(process.platform),
      shop,
    });
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
      .replace(/<winLocalAppDataLow>/g, path.join(home, "AppData", "LocalLow"))
      .replace(/<winDocuments>/g, path.join(home, "Documents"))
      .replace(/<winPublic>/g, path.join("C:\\Users", "Public"))
      .replace(
        /<winProgramData>/g,
        process.env.PROGRAMDATA ?? "C:\\ProgramData"
      )
      .replace(/<winDir>/g, process.env.WINDIR ?? "C:\\Windows")
      .replace(/<osUserName>/g, os.userInfo().username)
      .replace(/<xdgHome>/g, home)
      .replace(/<xdgData>/g, xdgData)
      .replace(/<xdgConfig>/g, xdgConfig);

    if (storeGameId) {
      result = result.replace(/<storeGameId>/g, storeGameId);
    }

    return result.replace(/\//g, path.sep).replace(/\\/g, path.sep);
  }

  /** Find an install dir in Steam library roots by folder name (from manifest installDir). */
  private static async resolveSteamInstallDirByName(
    folderName: string
  ): Promise<string | null> {
    try {
      const { getSteamLocation } = await import("./steam");
      const steamPath = await getSteamLocation().catch(() => null);
      if (!steamPath) return null;

      const libraryPaths: string[] = [
        path.join(steamPath, "steamapps", "common"),
      ];

      const libraryFoldersPath = path.join(
        steamPath,
        "steamapps",
        "libraryfolders.vdf"
      );
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
        "--no-manifest-update",
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

  /**
   * Stable Ludusavi custom-game name for a user-selected save directory.
   * Object IDs are only unique inside a shop, so the legacy objectId-only key
   * could make two stores overwrite each other's manual mapping.
   */
  public static getManualGameKey(shop: GameShop, objectId: string): string {
    return `gamehub-manual:${shop}:${objectId}`;
  }

  /**
   * Find a manual save mapping. New shop-scoped keys win; an objectId-only
   * mapping from older GameHub builds is migrated on first read so existing
   * user selections keep working.
   */
  public static async getManualCustomGame(
    shop: GameShop,
    objectId: string
  ): Promise<LudusaviCustomGame | null> {
    const config = await this.getConfig();
    const customGames = config.customGames ?? [];
    const stableKey = this.getManualGameKey(shop, objectId);

    const stable = customGames.find((game) => game.name === stableKey);
    if (stable) {
      return {
        ...stable,
        files: [...stable.files],
        registry: [...(stable.registry ?? [])],
      };
    }

    const legacy = customGames.find((game) => game.name === objectId);
    if (!legacy) return null;

    const migrated: LudusaviCustomGame = {
      ...legacy,
      name: stableKey,
      files: [...legacy.files],
      registry: [...(legacy.registry ?? [])],
    };
    config.customGames = customGames.filter(
      (game) => game.name !== stableKey && game.name !== objectId
    );
    config.customGames.push(migrated);
    this.writeConfig(config);
    logger.info(
      `[ludusavi] migrated manual save mapping for ${shop}:${objectId}`
    );

    return {
      ...migrated,
      files: [...migrated.files],
      registry: [...migrated.registry],
    };
  }

  /** Store a user-selected save directory under the stable shop-scoped key. */
  public static async setManualCustomGame(
    shop: GameShop,
    objectId: string,
    savePath: string
  ): Promise<void> {
    const config = await this.getConfig();
    const stableKey = this.getManualGameKey(shop, objectId);
    config.customGames = (config.customGames ?? []).filter(
      (game) => game.name !== stableKey && game.name !== objectId
    );
    config.customGames.push({
      name: stableKey,
      files: [savePath],
      registry: [],
    });
    this.writeConfig(config);
  }

  /** Clear both the current key and the objectId-only key used by old builds. */
  public static async removeManualCustomGame(
    shop: GameShop,
    objectId: string
  ): Promise<void> {
    const config = await this.getConfig();
    const stableKey = this.getManualGameKey(shop, objectId);
    const customGames = config.customGames ?? [];
    const filtered = customGames.filter(
      (game) => game.name !== stableKey && game.name !== objectId
    );
    if (filtered.length === customGames.length) return;
    config.customGames = filtered;
    this.writeConfig(config);
  }

  /** Preview the exact manual mapping, bypassing title/fuzzy manifest lookup. */
  public static async previewCustomGame(
    shop: GameShop,
    objectId: string,
    winePrefix?: string | null
  ): Promise<LudusaviBackup | null> {
    const customGame = await this.getManualCustomGame(shop, objectId);
    if (!customGame) return null;

    const backupData = await this.backupGame(
      shop,
      customGame.name,
      null,
      winePrefix,
      true
    );
    return {
      ...backupData,
      customBackupPath: customGame.files[0] ?? null,
    };
  }

  static async addCustomGame(
    title: string,
    savePath: string | string[] | null,
    registryPaths: string[] = []
  ) {
    const config = await this.getConfig();
    const filteredGames = config.customGames.filter(
      (game) => game.name !== title
    );

    const files = Array.isArray(savePath)
      ? savePath.filter(Boolean)
      : savePath
        ? [savePath]
        : [];
    const registry = [...new Set(registryPaths.filter(Boolean))];
    if (files.length > 0 || registry.length > 0) {
      filteredGames.push({
        name: title,
        files: [...new Set(files)],
        registry,
      });
    }

    config.customGames = filteredGames;

    this.writeConfig(config);
  }
}
