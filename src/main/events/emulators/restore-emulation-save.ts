import { promises as fs } from "node:fs";
import path from "node:path";

import { shell } from "electron";

import { registerEvent } from "../register-event";
import { emulators, logger } from "@main/services";
import type { EmulationSavePlatform, MemcardRestoreResult } from "@types";

const writeUniqueSidecar = async (
  cardFilePath: string,
  stem: string,
  extension: "psu" | "mcs",
  saveBuffer: Buffer
) => {
  const directory = path.dirname(cardFilePath);
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const outPath = path.join(
      directory,
      `${emulators.sanitizeEmulationSaveExportStem(stem)}_restored${suffix}.${extension}`
    );
    try {
      await fs.writeFile(outPath, saveBuffer, { flag: "wx" });
      return outPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not allocate a unique restore export path");
};

const exportPs2Save = async (saveBuffer: Buffer, cardFilePath: string) => {
  // PSU: a 512-byte directory entry followed by file entries and data.
  if (saveBuffer.length < 512) throw new Error("Invalid PSU buffer");
  const nameBuffer = saveBuffer.subarray(36, 64);
  const nul = nameBuffer.indexOf(0);
  const folderName = nameBuffer
    .subarray(0, nul === -1 ? nameBuffer.length : nul)
    .toString("ascii")
    .trim();
  if (!folderName) throw new Error("Could not extract folder name from PSU");
  return writeUniqueSidecar(cardFilePath, folderName, "psu", saveBuffer);
};

const exportPs1Save = async (saveBuffer: Buffer, cardFilePath: string) => {
  // MCS: one 128-byte directory frame followed by one or more 8 KiB blocks.
  if (
    saveBuffer.length < 128 + 8_192 ||
    (saveBuffer.length - 128) % 8_192 !== 0
  ) {
    throw new Error("Invalid MCS buffer");
  }
  const identifier = saveBuffer
    .subarray(10, 30)
    .toString("ascii")
    .replace(/\0.*/, "")
    .trim();
  return writeUniqueSidecar(
    cardFilePath,
    identifier || "save",
    "mcs",
    saveBuffer
  );
};

const restoreEmulationSave = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform,
  saveId: string,
  cardFilePath: string
): Promise<MemcardRestoreResult> => {
  try {
    emulators.assertEmulationSavePlatform(platform);
    if (
      typeof cardFilePath !== "string" ||
      !path.isAbsolute(cardFilePath) ||
      !emulators.isMemoryCardPathForPlatform(platform, cardFilePath)
    ) {
      throw new Error("Memory card does not match the requested platform");
    }
    if (
      typeof saveId !== "string" ||
      !emulators.isEmulationSaveKeyForPlatform(saveId, platform)
    ) {
      throw new Error("Cloud save does not match the requested platform");
    }
    const card = await fs.stat(cardFilePath);
    if (!card.isFile()) throw new Error("Memory card file does not exist");

    const saveBuffer = await emulators.downloadEmulationSave(saveId);
    const exportedPath =
      platform === "ps2"
        ? await exportPs2Save(saveBuffer, cardFilePath)
        : await exportPs1Save(saveBuffer, cardFilePath);

    // We deliberately do not mutate a card without a format-complete writer.
    // Reveal the standards-based PSU/MCS export so the user can import it with
    // PCSX2 or DuckStation's memory-card manager.
    shell.showItemInFolder(exportedPath);
    logger.log("[restore] Exported emulation save for card-manager restore", {
      platform,
      saveId,
      exportedPath,
    });
    return { ok: true, requiresManualImport: true, exportedPath };
  } catch (error) {
    logger.error("Failed to prepare emulation save restore", {
      platform,
      saveId,
      cardFilePath,
      error,
    });
    return { ok: false, error: String(error) };
  }
};

registerEvent("restoreEmulationSave", restoreEmulationSave);
