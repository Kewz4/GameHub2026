import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  EmulationCloudSave,
  EmulationSaveEmulator,
  EmulationSavePlatform,
  UserPreferences,
} from "@types";
import { R2Sync } from "@main/services/r2-sync";
import { db, levelKeys } from "@main/level";
import { assertEmulationSaveKeyForUser } from "../cloud-save/game-artifact-key-policy";
import {
  readSaveContents as readPs2SaveContents,
  buildPsuBuffer as buildPs2PsuBuffer,
} from "./ps2-memory-card";
import {
  readPs1SaveContents as readPs1SaveContentsFromCard,
  buildMcsBuffer as buildPs1McsBuffer,
} from "./ps1-memory-card";

export interface UploadEmulationSaveOptions {
  platform: EmulationSavePlatform;
  emulator: EmulationSaveEmulator;
  shop: string | null;
  objectId: string | null;
  saveIdentity: string;
  fileName: string;
  label: string;
  localLastModifiedAt: string;
  buffer: Buffer;
}

const getOrCreateUserId = async (): Promise<string> => {
  const prefs = await db
    .get<string, UserPreferences>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => ({}) as UserPreferences);

  let userId = prefs?.cloudSyncUserId;
  if (!userId) {
    userId = R2Sync.generateUserId();
    await db.put(
      levelKeys.userPreferences,
      { ...prefs, cloudSyncUserId: userId },
      { valueEncoding: "json" }
    );
  }
  return userId;
};

const artifactToCloudSave = (artifact: {
  id: string;
  platform: string;
  emulator: string;
  saveIdentity: string;
  fileName: string;
  label: string | null;
  shop: string | null;
  objectId: string | null;
  artifactLengthInBytes: number;
  hostname: string;
  localLastModifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}): EmulationCloudSave => ({
  id: artifact.id,
  platform: artifact.platform as EmulationSavePlatform,
  emulator: artifact.emulator as EmulationSaveEmulator,
  saveKind: "game_save",
  saveIdentity: artifact.saveIdentity,
  artifactLengthInBytes: artifact.artifactLengthInBytes,
  fileName: artifact.fileName,
  hostname: artifact.hostname || null,
  localLastModifiedAt: artifact.localLastModifiedAt,
  label: artifact.label,
  metadata: null,
  shop: artifact.shop as EmulationCloudSave["shop"],
  objectId: artifact.objectId,
  lastUploadedAt: artifact.updatedAt,
  createdAt: artifact.createdAt,
  updatedAt: artifact.updatedAt,
});

export const uploadEmulationSave = async (
  options: UploadEmulationSaveOptions
): Promise<EmulationCloudSave> => {
  const userId = await getOrCreateUserId();
  const key = await R2Sync.uploadEmulationSave(options.buffer, {
    userId,
    platform: options.platform,
    emulator: options.emulator,
    saveIdentity: options.saveIdentity,
    fileName: options.fileName,
    label: options.label,
    shop: options.shop,
    objectId: options.objectId,
    localLastModifiedAt: options.localLastModifiedAt,
  });

  return {
    id: key,
    platform: options.platform,
    emulator: options.emulator,
    saveKind: "game_save",
    saveIdentity: options.saveIdentity,
    artifactLengthInBytes: options.buffer.length,
    fileName: options.fileName,
    hostname: null,
    localLastModifiedAt: options.localLastModifiedAt,
    label: options.label,
    metadata: null,
    shop: options.shop as EmulationCloudSave["shop"],
    objectId: options.objectId,
    lastUploadedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

export const toEmulationSaveEmulator = (
  binary: string
): EmulationSaveEmulator => {
  if (binary === "pcsx2") return "pcsx2";
  if (binary === "duckstation") return "duckstation";
  // Fallback: treat as pcsx2 for ps2, duckstation for ps1
  return binary as EmulationSaveEmulator;
};

// Delegated to ps2-memory-card.ts
export const readPs2SaveForUpload = async (
  cardFilePath: string,
  folderName: string
): Promise<Buffer | null> => {
  const contents = await readPs2SaveContents(cardFilePath, folderName);
  if (!contents) return null;
  return buildPs2PsuBuffer(contents);
};

export const assemblePsuBuffer = (contents: Buffer): Buffer => contents;

// Delegated to ps1-memory-card.ts
export const readPs1SaveForUpload = async (
  cardFilePath: string,
  identifier: string
): Promise<Buffer | null> => {
  const contents = await readPs1SaveContentsFromCard(cardFilePath, identifier);
  if (!contents) return null;
  return buildPs1McsBuffer(contents);
};

export const assembleMcsBuffer = (contents: Buffer): Buffer => contents;

// RPCS3 games.yml helpers
const getGamesYmlPath = (executablePath: string | null): string | null => {
  if (!executablePath) return null;
  const dir = path.dirname(executablePath);
  return path.join(dir, "games.yml");
};

export const readGamesYml = async (
  executablePath: string | null
): Promise<Map<string, string>> => {
  const ymlPath = getGamesYmlPath(executablePath);
  if (!ymlPath) return new Map();
  try {
    const content = await fs.readFile(ymlPath, "utf-8");
    const map = new Map<string, string>();
    for (const line of content.split(/\r?\n/)) {
      const m = /^([A-Z0-9_-]{9,12})\s*:\s*(.+)$/.exec(line.trim());
      if (m) map.set(m[1].trim(), m[2].trim());
    }
    return map;
  } catch {
    return new Map();
  }
};

export const mergeWriteGamesYml = async (
  executablePath: string | null,
  entries: Map<string, string>
): Promise<void> => {
  const ymlPath = getGamesYmlPath(executablePath);
  if (!ymlPath || entries.size === 0) return;

  const existing = await readGamesYml(executablePath);
  for (const [key, val] of entries) {
    existing.set(key, val);
  }

  const lines = Array.from(existing.entries()).map(([k, v]) => `${k}: ${v}`);
  await fs.writeFile(ymlPath, lines.join("\n") + "\n", "utf-8");
};

export const buildPathToTitleIdIndex = (
  entries: Map<string, string>
): Map<string, string> => {
  // Invert: path → titleId
  const index = new Map<string, string>();
  for (const [titleId, gamePath] of entries) {
    const norm = path.normalize(gamePath).replace(/[\\/]+$/, "");
    index.set(norm, titleId);
    index.set(path.basename(norm), titleId);
    index.set(path.basename(path.dirname(norm)), titleId);
  }
  return index;
};

// Cloud save listing/management
export const listEmulationSaves = async (
  platform: EmulationSavePlatform,
  objectId?: string | null
): Promise<EmulationCloudSave[]> => {
  const userId = await getOrCreateUserId();
  const artifacts = await R2Sync.listEmulationSaves(userId, platform);
  const filtered = objectId
    ? artifacts.filter((a) => a.objectId === objectId)
    : artifacts;
  return filtered.map(artifactToCloudSave);
};

export const deleteEmulationSave = async (saveId: string): Promise<void> => {
  const userId = await getOrCreateUserId();
  assertEmulationSaveKeyForUser(saveId, userId);
  await R2Sync.deleteEmulationSave(saveId);
};

export const updateEmulationSaveLabel = async (
  saveId: string,
  label: string
): Promise<EmulationCloudSave> => {
  const userId = await getOrCreateUserId();
  assertEmulationSaveKeyForUser(saveId, userId);
  await R2Sync.updateEmulationSaveLabel(saveId, label);
  // Return a minimal updated record; callers only need the id/label shape.
  const artifacts = await R2Sync.listEmulationSaves(userId);
  const updated = artifacts.find((a) => a.id === saveId);
  if (updated) return artifactToCloudSave(updated);
  // Fallback: construct a minimal shell so callers don't crash.
  return {
    id: saveId,
    platform: "ps2",
    emulator: "pcsx2",
    saveKind: "game_save",
    saveIdentity: "",
    artifactLengthInBytes: 0,
    fileName: "",
    hostname: null,
    localLastModifiedAt: null,
    label,
    metadata: null,
    shop: null,
    objectId: null,
    lastUploadedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

export const downloadEmulationSave = async (
  saveId: string
): Promise<Buffer> => {
  const userId = await getOrCreateUserId();
  assertEmulationSaveKeyForUser(saveId, userId);
  return R2Sync.downloadEmulationSave(saveId);
};

// Aliases for upload-emulation-save.ts compatibility
