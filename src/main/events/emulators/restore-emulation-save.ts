import { promises as fs } from "node:fs";
import path from "node:path";

import { registerEvent } from "../register-event";
import { emulators, logger } from "@main/services";
import type { MemcardRestoreResult } from "@types";

// Restore a PS2 save (PSU buffer) into a PCSX2 memory card
const restorePs2Save = async (
  saveBuffer: Buffer,
  cardFilePath: string
): Promise<void> => {
  // PSU buffer layout:
  //   512 bytes: directory entry (contains folderName at offset 36)
  //   For each file: 512 bytes entry + padded data
  if (saveBuffer.length < 512) throw new Error("Invalid PSU buffer");

  const nameBuf = saveBuffer.subarray(36, 64);
  const nul = nameBuf.indexOf(0);
  const folderName = nameBuf
    .subarray(0, nul === -1 ? nameBuf.length : nul)
    .toString("ascii")
    .trim();

  if (!folderName) throw new Error("Could not extract folder name from PSU");

  // Read current card state and find/create the save slot
  // For now, append to the card using PCSX2's API-compatible write
  // In practice this requires full MCF write support — we write to a sidecar file
  // that the user can import manually via the emulator's save manager
  const outPath = path.join(
    path.dirname(cardFilePath),
    `${folderName}_restored.psu`
  );
  await fs.writeFile(outPath, saveBuffer);
  logger.log("[restore] Wrote PSU sidecar for manual import", { outPath });
};

// Restore a PS1 save (MCS buffer) into a DuckStation memory card
const restorePs1Save = async (
  saveBuffer: Buffer,
  cardFilePath: string
): Promise<void> => {
  // MCS: 128-byte dir frame + N×8192-byte blocks
  if (saveBuffer.length < 128) throw new Error("Invalid MCS buffer");

  const identifier = saveBuffer
    .subarray(10, 30)
    .toString("ascii")
    .replace(/\0.*/, "")
    .trim();

  const outPath = path.join(
    path.dirname(cardFilePath),
    `${identifier || "save"}_restored.mcs`
  );
  await fs.writeFile(outPath, saveBuffer);
  logger.log("[restore] Wrote MCS sidecar for manual import", { outPath });
};

const restoreEmulationSave = async (
  _event: Electron.IpcMainInvokeEvent,
  saveId: string,
  cardFilePath: string
): Promise<MemcardRestoreResult> => {
  try {
    const saveBuffer = await emulators.downloadEmulationSave(saveId);

    // Determine platform from card file extension
    const ext = path.extname(cardFilePath).toLowerCase();
    if (ext === ".ps2" || ext === ".mc2") {
      await restorePs2Save(saveBuffer, cardFilePath);
    } else if (ext === ".mcd" || ext === ".mcr") {
      await restorePs1Save(saveBuffer, cardFilePath);
    } else {
      return { ok: false, error: "Unknown memory card format" };
    }

    return { ok: true };
  } catch (err) {
    logger.error("Failed to restore emulation save", {
      saveId,
      cardFilePath,
      err,
    });
    return { ok: false, error: String(err) };
  }
};

registerEvent("restoreEmulationSave", restoreEmulationSave);
