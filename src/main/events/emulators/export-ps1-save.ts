import path from "node:path";
import { promises as fs } from "node:fs";

import { registerEvent } from "../register-event";
import { emulators, logger } from "@main/services";
import type { Ps2ExportResult } from "@types";

const exportPs1Save = async (
  _event: Electron.IpcMainInvokeEvent,
  cardFilePath: string,
  identifier: string,
  destinationPath: string
): Promise<Ps2ExportResult> => {
  try {
    const contents = await emulators.readPs1SaveContents(
      cardFilePath,
      identifier
    );
    if (!contents) {
      return { ok: false, error: "Could not read save from memory card" };
    }

    const mcsBuffer = emulators.buildMcsBuffer(contents);
    const outPath = destinationPath.toLowerCase().endsWith(".mcs")
      ? destinationPath
      : path.join(destinationPath, `${identifier}.mcs`);

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, mcsBuffer);

    return { ok: true, location: outPath, sizeBytes: mcsBuffer.length };
  } catch (err) {
    logger.error("Failed to export PS1 save", {
      cardFilePath,
      identifier,
      err,
    });
    return { ok: false, error: String(err) };
  }
};

registerEvent("exportPs1Save", exportPs1Save);
