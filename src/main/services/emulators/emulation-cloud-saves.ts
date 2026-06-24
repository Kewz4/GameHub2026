import { promises as fs } from "node:fs";
import path from "node:path";
import FormData from "form-data";

import type {
  EmulationCloudSave,
  EmulationSaveEmulator,
  EmulationSavePlatform,
} from "@types";
import { HydraApi } from "@main/services/hydra-api";
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

export const uploadEmulationSave = async (
  options: UploadEmulationSaveOptions
): Promise<EmulationCloudSave> => {
  const form = new FormData();
  form.append("platform", options.platform);
  form.append("emulator", options.emulator);
  if (options.shop) form.append("shop", options.shop);
  if (options.objectId) form.append("objectId", options.objectId);
  form.append("saveIdentity", options.saveIdentity);
  form.append("label", options.label);
  form.append("localLastModifiedAt", options.localLastModifiedAt);
  form.append("file", options.buffer, {
    filename: options.fileName,
    contentType: "application/octet-stream",
  });

  return HydraApi.post<EmulationCloudSave>("/profile/emulation-saves", form, {
    needsAuth: true,
  });
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
  const params: Record<string, string> = { platform };
  if (objectId) params.objectId = objectId;
  return HydraApi.get<EmulationCloudSave[]>(
    "/profile/emulation-saves",
    params,
    { needsAuth: true }
  );
};

export const deleteEmulationSave = async (saveId: string): Promise<void> => {
  await HydraApi.delete(`/profile/emulation-saves/${saveId}`, {
    needsAuth: true,
  });
};

export const updateEmulationSaveLabel = async (
  saveId: string,
  label: string
): Promise<EmulationCloudSave> => {
  return HydraApi.patch<EmulationCloudSave>(
    `/profile/emulation-saves/${saveId}`,
    { label },
    { needsAuth: true }
  );
};

export const downloadEmulationSave = async (
  saveId: string
): Promise<Buffer> => {
  const url = await HydraApi.get<{ url: string }>(
    `/profile/emulation-saves/${saveId}/download`,
    undefined,
    { needsAuth: true }
  );
  const response = await fetch(url.url);
  const ab = await response.arrayBuffer();
  return Buffer.from(ab);
};

// Aliases for upload-emulation-save.ts compatibility
