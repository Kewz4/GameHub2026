import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { gamesSublevel, levelKeys } from "@main/level";
import type { ClassicsDisc, Download, EmulatorSystem } from "@types";
import { KNOWN_BINARIES } from "./known-binaries";
import { scanRomFolder } from "./scan-rom-folder";
import { getEmulatorConfig } from "./emulators-repository";
import { cemuDataDir } from "./emulator-portable";
import { installNspIntoEden } from "./nsp-installer";
import { resolveWiiuTitleId } from "./cemu-graphic-packs";
import { logger } from "../logger";

/** Display platform label per console (mirrors the launchbox importer). */
const SYSTEM_PLATFORM_LABEL: Record<EmulatorSystem, string> = {
  ps1: "PlayStation",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
  psp: "PlayStation Portable",
  n3ds: "Nintendo 3DS",
  nds: "Nintendo DS",
  dsi: "Nintendo DSi",
  n64: "Nintendo 64",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  gba: "Game Boy Advance",
  wiiu: "Nintendo Wii U",
  wii: "Nintendo Wii",
  gc: "Nintendo GameCube",
  switch: "Nintendo Switch",
};

const baseName = (p: string): string => {
  const name = path.basename(p);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

/**
 * Move a ROM file (already at `srcPath`) directly under `root`, returning the
 * new path. If it's already at the root, or the move fails, the original path
 * is returned so the disc still resolves.
 */
function flattenIntoRoot(srcPath: string, root: string): string {
  try {
    if (path.dirname(srcPath) === root) return srcPath;
    let dest = path.join(root, path.basename(srcPath));
    // Avoid clobbering a different file with the same name.
    if (fs.existsSync(dest) && dest !== srcPath) {
      const ext = path.extname(dest);
      const stem = path.basename(dest, ext);
      let i = 1;
      while (fs.existsSync(dest)) {
        dest = path.join(root, `${stem} (${i})${ext}`);
        i += 1;
      }
    }
    fs.renameSync(srcPath, dest);
    return dest;
  } catch {
    return srcPath;
  }
}

/**
 * Delete the download's own leftover scaffolding (e.g. `Minerva_Myrient`) once
 * the ROM has been flattened out of it. Scoped to the download's folder ONLY —
 * never the whole platform root, which also holds other games' folders and
 * `(Update)`/`(DLC)` sibling folders that must survive.
 */
function cleanupDownloadScaffolding(
  scanRoot: string,
  platformRoot: string
): void {
  try {
    if (!scanRoot || scanRoot === platformRoot) return;
    if (fs.existsSync(scanRoot)) {
      fs.rmSync(scanRoot, { recursive: true, force: true });
    }
  } catch {
    /* best effort */
  }
}

/** Strip filesystem-hostile characters from a folder name. */
const sanitizeFolderName = (name: string): string =>
  name.replace(/[<>:"/\\|?*]/g, "").trim() || "Game";

/** A `(vNNN)`/`(v1.5.0)` tag from a folder/file name, e.g. "(v208)". */
const versionTagOf = (name: string): string | null => {
  const m = name.match(/\(\s*v[\d.]+\s*\)/i);
  return m ? m[0] : null;
};

/**
 * Find the extracted title folder (one that directly contains a `content`
 * subdir) inside the download tree — bounded BFS so a nested Myrient layout
 * still resolves without walking anything huge.
 */
function findContentTitleDir(root: string): string | null {
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < 200) {
    const { dir, depth } = queue.shift()!;
    visited++;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      if (entries.some((e) => e.isDirectory() && e.name === "content")) {
        return dir;
      }
      if (depth < 4) {
        for (const e of entries) {
          if (e.isDirectory()) {
            queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
          }
        }
      }
    } catch {
      /* skip unreadable */
    }
  }
  return null;
}

/** Spawn a process and wait for exit, with a hard timeout (then kill). */
const runWithTimeout = (
  exe: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number | null; timedOut: boolean }> =>
  new Promise((resolve) => {
    const child = spawn(exe, args, {
      cwd: path.dirname(exe),
      windowsHide: true,
      stdio: "ignore",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: null, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut });
    });
  });

/** Newest file mtime under `root` (bounded walk), or 0. */
const newestMtimeUnder = (root: string): number => {
  let newest = 0;
  let visited = 0;
  const stack = [root];
  while (stack.length && visited < 5000) {
    const dir = stack.pop()!;
    visited++;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else {
        try {
          const m = fs.statSync(full).mtimeMs;
          if (m > newest) newest = m;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return newest;
};

/**
 * Install a 3DS update/DLC .cia into Azahar via its CLI (`azahar --install
 * <cia>` — verified in azahar's citra_qt.cpp: installs synchronously, then
 * exit(0)/exit(2+err)). On Windows the result is shown as a message box BEFORE
 * exit, so we also treat "still running well after the install should be done"
 * as completion, kill the process, and verify by checking that Azahar's sdmc
 * tree gained newer files than our start time.
 */
async function installCiaIntoAzahar(ciaPath: string): Promise<void> {
  const config = await getEmulatorConfig("n3ds").catch(() => null);
  if (config?.binary !== "azahar" || !config.executablePath) {
    logger.warn(
      "[bindDownloadedRom] Azahar not configured — .cia left next to the game for manual install"
    );
    return;
  }
  const exe = config.executablePath;
  const startedAt = Date.now();
  // Generous, size-based budget: disk-bound installs run far faster than this.
  let sizeMb = 200;
  try {
    sizeMb = Math.max(1, fs.statSync(ciaPath).size / (1024 * 1024));
  } catch {
    /* keep default */
  }
  const timeoutMs = Math.min(10 * 60_000, 90_000 + sizeMb * 150);

  logger.log(`[bindDownloadedRom] Installing CIA via Azahar: ${ciaPath}`);
  const res = await runWithTimeout(exe, ["--install", ciaPath], timeoutMs);

  if (!res.timedOut && res.code === 0) {
    logger.log("[bindDownloadedRom] Azahar installed the CIA successfully");
    return;
  }
  if (!res.timedOut && res.code != null && res.code !== 0) {
    // Exit codes are 2 + InstallStatus (e.g. encrypted CIA). Log honestly.
    logger.warn(
      `[bindDownloadedRom] Azahar CIA install failed (exit ${res.code}) — the ` +
        ".cia was left next to the game (if it's encrypted, Azahar can't install it)"
    );
    return;
  }
  // Timed out — on Windows this usually means the install FINISHED and Azahar
  // is showing its result message box (which blocks exit). Verify via sdmc.
  const userDirs = [
    path.join(path.dirname(exe), "user", "sdmc"),
    process.env.APPDATA
      ? path.join(process.env.APPDATA, "Azahar", "sdmc")
      : null,
  ].filter((d): d is string => Boolean(d && fs.existsSync(d)));
  const installedSomething = userDirs.some(
    (d) => newestMtimeUnder(d) >= startedAt
  );
  if (installedSomething) {
    logger.log(
      "[bindDownloadedRom] Azahar CIA install verified via sdmc (process was killed after completion)"
    );
  } else {
    logger.warn(
      "[bindDownloadedRom] Azahar CIA install could not be verified — the .cia was left next to the game"
    );
  }
}

/**
 * Install a PS3 update/DLC .pkg into RPCS3 headlessly (`rpcs3 --headless
 * --installpkg <pkg>` — verified in rpcs3.cpp/main_window.cpp: the headless
 * path builds the package list directly, shows no dialogs, installs, and
 * exits). Older RPCS3 builds without headless install exit non-zero — the .pkg
 * is then left next to the game for manual install.
 */
async function installPkgIntoRpcs3(pkgPath: string): Promise<void> {
  const config = await getEmulatorConfig("ps3").catch(() => null);
  if (config?.binary !== "rpcs3" || !config.executablePath) {
    logger.warn(
      "[bindDownloadedRom] RPCS3 not configured — .pkg left next to the game for manual install"
    );
    return;
  }
  logger.log(`[bindDownloadedRom] Installing PKG via RPCS3: ${pkgPath}`);
  const res = await runWithTimeout(
    config.executablePath,
    ["--headless", "--installpkg", pkgPath],
    10 * 60_000
  );
  if (!res.timedOut && res.code === 0) {
    logger.log("[bindDownloadedRom] RPCS3 installed the PKG successfully");
  } else {
    logger.warn(
      `[bindDownloadedRom] RPCS3 PKG install didn't complete cleanly ` +
        `(exit ${res.code}, timedOut=${res.timedOut}) — the .pkg was left ` +
        "next to the game; it can be installed from RPCS3's File menu"
    );
  }
}

/** Cemu title-id high word per companion kind (base is 00050000). */
const WIIU_TITLE_HIGH: Record<"update" | "dlc", string> = {
  update: "0005000e",
  dlc: "0005000c",
};

/**
 * Install a Wii U update/DLC title folder into the configured Cemu's mlc01 —
 * the location Cemu actually applies at launch (mirrors Cemu's own "Install
 * game update or DLC", which is a title-id copy). The title id is read from
 * the folder's meta/meta.xml; e.g. update 0005000E101C9400 lands at
 * `mlc01/usr/title/0005000e/101c9400/{content,code,meta}`.
 *
 * Wii U UPDATES frequently ship WITHOUT their own meta/meta.xml (they're
 * deltas that inherit the base title's metadata), and some dumps carry a
 * meta.xml whose high word is the base's (00050000) rather than the
 * update/DLC one — in both cases we derive the correct id from the base
 * game's low word (`fallbackTitleId`) + the kind's high word, so it still
 * lands in mlc01 instead of being left as a loose folder.
 */
async function installWiiuTitleIntoCemu(
  titleDir: string,
  kind: "update" | "dlc",
  fallbackTitleId?: string | null
): Promise<void> {
  const expectedHigh = WIIU_TITLE_HIGH[kind];

  // Prefer the folder's own meta.xml — but only when its high word actually
  // matches this kind (an update's meta must be 0005000e…, a DLC's 0005000c…).
  let titleId: string | null = null;
  try {
    const xml = fs.readFileSync(
      path.join(titleDir, "meta", "meta.xml"),
      "utf-8"
    );
    const m = xml.match(/<title_id[^>]*>\s*([0-9a-fA-F]{16})\s*<\/title_id>/);
    const id = m ? m[1].toLowerCase() : null;
    if (id && id.slice(0, 8) === expectedHigh) titleId = id;
  } catch {
    /* no meta.xml — common for update deltas */
  }

  // Fall back to <expectedHigh> + <baseLow> from the resolved base title id
  // (00050000<low> → e.g. 0005000e<low> for the update).
  if (!titleId && fallbackTitleId && fallbackTitleId.length === 16) {
    titleId = expectedHigh + fallbackTitleId.slice(8).toLowerCase();
    logger.log(
      `[bindDownloadedRom] ${kind} has no matching meta.xml — derived title id ${titleId} from base ${fallbackTitleId}`
    );
  }

  if (!titleId) {
    logger.warn(
      `[bindDownloadedRom] ${kind} has no meta.xml title id and no base to derive from — left as loose folder (${titleDir})`
    );
    return;
  }

  const config = await getEmulatorConfig("wiiu").catch(() => null);
  if (config?.binary !== "cemu" || !config.executablePath) {
    logger.warn(
      `[bindDownloadedRom] Cemu not configured — ${kind} left as loose folder`
    );
    return;
  }
  const mlcTitleDir = path.join(
    cemuDataDir(path.dirname(config.executablePath)),
    "mlc01",
    "usr",
    "title",
    titleId.slice(0, 8),
    titleId.slice(8)
  );

  fs.mkdirSync(mlcTitleDir, { recursive: true });
  const copied: string[] = [];
  for (const sub of ["content", "code", "meta"]) {
    const src = path.join(titleDir, sub);
    if (fs.existsSync(src)) {
      fs.cpSync(src, path.join(mlcTitleDir, sub), {
        recursive: true,
        force: true,
      });
      copied.push(sub);
    }
  }
  // An update MUST land its `content` (the patched files Cemu applies) and a
  // `meta` so Cemu lists it — verify rather than silently reporting success.
  if (!copied.includes("content")) {
    logger.warn(
      `[bindDownloadedRom] ${kind} install copied [${copied.join(", ") || "nothing"}] but no "content" — Cemu may not apply it (${titleDir})`
    );
    return;
  }
  logger.log(
    `[bindDownloadedRom] Installed ${kind} (title ${titleId}, parts: ${copied.join(", ")}) into Cemu → ${mlcTitleDir}`
  );
}

/**
 * Place a completed UPDATE/DLC download next to its base game instead of
 * binding it as a launchable ROM. The extracted title folder is moved to
 * `<platformRoot>/<Base Title> (Update|DLC) [vTag]` — exactly the loose-sibling
 * layout resolveCemuGamePaths' strict name patterns find (for launching modded
 * BOTW and for future installs). Loose rom-extension files (e.g. 3DS update
 * .cia) are flattened to the platform root under their original names. The
 * companion's phantom library entry is then hidden.
 */
async function placeCompanionContent(
  download: Download,
  kind: "update" | "dlc",
  scanRoot: string,
  platformRoot: string
): Promise<void> {
  const baseObjectId = download.objectId.split("::")[0];
  const baseGame = await gamesSublevel
    .get(levelKeys.game(download.shop, baseObjectId))
    .catch(() => null);
  const baseTitle = sanitizeFolderName(baseGame?.title ?? baseObjectId);
  const tag = kind === "update" ? "(Update)" : "(DLC)";

  // 1) Folder-format content (Wii U): move the title folder to the sibling slot.
  const titleDir = findContentTitleDir(scanRoot);
  if (titleDir) {
    const vTag = versionTagOf(path.basename(titleDir)) ?? "";
    let dest = path.join(
      platformRoot,
      `${baseTitle} ${tag}${vTag ? ` ${vTag}` : ""}`
    );
    try {
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      fs.renameSync(titleDir, dest);
      logger.log(`[bindDownloadedRom] Placed ${kind} → ${dest}`);
    } catch (err) {
      logger.warn(`[bindDownloadedRom] Couldn't place ${kind} folder`, err);
      dest = titleDir; // leave in place rather than lose it
    }
    // AUTO-INSTALL into Cemu: gameplay only applies updates/DLC that live in
    // Cemu's mlc01 (the loose sibling folder alone only serves the mod
    // pipeline). Mirror what Cemu's own "Install game update/DLC" does — copy
    // the title into mlc01/usr/title/<high>/<low>/.
    if (download.emulatorSystem === "wiiu") {
      // Resolve the base title id (00050000<low>) so updates/DLC still install
      // even when their own dump lacks a matching meta.xml.
      const fallbackTitleId = await resolveWiiuTitleId(
        download.shop,
        baseObjectId
      ).catch(() => null);
      await installWiiuTitleIntoCemu(dest, kind, fallbackTitleId).catch((err) =>
        logger.warn(`[bindDownloadedRom] Cemu mlc01 install failed`, err)
      );
    }
  } else {
    // 2) File-format content (3DS .cia, PS3 .pkg): flatten to the platform
    //    root, then auto-install into the emulator via its CLI.
    const system = download.emulatorSystem as EmulatorSystem;
    const binary = KNOWN_BINARIES[system];
    const exts = new Set(binary?.romExtensions ?? []);
    const movedFiles: string[] = [];
    const moveFiles = (dir: string, depth: number): void => {
      if (depth > 4) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) moveFiles(full, depth + 1);
        else if (exts.has(path.extname(e.name).toLowerCase())) {
          movedFiles.push(flattenIntoRoot(full, platformRoot));
        }
      }
    };
    moveFiles(scanRoot, 0);

    for (const file of movedFiles) {
      const ext = path.extname(file).toLowerCase();
      if (system === "n3ds" && ext === ".cia") {
        await installCiaIntoAzahar(file).catch((err) =>
          logger.warn("[bindDownloadedRom] Azahar CIA install failed", err)
        );
      } else if (system === "ps3" && ext === ".pkg") {
        await installPkgIntoRpcs3(file).catch((err) =>
          logger.warn("[bindDownloadedRom] RPCS3 PKG install failed", err)
        );
      } else if (system === "switch" && (ext === ".nsp" || ext === ".nsz")) {
        // Install the NSP into Eden's NAND registered cache headlessly
        // (parses the PFS0 container, extracts NCAs, places them in
        // nand/system/Contents/registered/ — Eden picks them up on next
        // launch). .nsz (compressed) can't be installed directly — left
        // for manual install via Eden's GUI.
        if (ext === ".nsz") {
          logger.log(
            `[bindDownloadedRom] Switch .nsz ${kind} left for manual install (compressed): ${file}`
          );
        } else {
          await installNspIntoEden(file).catch((err) =>
            logger.warn("[bindDownloadedRom] Eden NSP install failed", err)
          );
        }
      }
    }
  }

  cleanupDownloadScaffolding(scanRoot, platformRoot);

  // Hide the phantom companion library entry (it existed only so the download
  // pipeline could track this download — it's not a playable game).
  const companionKey = levelKeys.game(download.shop, download.objectId);
  const companion = await gamesSublevel.get(companionKey).catch(() => null);
  if (companion) {
    await gamesSublevel.put(companionKey, { ...companion, isDeleted: true });
  }
}

/**
 * After a minerva/console download finishes (and any archive is extracted),
 * locate the ROM file(s) in the download folder and bind them to the library
 * entry as discs — making the game launchable via the emulator and giving the
 * Play button a disc path. Without this a downloaded ROM never becomes
 * playable (the launch path would throw NO_DISC).
 *
 * Best-effort: any failure is logged and left for a manual rescan.
 */
export const bindDownloadedRom = async (download: Download): Promise<void> => {
  const system = (download.emulatorSystem ?? null) as EmulatorSystem | null;
  if (!system) return;

  const binary = KNOWN_BINARIES[system];
  if (!binary) return;

  // The download root is the platform folder (…/Emulator Games/<Platform>).
  // Minerva magnets are one giant file-selected torrent, so libtorrent writes
  // the ROM deep inside `<root>/Minerva_Myrient/No-Intro/<console>/…` — we scan
  // that whole tree, then flatten the found ROM(s) up to the platform root and
  // delete the leftover Myrient directories so the user just sees the game file.
  const platformRoot = download.downloadPath;
  const scanRoot = download.folderName
    ? path.join(platformRoot, download.folderName)
    : platformRoot;

  try {
    // Companion downloads (update/DLC) are PLACED next to the base game, never
    // bound as launchable ROMs — the scan would (correctly) skip them anyway.
    const companion = download.objectId.match(/::(update|dlc)/);
    if (companion) {
      await placeCompanionContent(
        download,
        companion[1] as "update" | "dlc",
        scanRoot,
        platformRoot
      );
      return;
    }

    const result = await scanRomFolder(scanRoot, binary, true);
    const playable = result.games.filter((g) => !g.wrongPlatform);
    if (playable.length === 0) {
      logger.warn(
        `[bindDownloadedRom] No ${system} ROM found under ${scanRoot} for ${download.objectId}`
      );
      return;
    }

    const discs: ClassicsDisc[] = [];
    for (const g of playable) {
      const flattened = flattenIntoRoot(g.primaryPath, platformRoot);
      discs.push({
        path: flattened,
        label: baseName(g.name),
        fileName: g.name,
        sku: null,
      });
    }

    // Remove the now-empty Myrient scaffolding left behind by the torrent —
    // scoped to THIS download's folder so sibling games and their
    // (Update)/(DLC) folders are never touched. Skip when any bound disc still
    // lives inside it (e.g. a folder-format game that IS the scan root).
    const discInsideScanRoot = discs.some((d) =>
      (d.path + path.sep).startsWith(scanRoot + path.sep)
    );
    if (!discInsideScanRoot) {
      cleanupDownloadScaffolding(scanRoot, platformRoot);
    }

    const gameKey = levelKeys.game(download.shop, download.objectId);
    const game = await gamesSublevel.get(gameKey);
    if (!game) return;

    await gamesSublevel.put(gameKey, {
      ...game,
      platform: game.platform ?? SYSTEM_PLATFORM_LABEL[system] ?? system,
      discs,
      selectedDiscPath: discs[0]?.path ?? null,
      romSizeBytes: result.sizeBytes || game.romSizeBytes || null,
      isDeleted: false,
    });

    logger.log(
      `[bindDownloadedRom] Bound ${discs.length} ${system} disc(s) for ${download.objectId}`
    );
  } catch (err) {
    logger.error(
      `[bindDownloadedRom] Failed to bind ROM for ${download.objectId}`,
      err
    );
  }
};
