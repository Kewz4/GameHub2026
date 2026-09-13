import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { emulatorConfigFile } from "./emulator-user-paths";

import type {
  EmulationCloudSave,
  EmulationSaveEmulator,
  EmulationSavePlatform,
} from "@types";
import { R2Sync } from "@main/services/r2-sync";
import { assertEmulationSaveKeyForUser } from "../cloud-save/game-artifact-key-policy";
import {
  assertCloudSaveAccountSessionCurrent,
  getCloudSaveAccountUserId,
  runWithCloudSaveAccountSession,
} from "../cloud-save/account-session";
import { assertCloudSaveSubscription } from "../cloud-save/cloud-save-access";
import {
  readSaveContents as readPs2SaveContents,
  buildPsuBuffer as buildPs2PsuBuffer,
} from "./ps2-memory-card";
import {
  readPs1SaveContents as readPs1SaveContentsFromCard,
  buildMcsBuffer as buildPs1McsBuffer,
} from "./ps1-memory-card";
import {
  assertEmulationSavePlatform,
  emulatorForEmulationSavePlatform,
  isEmulationSavePlatform,
} from "./emulation-save-policy";

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

const withEmulationSaveAccount = <T>(
  operation: (userId: string) => Promise<T>
) =>
  runWithCloudSaveAccountSession(async () => {
    assertCloudSaveSubscription();
    const userId = await getCloudSaveAccountUserId();
    assertCloudSaveAccountSessionCurrent();
    const result = await operation(userId);
    assertCloudSaveAccountSessionCurrent();
    return result;
  });

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
}): EmulationCloudSave | null => {
  if (!isEmulationSavePlatform(artifact.platform)) return null;
  const emulator = emulatorForEmulationSavePlatform(artifact.platform);

  return {
    id: artifact.id,
    platform: artifact.platform,
    // Older PS1 uploads incorrectly persisted the configured RALibretro binary
    // even though this screen manages DuckStation-format memory-card exports.
    // Normalize those records instead of dropping a user's existing backup.
    emulator,
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
  };
};

export const uploadEmulationSave = async (
  options: UploadEmulationSaveOptions
): Promise<EmulationCloudSave> =>
  withEmulationSaveAccount(async (userId) => {
    assertEmulationSavePlatform(options.platform);
    const emulator = emulatorForEmulationSavePlatform(options.platform);
    if (options.emulator !== emulator) {
      throw new Error("Emulation save emulator does not match platform");
    }
    const hostname = os.hostname();
    const key = await R2Sync.uploadEmulationSave(options.buffer, {
      userId,
      platform: options.platform,
      emulator,
      saveIdentity: options.saveIdentity,
      fileName: options.fileName,
      label: options.label,
      shop: options.shop,
      objectId: options.objectId,
      localLastModifiedAt: options.localLastModifiedAt,
      hostname,
    });
    assertCloudSaveAccountSessionCurrent();

    const now = new Date().toISOString();
    return {
      id: key,
      platform: options.platform,
      emulator,
      saveKind: "game_save",
      saveIdentity: options.saveIdentity,
      artifactLengthInBytes: options.buffer.length,
      fileName: options.fileName,
      hostname,
      localLastModifiedAt: options.localLastModifiedAt,
      label: options.label,
      metadata: null,
      shop: options.shop as EmulationCloudSave["shop"],
      objectId: options.objectId,
      lastUploadedAt: now,
      createdAt: now,
      updatedAt: now,
    };
  });

export const toEmulationSaveEmulator = (
  platform: EmulationSavePlatform
): EmulationSaveEmulator => emulatorForEmulationSavePlatform(platform);

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
  return emulatorConfigFile("rpcs3", dir, "games.yml");
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
): Promise<EmulationCloudSave[]> =>
  withEmulationSaveAccount(async (userId) => {
    assertEmulationSavePlatform(platform);
    const artifacts = await R2Sync.listEmulationSaves(userId, platform);
    const filtered = objectId
      ? artifacts.filter((artifact) => artifact.objectId === objectId)
      : artifacts;
    return filtered
      .map(artifactToCloudSave)
      .filter((artifact): artifact is EmulationCloudSave => artifact !== null);
  });

export const deleteEmulationSave = async (saveId: string): Promise<void> =>
  withEmulationSaveAccount(async (userId) => {
    assertEmulationSaveKeyForUser(saveId, userId);
    await R2Sync.deleteEmulationSave(saveId);
  });

export const updateEmulationSaveLabel = async (
  saveId: string,
  label: string
): Promise<EmulationCloudSave> =>
  withEmulationSaveAccount(async (userId) => {
    assertEmulationSaveKeyForUser(saveId, userId);
    await R2Sync.updateEmulationSaveLabel(saveId, label);
    assertCloudSaveAccountSessionCurrent();
    const artifacts = await R2Sync.listEmulationSaves(userId);
    const updated = artifacts.find((artifact) => artifact.id === saveId);
    const cloudSave = updated ? artifactToCloudSave(updated) : null;
    if (!cloudSave) throw new Error("Updated emulation save could not be read");
    return cloudSave;
  });

export const downloadEmulationSave = async (saveId: string): Promise<Buffer> =>
  withEmulationSaveAccount(async (userId) => {
    assertEmulationSaveKeyForUser(saveId, userId);
    return R2Sync.downloadEmulationSave(saveId);
  });

// Aliases for upload-emulation-save.ts compatibility
