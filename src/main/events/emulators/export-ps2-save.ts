import path from "node:path";
import { promises as fs } from "node:fs";

import { registerEvent } from "../register-event";
import { emulators, logger } from "@main/services";
import type { Ps2ExportResult } from "@types";

const exportPs2Save = async (
  _event: Electron.IpcMainInvokeEvent,
  cardFilePath: string,
  folderName: string,
  destinationPath: string
): Promise<Ps2ExportResult> => {
  try {
    const contents = await emulators.readSaveContents(cardFilePath, folderName);
    if (!contents) {
      return { ok: false, error: "Could not read save from memory card" };
    }

    const psuBuffer = emulators.buildPsuBuffer(contents);
    const outPath = destinationPath.toLowerCase().endsWith(".psu")
      ? destinationPath
      : path.join(destinationPath, `${folderName}.psu`);

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, psuBuffer);

    return { ok: true, location: outPath, sizeBytes: psuBuffer.length };
  } catch (err) {
    logger.error("Failed to export PS2 save", {
      cardFilePath,
      folderName,
      err,
    });
    return { ok: false, error: String(err) };
  }
};

registerEvent("exportPs2Save", exportPs2Save);
