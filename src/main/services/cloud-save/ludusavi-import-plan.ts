import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  Game,
  GameShop,
  LocalGameSnapshotContext,
  LocalGameSnapshotSourceFile,
  LudusaviBackupScanEntry,
  SnapshotFile,
} from "@types";
import YAML from "yaml";

const GAME_SHOPS: readonly GameShop[] = [
  "steam",
  "epic",
  "gog",
  "battlenet",
  "xbox",
  "riot",
  "ubisoft",
  "ea",
  "launchbox",
  "custom",
];

const MAX_DISCOVERY_DEPTH = 4;
const MAX_IMPORT_FILES = 20_000;

interface LudusaviMappingFile {
  hash: string;
  size: number;
}

interface LudusaviMappingBackup {
  name?: unknown;
  when?: unknown;
  files?: unknown;
  registry?: unknown;
}

interface LudusaviMappingDocument {
  name?: unknown;
  drives?: unknown;
  backups?: unknown;
}

export interface VerifiedLudusaviBackupFile {
  originalPath: string;
  archivePath: string;
  hash: string;
  sizeBytes: number;
  lastModifiedAt: string;
}

export interface VerifiedLudusaviBackup {
  gameName: string;
  folderPath: string;
  mappingPath: string;
  capturedAt: string;
  files: VerifiedLudusaviBackupFile[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeTitle = (value: string) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeAbsolutePath = (value: string) => {
  let normalized = value.replace(/\\/g, "/");

  // The native Windows scanner returns canonical filesystem paths with the
  // extended-length prefix (for example `//?/C:/Users/...`). Ludusavi stores
  // the same local path in regular drive-letter form. Strip the transport-only
  // prefix for identity comparisons; the source/archive paths used for I/O are
  // left untouched.
  if (/^\/\/\?\/unc\//i.test(normalized)) {
    normalized = `//${normalized.slice(8)}`;
  } else if (/^\/\/\?\//i.test(normalized)) {
    normalized = normalized.slice(4);
  }

  return normalized.replace(/\/+$/, "");
};

const normalizeRelativePath = (value: string) =>
  value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

const isCaseInsensitiveWindowsPath = (value: string) =>
  /^[a-z]:(?:\/|$)/i.test(value) || /^\/\/[^/]+\/[^/]+(?:\/|$)/.test(value);

const comparisonKey = (value: string) =>
  isCaseInsensitiveWindowsPath(value) ? value.toLowerCase() : value;

const isPathInside = (parent: string, candidate: string) => {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};

const assertNoSymlinkSegments = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error("ludusavi_import_symlink_not_allowed");
    }
  }
};

const hashFile = (filePath: string, algorithm: "sha1" | "sha256") =>
  new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });

const parseDocument = (mappingPath: string): LudusaviMappingDocument => {
  const parsed = YAML.parse(fs.readFileSync(mappingPath, "utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error("ludusavi_import_invalid_mapping");
  return parsed;
};

const selectLatestSimpleBackup = (
  document: LudusaviMappingDocument
): {
  gameName: string;
  capturedAt: string;
  drives: Record<string, string>;
  files: Record<string, LudusaviMappingFile>;
} => {
  if (typeof document.name !== "string" || !document.name.trim()) {
    throw new Error("ludusavi_import_invalid_game_name");
  }
  if (!isRecord(document.drives)) {
    throw new Error("ludusavi_import_missing_drives");
  }
  const drives = Object.fromEntries(
    Object.entries(document.drives).filter(
      (entry): entry is [string, string] =>
        !entry[0].includes("/") &&
        !entry[0].includes("\\") &&
        entry[0] !== "." &&
        entry[0] !== ".." &&
        typeof entry[1] === "string" &&
        entry[1].length > 0
    )
  );
  if (Object.keys(drives).length === 0) {
    throw new Error("ludusavi_import_missing_drives");
  }
  if (!Array.isArray(document.backups) || document.backups.length === 0) {
    throw new Error("ludusavi_import_missing_backup");
  }

  const backups = (document.backups as LudusaviMappingBackup[])
    .filter(isRecord)
    .map((backup) => ({
      backup,
      timestamp:
        typeof backup.when === "string" ? Date.parse(backup.when) : NaN,
    }))
    .filter(({ timestamp }) => Number.isFinite(timestamp))
    .sort((left, right) => right.timestamp - left.timestamp);
  const latest = backups[0]?.backup;
  if (!latest) throw new Error("ludusavi_import_missing_backup");
  if (latest.name !== ".") {
    throw new Error("ludusavi_import_unsupported_backup_format");
  }
  if (!isRecord(latest.files)) {
    throw new Error("ludusavi_import_missing_files");
  }
  if (
    isRecord(latest.registry) &&
    typeof latest.registry.hash === "string" &&
    latest.registry.hash.length > 0
  ) {
    throw new Error("ludusavi_import_registry_not_supported");
  }

  const files: Record<string, LudusaviMappingFile> = {};
  for (const [originalPath, metadata] of Object.entries(latest.files)) {
    if (
      !isRecord(metadata) ||
      typeof metadata.hash !== "string" ||
      !/^[a-f0-9]{40}$/i.test(metadata.hash) ||
      typeof metadata.size !== "number" ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size < 0
    ) {
      throw new Error("ludusavi_import_invalid_file_metadata");
    }
    files[originalPath] = { hash: metadata.hash, size: metadata.size };
  }
  if (Object.keys(files).length === 0) {
    throw new Error("ludusavi_import_missing_files");
  }
  if (Object.keys(files).length > MAX_IMPORT_FILES) {
    throw new Error("ludusavi_import_too_many_files");
  }

  return {
    gameName: document.name.trim(),
    capturedAt: new Date(backups[0].timestamp).toISOString(),
    drives,
    files,
  };
};

const resolveArchivedFile = (
  folderPath: string,
  drives: Record<string, string>,
  originalPath: string
) => {
  const normalizedOriginal = normalizeAbsolutePath(originalPath);
  const candidates = Object.entries(drives)
    .map(([folder, driveRoot]) => ({
      folder,
      driveRoot: normalizeAbsolutePath(driveRoot),
    }))
    .sort((left, right) => right.driveRoot.length - left.driveRoot.length);
  const mapping = candidates.find(({ driveRoot }) => {
    const originalKey = comparisonKey(normalizedOriginal);
    const rootKey = comparisonKey(driveRoot);
    return originalKey === rootKey || originalKey.startsWith(`${rootKey}/`);
  });
  if (!mapping) throw new Error("ludusavi_import_unmapped_drive");

  const relative = normalizeRelativePath(
    normalizedOriginal.slice(mapping.driveRoot.length)
  );
  if (!relative || relative.split("/").some((part) => part === "..")) {
    throw new Error("ludusavi_import_invalid_archive_path");
  }
  const driveFolder = path.resolve(folderPath, mapping.folder);
  const archivePath = path.resolve(driveFolder, ...relative.split("/"));
  if (
    !isPathInside(folderPath, driveFolder) ||
    !isPathInside(driveFolder, archivePath)
  ) {
    throw new Error("ludusavi_import_invalid_archive_path");
  }
  if (!fs.statSync(archivePath).isFile()) {
    throw new Error("ludusavi_import_file_missing");
  }
  assertNoSymlinkSegments(folderPath, archivePath);
  const realFolder = fs.realpathSync.native(folderPath);
  const realArchivePath = fs.realpathSync.native(archivePath);
  if (!isPathInside(realFolder, realArchivePath)) {
    throw new Error("ludusavi_import_invalid_archive_path");
  }
  return realArchivePath;
};

export const discoverLudusaviMappingFolders = (rootPath: string): string[] => {
  const root = path.resolve(rootPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  const mappings: string[] = [];
  const visit = (folder: string, depth: number) => {
    if (depth > MAX_DISCOVERY_DEPTH) return;
    const mappingPath = path.join(folder, "mapping.yaml");
    if (fs.existsSync(mappingPath) && fs.statSync(mappingPath).isFile()) {
      mappings.push(folder);
      return;
    }
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        /^drive-/i.test(entry.name)
      ) {
        continue;
      }
      visit(path.join(folder, entry.name), depth + 1);
    }
  };
  visit(root, 0);
  return mappings.sort((left, right) => left.localeCompare(right));
};

const parseGamehubIdentity = (value: string) => {
  const match = /^gamehub-pc:([^:]+):(.+)$/i.exec(value.trim());
  if (!match) return null;
  const shop = GAME_SHOPS.find((candidate) => candidate === match[1]);
  return shop ? { shop, objectId: match[2] } : null;
};

const parseAncestorIdentity = (folderPath: string, scanRoot: string) => {
  const segments = path.relative(scanRoot, folderPath).split(path.sep);
  for (const segment of segments) {
    for (const shop of GAME_SHOPS) {
      const prefix = `${shop}-`;
      if (segment.startsWith(prefix) && segment.length > prefix.length) {
        return { shop, objectId: segment.slice(prefix.length) };
      }
    }
  }
  return null;
};

export const scanLudusaviBackupRoot = (
  rootPath: string,
  library: Game[]
): LudusaviBackupScanEntry[] => {
  const activeGames = library.filter((game) => !game.isDeleted);
  return discoverLudusaviMappingFolders(rootPath).flatMap((folderPath) => {
    try {
      const mappingPath = path.join(folderPath, "mapping.yaml");
      const summary = selectLatestSimpleBackup(parseDocument(mappingPath));
      const embedded = parseGamehubIdentity(summary.gameName);
      const ancestor = parseAncestorIdentity(
        folderPath,
        path.resolve(rootPath)
      );
      const byIdentity = (
        identity: { shop: GameShop; objectId: string } | null
      ) =>
        identity
          ? activeGames.find(
              (game) =>
                game.shop === identity.shop &&
                game.objectId === identity.objectId
            )
          : undefined;
      const embeddedGame = byIdentity(embedded);
      const ancestorGame = byIdentity(ancestor);
      const titleMatches = activeGames.filter(
        (game) =>
          normalizeTitle(game.title) === normalizeTitle(summary.gameName)
      );
      const suggestedGame =
        embeddedGame ??
        ancestorGame ??
        (titleMatches.length === 1 ? titleMatches[0] : undefined);
      const matchReason = embeddedGame
        ? "gamehub-id"
        : ancestorGame
          ? "backup-folder-id"
          : suggestedGame
            ? "exact-title"
            : null;
      return [
        {
          gameName: summary.gameName,
          folderPath,
          mappingPath,
          hasMappingYaml: true as const,
          capturedAt: summary.capturedAt,
          fileCount: Object.keys(summary.files).length,
          totalSizeBytes: Object.values(summary.files).reduce(
            (total, file) => total + file.size,
            0
          ),
          suggestedGame: suggestedGame
            ? {
                shop: suggestedGame.shop,
                objectId: suggestedGame.objectId,
                title: suggestedGame.title,
              }
            : null,
          matchReason,
        },
      ];
    } catch {
      return [];
    }
  });
};

export const loadVerifiedLudusaviBackup = async (
  folderPath: string
): Promise<VerifiedLudusaviBackup> => {
  const resolvedFolder = path.resolve(folderPath);
  const mappingPath = path.join(resolvedFolder, "mapping.yaml");
  if (!fs.existsSync(mappingPath)) {
    throw new Error("ludusavi_import_mapping_not_found");
  }
  const summary = selectLatestSimpleBackup(parseDocument(mappingPath));
  const files: VerifiedLudusaviBackupFile[] = [];
  for (const [originalPath, metadata] of Object.entries(summary.files)) {
    const archivePath = resolveArchivedFile(
      resolvedFolder,
      summary.drives,
      originalPath
    );
    const stat = fs.statSync(archivePath);
    if (stat.size !== metadata.size) {
      throw new Error("ludusavi_import_size_mismatch");
    }
    const declaredHash = await hashFile(archivePath, "sha1");
    if (declaredHash.toLowerCase() !== metadata.hash.toLowerCase()) {
      throw new Error("ludusavi_import_hash_mismatch");
    }
    files.push({
      originalPath: normalizeAbsolutePath(originalPath),
      archivePath,
      hash: await hashFile(archivePath, "sha256"),
      sizeBytes: stat.size,
      lastModifiedAt: stat.mtime.toISOString(),
    });
  }
  return {
    gameName: summary.gameName,
    folderPath: resolvedFolder,
    mappingPath,
    capturedAt: summary.capturedAt,
    files,
  };
};

interface SourceTemplate {
  source: LocalGameSnapshotSourceFile;
  root: string;
  rootKey: string;
}

const buildSourceTemplates = (context: LocalGameSnapshotContext) =>
  context.sourceFiles.flatMap((source): SourceTemplate[] => {
    const absolute = normalizeAbsolutePath(source.absolutePath);
    const relative = normalizeRelativePath(source.relativePath);
    const absoluteKey = comparisonKey(absolute);
    const relativeKey = isCaseInsensitiveWindowsPath(absolute)
      ? relative.toLowerCase()
      : relative;
    if (
      !relative ||
      (absoluteKey !== relativeKey && !absoluteKey.endsWith(`/${relativeKey}`))
    ) {
      return [];
    }
    const root = normalizeAbsolutePath(
      absolute.slice(0, absolute.length - relative.length)
    );
    return [{ source, root, rootKey: comparisonKey(root) }];
  });

const matchBackupFileToSource = (
  file: VerifiedLudusaviBackupFile,
  templates: SourceTemplate[]
) => {
  const original = normalizeAbsolutePath(file.originalPath);
  const originalKey = comparisonKey(original);
  const exact = templates.filter(
    ({ source }) =>
      comparisonKey(normalizeAbsolutePath(source.absolutePath)) === originalKey
  );
  const candidates = (exact.length > 0 ? exact : templates).filter(
    ({ rootKey }) => originalKey.startsWith(`${rootKey}/`)
  );
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => right.root.length - left.root.length);
  const bestLength = candidates[0].root.length;
  const best = candidates.filter(
    (candidate) => candidate.root.length === bestLength
  );
  const identities = new Set(
    best.map(({ source }) => JSON.stringify([source.variantId, source.rawPath]))
  );
  if (identities.size !== 1) {
    throw new Error("ludusavi_import_ambiguous_save_rule");
  }
  const template = best[0];
  const relativePath = normalizeRelativePath(
    original.slice(template.root.length)
  );
  if (
    !relativePath ||
    relativePath.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("ludusavi_import_invalid_relative_path");
  }
  return { template: template.source, relativePath };
};

export const buildLudusaviImportSnapshotContext = (
  backup: VerifiedLudusaviBackup,
  context: LocalGameSnapshotContext,
  buildAggregateHash: (input: {
    variants: LocalGameSnapshotContext["variants"];
    files: SnapshotFile[];
  }) => string
): LocalGameSnapshotContext => {
  const templates = buildSourceTemplates(context);
  const sourceFiles: LocalGameSnapshotSourceFile[] = [];
  const files: SnapshotFile[] = [];
  const unmapped: string[] = [];

  for (const file of backup.files) {
    const match = matchBackupFileToSource(file, templates);
    if (!match) {
      unmapped.push(file.originalPath);
      continue;
    }
    const identity = {
      variantId: match.template.variantId,
      rawPath: match.template.rawPath,
      relativePath: match.relativePath,
    };
    files.push({
      ...identity,
      hash: file.hash,
      sizeBytes: file.sizeBytes,
      lastModifiedAt: file.lastModifiedAt,
    });
    sourceFiles.push({
      ...match.template,
      ...identity,
      absolutePath: file.archivePath,
      hash: file.hash,
      sizeBytes: file.sizeBytes,
      lastModifiedAt: file.lastModifiedAt,
      provenance: [...match.template.provenance, "ludusavi-import"],
    });
  }
  if (unmapped.length > 0) {
    const error = new Error("ludusavi_import_unmapped_files") as Error & {
      unmappedPaths?: string[];
    };
    error.unmappedPaths = unmapped.slice(0, 20);
    throw error;
  }
  if (files.length === 0) throw new Error("ludusavi_import_missing_files");

  const usedVariantIds = new Set(files.map((file) => file.variantId));
  const variants = context.variants.filter((variant) =>
    usedVariantIds.has(variant.variantId)
  );
  if (variants.length !== usedVariantIds.size) {
    throw new Error("ludusavi_import_missing_variant");
  }
  const usedCustomRawPaths = new Set(
    files
      .map((file) => file.rawPath)
      .filter((rawPath) => rawPath.startsWith("<custom>"))
  );
  const customPathRawPaths = context.customPathRawPaths.filter((rawPath) =>
    usedCustomRawPaths.has(rawPath)
  );
  if (customPathRawPaths.length !== usedCustomRawPaths.size) {
    throw new Error("ludusavi_import_unregistered_custom_path");
  }
  const aggregateHash = buildAggregateHash({
    variants,
    files,
  });
  return {
    ...context,
    variants,
    files,
    sourceFiles,
    fileCount: files.length,
    totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    aggregateHash,
    customPathRawPaths,
  };
};
