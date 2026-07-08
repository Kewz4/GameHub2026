import axios from "axios";
import {
  createWriteStream,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";

import type { CemuGraphicPack, CemuGraphicPackPresetCategory } from "@types";
import type { GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger } from "../logger";
import { SevenZip } from "../7zip";
import { getEmulatorConfig } from "./emulators-repository";
import { cemuDataDir } from "./emulator-portable";

/**
 * Resolve the 16-hex Wii U title id for a library game by reading the title's
 * meta/meta.xml (Cemu folder games), so graphic packs can be scoped to the game
 * you actually opened instead of listing every downloaded pack. Returns the
 * lowercased id, or null for disc-image games where no loose meta.xml exists.
 */
export const resolveWiiuTitleId = async (
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);
  if (!game) return null;

  const roots = [
    game.selectedDiscPath,
    ...(game.discs?.map((d) => d.path) ?? []),
    game.executablePath,
  ].filter((p): p is string => Boolean(p));

  // meta.xml lives at <gameDir>/meta/meta.xml. The stored path may point at the
  // game folder, at code/<name>.rpx, or a disc file — probe a few parents.
  for (const root of roots) {
    const bases = [root, path.dirname(root), path.dirname(path.dirname(root))];
    for (const base of bases) {
      const metaPath = path.join(base, "meta", "meta.xml");
      try {
        if (!existsSync(metaPath)) continue;
        const xml = readFileSync(metaPath, "utf-8");
        const m = xml.match(
          /<title_id[^>]*>\s*([0-9a-fA-F]{16})\s*<\/title_id>/
        );
        if (m) return m[1].toLowerCase();
      } catch {
        // keep probing
      }
    }
  }
  return null;
};

/**
 * Cemu graphic-pack manager. Cemu's graphic packs are community-maintained in
 * cemu-project/cemu_graphic_packs and shipped as a versioned release zip. We
 * download/extract them into the (portable) install's
 * `graphicPacks/downloadedGraphicPacks/`, parse each pack's `rules.txt`, and
 * enable/preset them by editing the `<GraphicPack>` block of settings.xml — the
 * exact same wiring Cemu itself uses, so packs light up on the next launch.
 */

const GRAPHIC_PACKS_RELEASE_API =
  "https://api.github.com/repos/cemu-project/cemu_graphic_packs/releases/latest";

interface CemuPaths {
  installDir: string;
  dataDir: string;
  packsDir: string;
  settingsFile: string;
}

/** Resolve the Cemu install + portable data locations, or null if not set up. */
const resolvePaths = async (): Promise<CemuPaths | null> => {
  const config = await getEmulatorConfig("wiiu").catch(() => null);
  const exe = config?.executablePath;
  if (config?.binary !== "cemu" || !exe || !existsSync(exe)) return null;
  const installDir = path.dirname(exe);
  const dataDir = cemuDataDir(installDir);
  return {
    installDir,
    dataDir,
    packsDir: path.join(dataDir, "graphicPacks", "downloadedGraphicPacks"),
    settingsFile: path.join(dataDir, "settings.xml"),
  };
};

// ── rules.txt parsing ────────────────────────────────────────────────────────

interface ParsedRules {
  name: string;
  path: string;
  titleIds: string[];
  description: string | null;
  /** category → ordered list of preset names. */
  presets: Map<string, string[]>;
}

const stripQuotes = (v: string): string => v.replace(/^["']|["']$/g, "").trim();

const parseRulesFile = (content: string): ParsedRules => {
  const rules: ParsedRules = {
    name: "",
    path: "",
    titleIds: [],
    description: null,
    presets: new Map(),
  };
  let section = "";
  let presetName = "";
  let presetCategory = "";
  const flushPreset = () => {
    if (!presetName) return;
    const list = rules.presets.get(presetCategory) ?? [];
    if (!list.includes(presetName)) list.push(presetName);
    rules.presets.set(presetCategory, list);
    presetName = "";
    presetCategory = "";
  };

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      flushPreset();
      section = sec[1].toLowerCase();
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = stripQuotes(line.slice(eq + 1).trim());

    if (section === "definition") {
      if (key === "name") rules.name = value;
      else if (key === "path") rules.path = value;
      else if (key === "description") rules.description = value;
      else if (key === "titleids")
        rules.titleIds = value
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
    } else if (section === "preset") {
      if (key === "name") presetName = value;
      else if (key === "category") presetCategory = value;
    }
  }
  flushPreset();
  return rules;
};

// ── settings.xml <GraphicPack> block ─────────────────────────────────────────

interface ActiveEntry {
  filename: string;
  /** category → active preset. */
  presets: Record<string, string>;
}

const parseActiveEntries = (xml: string): ActiveEntry[] => {
  const block = /<GraphicPack>([\s\S]*?)<\/GraphicPack>/i.exec(xml)?.[1];
  if (!block) return [];
  const entries: ActiveEntry[] = [];
  const re = /<Entry\s+filename="([^"]+)"\s*(\/>|>([\s\S]*?)<\/Entry>)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const presets: Record<string, string> = {};
    const inner = m[3] ?? "";
    // NB: case-sensitive — Cemu uses a capital <Preset> wrapper but lowercase
    // <preset>/<category> value tags, so `i` here would let </Preset> match the
    // inner </preset> and truncate the capture.
    const pre = /<Preset>([\s\S]*?)<\/Preset>/g;
    let pm: RegExpExecArray | null;
    while ((pm = pre.exec(inner)) !== null) {
      const body = pm[1];
      const cat = (
        /<category>([\s\S]*?)<\/category>/.exec(body)?.[1] ?? ""
      ).trim();
      const val = (/<preset>([\s\S]*?)<\/preset>/.exec(body)?.[1] ?? "").trim();
      if (val) presets[cat] = val;
    }
    entries.push({ filename: m[1], presets });
  }
  return entries;
};

const serializeEntries = (entries: ActiveEntry[]): string => {
  const body = entries
    .map((e) => {
      const cats = Object.entries(e.presets).filter(([, v]) => v);
      if (cats.length === 0) return `        <Entry filename="${e.filename}"/>`;
      const presetsXml = cats
        .map(([cat, val]) =>
          cat
            ? `            <Preset>\n                <category>${cat}</category>\n                <preset>${val}</preset>\n            </Preset>`
            : `            <Preset>\n                <preset>${val}</preset>\n            </Preset>`
        )
        .join("\n");
      return `        <Entry filename="${e.filename}">\n${presetsXml}\n        </Entry>`;
    })
    .join("\n");
  return `    <GraphicPack>\n${body}\n    </GraphicPack>`;
};

const writeGraphicPackBlock = (xml: string, entries: ActiveEntry[]): string => {
  const block = serializeEntries(entries);
  if (/<GraphicPack>[\s\S]*?<\/GraphicPack>/i.test(xml)) {
    return xml.replace(/[ \t]*<GraphicPack>[\s\S]*?<\/GraphicPack>/i, block);
  }
  if (/<GraphicPack\s*\/>/i.test(xml)) {
    return xml.replace(/[ \t]*<GraphicPack\s*\/>/i, block);
  }
  if (/<\/content>/i.test(xml)) {
    return xml.replace(/<\/content>/i, `${block}\n</content>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<content>\n${block}\n</content>\n`;
};

const readSettings = (settingsFile: string): string =>
  existsSync(settingsFile) ? readFileSync(settingsFile, "utf-8") : "";

const persistEntries = (settingsFile: string, entries: ActiveEntry[]): void => {
  const xml =
    readSettings(settingsFile) ||
    `<?xml version="1.0" encoding="UTF-8"?>\n<content>\n</content>\n`;
  mkdirSync(path.dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, writeGraphicPackBlock(xml, entries));
};

// ── Public API ───────────────────────────────────────────────────────────────

/** Recursively collect every rules.txt path under a root. */
const findRulesFiles = (root: string): string[] => {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) stack.push(full);
      else if (entry.toLowerCase() === "rules.txt") out.push(full);
    }
  }
  return out;
};

/** True when the graphic-pack library has been downloaded. */
export const hasGraphicPacksLibrary = async (): Promise<boolean> => {
  const paths = await resolvePaths();
  if (!paths || !existsSync(paths.packsDir)) return false;
  return findRulesFiles(paths.packsDir).length > 0;
};

/**
 * List installed graphic packs. When `titleId` is provided, only packs that
 * declare that Wii U title id are returned (the game-specific view); otherwise
 * every downloaded pack is returned.
 */
export const listGraphicPacks = async (
  titleId?: string | null
): Promise<CemuGraphicPack[]> => {
  const paths = await resolvePaths();
  if (!paths || !existsSync(paths.packsDir)) return [];

  const active = parseActiveEntries(readSettings(paths.settingsFile));
  const activeByFile = new Map(active.map((e) => [e.filename, e]));
  const wanted = titleId?.trim().toLowerCase() || null;

  const packs: CemuGraphicPack[] = [];
  for (const rulesPath of findRulesFiles(paths.packsDir)) {
    let parsed: ParsedRules;
    try {
      parsed = parseRulesFile(readFileSync(rulesPath, "utf-8"));
    } catch {
      continue;
    }
    if (wanted && !parsed.titleIds.includes(wanted)) continue;

    // Id = rules.txt path relative to the data dir, POSIX-style — this is the
    // exact string Cemu stores in <Entry filename="...">.
    const id = path
      .relative(paths.dataDir, rulesPath)
      .split(path.sep)
      .join("/");
    const activeEntry = activeByFile.get(id);

    const presets: CemuGraphicPackPresetCategory[] = Array.from(
      parsed.presets.entries()
    ).map(([category, options]) => ({
      category,
      options,
      active: activeEntry?.presets[category] ?? null,
    }));

    packs.push({
      id,
      name: parsed.name || parsed.path.split("/").pop() || "Graphic pack",
      path: parsed.path || parsed.name,
      titleIds: parsed.titleIds,
      description: parsed.description,
      enabled: Boolean(activeEntry),
      presets,
    });
  }

  packs.sort((a, b) => a.path.localeCompare(b.path));
  return packs;
};

/** Enable or disable a graphic pack by its id (rules.txt relative path). */
export const setGraphicPackEnabled = async (
  id: string,
  enabled: boolean
): Promise<boolean> => {
  const paths = await resolvePaths();
  if (!paths) return false;
  const entries = parseActiveEntries(readSettings(paths.settingsFile));
  const idx = entries.findIndex((e) => e.filename === id);
  if (enabled && idx === -1) entries.push({ filename: id, presets: {} });
  else if (!enabled && idx !== -1) entries.splice(idx, 1);
  persistEntries(paths.settingsFile, entries);
  return true;
};

/**
 * Set (or clear, with an empty preset) the active preset for one category of a
 * pack. Enabling a preset implicitly enables the pack.
 */
export const setGraphicPackPreset = async (
  id: string,
  category: string,
  preset: string
): Promise<boolean> => {
  const paths = await resolvePaths();
  if (!paths) return false;
  const entries = parseActiveEntries(readSettings(paths.settingsFile));
  let entry = entries.find((e) => e.filename === id);
  if (!entry) {
    entry = { filename: id, presets: {} };
    entries.push(entry);
  }
  if (preset) entry.presets[category] = preset;
  else delete entry.presets[category];
  persistEntries(paths.settingsFile, entries);
  return true;
};

// ── Download / update the pack library ───────────────────────────────────────

const downloadToFile = async (url: string, dest: string): Promise<void> => {
  const response = await axios.get<NodeJS.ReadableStream>(url, {
    responseType: "stream",
    timeout: 0,
    maxRedirects: 5,
    headers: { "User-Agent": "GameHub" },
  });
  await pipeline(response.data, createWriteStream(dest));
};

/**
 * Download the latest community graphic-pack bundle and extract it into the
 * install's downloadedGraphicPacks folder. Returns the number of packs present
 * afterwards.
 */
export const downloadGraphicPacks = async (): Promise<{
  ok: boolean;
  count: number;
  reason?: string;
}> => {
  const paths = await resolvePaths();
  if (!paths) return { ok: false, count: 0, reason: "Cemu is not installed" };

  try {
    const release = await axios.get<{
      tag_name: string;
      assets: { name: string; browser_download_url: string }[];
    }>(GRAPHIC_PACKS_RELEASE_API, {
      headers: {
        "User-Agent": "GameHub",
        Accept: "application/vnd.github+json",
      },
      timeout: 30_000,
    });

    const assets = release.data.assets ?? [];
    const asset =
      assets.find((a) => /graphicpacks.*\.zip$/i.test(a.name)) ??
      assets.find((a) => /\.zip$/i.test(a.name));
    if (!asset) {
      return { ok: false, count: 0, reason: "No graphic-pack asset found" };
    }

    const tmpRoot = path.join(os.tmpdir(), `gh-cemu-gp-${Date.now()}`);
    mkdirSync(tmpRoot, { recursive: true });
    const zipPath = path.join(tmpRoot, asset.name);
    await downloadToFile(asset.browser_download_url, zipPath);

    const extractDir = path.join(tmpRoot, "extract");
    mkdirSync(extractDir, { recursive: true });
    const extraction = await SevenZip.extractFile({
      filePath: zipPath,
      outputPath: extractDir,
    });
    if (!extraction.success) {
      rmSync(tmpRoot, { recursive: true, force: true });
      return { ok: false, count: 0, reason: "Failed to extract graphic packs" };
    }

    // The zip may wrap the packs in a single top folder — descend into it when
    // the extract root has no rules.txt of its own but one child directory.
    let sourceRoot = extractDir;
    const rootEntries = readdirSync(extractDir);
    if (
      rootEntries.length === 1 &&
      statSync(path.join(extractDir, rootEntries[0])).isDirectory()
    ) {
      sourceRoot = path.join(extractDir, rootEntries[0]);
    }

    mkdirSync(paths.packsDir, { recursive: true });
    for (const entry of readdirSync(sourceRoot)) {
      const from = path.join(sourceRoot, entry);
      if (!statSync(from).isDirectory()) continue;
      cpSync(from, path.join(paths.packsDir, entry), { recursive: true });
    }

    rmSync(tmpRoot, { recursive: true, force: true });
    const count = findRulesFiles(paths.packsDir).length;
    logger.log(`[cemu-gp] downloaded graphic packs: ${count} packs`);
    return { ok: true, count };
  } catch (err) {
    logger.error("[cemu-gp] download failed", err);
    return { ok: false, count: 0, reason: String(err) };
  }
};
