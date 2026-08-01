import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export const MIN_LUDUSAVI_FUZZY_MATCH_SCORE = 0.95;

export type LudusaviManifestOs = "windows" | "linux" | "mac";

export interface LudusaviManifestContext {
  os: LudusaviManifestOs;
  shop: string;
}

export interface LudusaviManifestSaveMapping {
  paths: string[];
  registry: string[];
  installDirName: string | null;
}

const LUDUSAVI_STORE_BY_GAME_SHOP: Record<string, string> = {
  steam: "steam",
  epic: "epic",
  gog: "gog",
  xbox: "microsoft",
  ubisoft: "uplay",
};

export const getLudusaviManifestOs = (
  platform: NodeJS.Platform
): LudusaviManifestOs => {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "mac";
  return "linux";
};

export const getLudusaviManifestStore = (shop: string): string | null =>
  LUDUSAVI_STORE_BY_GAME_SHOP[shop.toLowerCase()] ?? null;

const BUILT_IN_SAVE_OVERRIDES: Record<
  string,
  { paths: string[]; installDirName: string }
> = {
  "steam:1135230": {
    installDirName: "EmberKnights",
    paths: ["<base>/EmberKnights_64_Data/SaveData"],
  },
};

export const getBuiltInSaveOverride = (shop: string, objectId: string) => {
  const match = BUILT_IN_SAVE_OVERRIDES[`${shop}:${objectId}`];
  return match
    ? { paths: [...match.paths], installDirName: match.installDirName }
    : null;
};

export const isAcceptedLudusaviFuzzyScore = (score: number): boolean =>
  Number.isFinite(score) && score >= MIN_LUDUSAVI_FUZZY_MATCH_SCORE;

const parseYamlMappingKey = (line: string) => {
  const match = /^(\s+)(?:"([^"]+)"|([^:]+))\s*:/.exec(line);
  if (!match) return null;
  return {
    indent: match[1].length,
    key: (match[2] ?? match[3]).trim(),
  };
};

/**
 * Read the first install-directory key from a Ludusavi manifest section.
 * Manifest sections normally list `files` before `installDir`, so this scan is
 * deliberately independent from file-template parsing.
 */
export const extractLudusaviInstallDirName = (
  sectionLines: string[]
): string | null => {
  for (let i = 0; i < sectionLines.length; i++) {
    const header = /^(\s+)installDir:/.exec(sectionLines[i]);
    if (!header) continue;

    const installDirDepth = header[1].length;
    for (let j = i + 1; j < sectionLines.length; j++) {
      const line = sectionLines[j];
      if (!line.trim() || /^\s*#/.test(line)) continue;

      const mappingKey = parseYamlMappingKey(line);
      if (!mappingKey) {
        const indent = line.length - line.trimStart().length;
        if (indent <= installDirDepth) break;
        continue;
      }

      if (mappingKey.indent <= installDirDepth) break;
      if (mappingKey.indent === installDirDepth + 2) {
        return mappingKey.key || null;
      }
    }
    break;
  }

  return null;
};

type LudusaviManifestCondition = {
  os?: string | string[] | null;
  store?: string | string[] | null;
};

type LudusaviManifestEntry = {
  when?: LudusaviManifestCondition | LudusaviManifestCondition[] | null;
};

type LudusaviManifestGameSection = {
  files?: Record<string, LudusaviManifestEntry | null> | null;
  registry?: Record<string, LudusaviManifestEntry | null> | null;
};

const constraintMatches = (
  constraint: string | string[] | null | undefined,
  actual: string | null
): boolean => {
  if (constraint == null) return true;
  const expected = Array.isArray(constraint) ? constraint : [constraint];
  if (expected.length === 0) return true;
  if (!actual) return false;
  return expected.some(
    (value) => String(value).toLowerCase() === actual.toLowerCase()
  );
};

const manifestEntryMatches = (
  entry: LudusaviManifestEntry | null,
  context: LudusaviManifestContext
): boolean => {
  if (!entry || typeof entry !== "object" || entry.when == null) return true;

  const conditions = Array.isArray(entry.when) ? entry.when : [entry.when];
  if (conditions.length === 0) return true;

  const store = getLudusaviManifestStore(context.shop);
  return conditions.some(
    (condition) =>
      condition != null &&
      typeof condition === "object" &&
      constraintMatches(condition.os, context.os) &&
      constraintMatches(condition.store, store)
  );
};

const parseManifestGameSection = (
  sectionLines: string[]
): LudusaviManifestGameSection => {
  // `sectionLines` are copied from beneath a top-level game key, so remove the
  // manifest's two-space game indentation before parsing the small section.
  // Parsing only this section keeps the multi-megabyte manifest out of YAML's
  // object graph while still honoring quoted keys and escaped characters.
  const source = sectionLines
    .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
    .join("\n");

  try {
    const parsed = YAML.parse(source);
    return parsed && typeof parsed === "object"
      ? (parsed as LudusaviManifestGameSection)
      : {};
  } catch {
    return {};
  }
};

/**
 * Select the save-file and registry entries that apply to one OS/store pair.
 * Ludusavi treats items inside `when` as alternatives and fields within one
 * item as a conjunction. Registry data is Windows-only even when an upstream
 * manifest entry omits an explicit OS condition.
 */
export const extractLudusaviManifestSaveMapping = (
  sectionLines: string[],
  context: LudusaviManifestContext
): LudusaviManifestSaveMapping => {
  const section = parseManifestGameSection(sectionLines);

  const paths = Object.entries(section.files ?? {})
    .filter(([, entry]) => manifestEntryMatches(entry, context))
    .map(([entryPath]) => entryPath);

  const registry =
    context.os === "windows"
      ? Object.entries(section.registry ?? {})
          .filter(([, entry]) => manifestEntryMatches(entry, context))
          .map(([registryPath]) => registryPath)
      : [];

  return {
    paths,
    registry,
    installDirName: extractLudusaviInstallDirName(sectionLines),
  };
};

/**
 * Convert an executable path into Ludusavi's `<base>`. Prefer a manifest-named
 * ancestor or sibling over the executable directory: games often store the
 * runnable binary several levels down, while launchers such as Riot are shared
 * by a neighboring game directory.
 */
export const resolveInstallDirFromExecutable = (
  executablePath: string,
  installDirName: string | null
): string => {
  const executableDir = path.dirname(executablePath);
  if (!installDirName) return executableDir;

  const normalizeName = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = normalizeName(installDirName);

  let current = executableDir;
  for (let depth = 0; depth < 6; depth++) {
    if (normalizeName(path.basename(current)) === wanted) return current;

    const parent = path.dirname(current);
    if (parent === current) break;

    const exactSibling = path.join(parent, installDirName);
    if (fs.existsSync(exactSibling)) return exactSibling;

    try {
      const normalizedSibling = fs
        .readdirSync(parent, { withFileTypes: true })
        .find(
          (entry) => entry.isDirectory() && normalizeName(entry.name) === wanted
        );
      if (normalizedSibling) return path.join(parent, normalizedSibling.name);
    } catch {
      // Keep walking ancestors when a parent cannot be enumerated.
    }

    current = parent;
  }

  return executableDir;
};
