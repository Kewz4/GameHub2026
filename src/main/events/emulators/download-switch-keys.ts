import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { emulatorsInstallPath } from "@main/constants";
import { getEmulatorConfig } from "@main/services/emulators/emulators-repository";
import { edenDataDir } from "@main/services/emulators/emulator-portable";
import { logger } from "@main/services/logger";
import { SevenZip } from "@main/services/7zip";
import { registerEvent } from "../register-event";

const PROD_KEYS_URL = "https://files.prodkeys.net/ProdKeys.NET-v22.5.0.zip";
const FIRMWARE_URL =
  "https://github.com/THZoria/NX_Firmware/releases/download/22.5.0/Firmware.22.5.0.zip";

async function downloadTo(url: string, dest: string): Promise<void> {
  const response = await axios.get<NodeJS.ReadableStream>(url, {
    responseType: "stream",
    timeout: 0,
    maxRedirects: 5,
    // Some CDNs (prodkeys.net / GitHub) 403 a UA-less streaming request.
    headers: { "User-Agent": "GameHub/1.0 (+https://github.com/Kewz4/hydra)" },
  });
  await pipeline(response.data, createWriteStream(dest));
}

/** Recursively find the first file whose basename matches `name` under `dir`. */
function findFile(dir: string, name: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return null;
}

/** Collect every file with one of the given extensions, recursively. */
function findByExt(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findByExt(full, exts));
    else if (exts.some((e) => entry.name.toLowerCase().endsWith(e)))
      out.push(full);
  }
  return out;
}

/**
 * Download prod.keys and system firmware for the Eden (Switch) emulator,
 * extracting them into the emulator's portable data directory.
 */
export const downloadSwitchKeysImpl = async (
  explicitExePath?: string
): Promise<{ keys: boolean; firmware: boolean; error?: string }> => {
  try {
    let executablePath = explicitExePath;

    if (!executablePath) {
      const config = await getEmulatorConfig("switch");
      if (config?.binary !== "eden" || !config.executablePath) {
        return {
          keys: false,
          firmware: false,
          error: "Eden is not installed. Please install Eden first.",
        };
      }
      executablePath = config.executablePath;
    }

    // Eden roots all data under <install>/user/ (portable mode). Keys go in
    // user/keys/prod.keys; firmware NCAs in the SYSTEM registered cache.
    const dataDir = edenDataDir(path.dirname(executablePath));
    const keysDir = path.join(dataDir, "keys");
    const firmwareDir = path.join(
      dataDir,
      "nand",
      "system",
      "Contents",
      "registered"
    );
    fs.mkdirSync(keysDir, { recursive: true });
    fs.mkdirSync(firmwareDir, { recursive: true });

    const tmpDir = path.join(emulatorsInstallPath, "_switch_tmp");
    fs.mkdirSync(tmpDir, { recursive: true });

    let keysOk = false;
    let firmwareOk = false;

    // 1. Download prod.keys. The archive may nest the file in a subfolder, and
    //    Eden reads exactly keys/prod.keys — so extract to a temp and MOVE the
    //    real prod.keys/title.keys to the flat expected paths.
    try {
      const keysZip = path.join(tmpDir, "prodkeys.zip");
      const keysExtract = path.join(tmpDir, "keys_x");
      fs.mkdirSync(keysExtract, { recursive: true });
      logger.log("[switch-keys] Downloading prod.keys…");
      await downloadTo(PROD_KEYS_URL, keysZip);
      await SevenZip.extractFile({
        filePath: keysZip,
        outputPath: keysExtract,
      });
      for (const name of ["prod.keys", "title.keys"]) {
        const found = findFile(keysExtract, name);
        if (found) fs.copyFileSync(found, path.join(keysDir, name));
      }
      if (!fs.existsSync(path.join(keysDir, "prod.keys"))) {
        throw new Error("prod.keys not found in downloaded archive");
      }
      keysOk = true;
      logger.log("[switch-keys] prod.keys installed to", keysDir);
    } catch (err) {
      logger.warn("[switch-keys] prod.keys download failed:", err);
    }

    // 2. Download firmware. Flatten every .nca into the registered cache (the
    //    archive wraps them in a versioned folder).
    try {
      const fwZip = path.join(tmpDir, "firmware.zip");
      const fwExtract = path.join(tmpDir, "fw_x");
      fs.mkdirSync(fwExtract, { recursive: true });
      logger.log("[switch-keys] Downloading firmware…");
      await downloadTo(FIRMWARE_URL, fwZip);
      await SevenZip.extractFile({ filePath: fwZip, outputPath: fwExtract });
      const ncas = findByExt(fwExtract, [".nca"]);
      if (ncas.length === 0) throw new Error("no firmware NCAs in archive");
      for (const nca of ncas) {
        fs.copyFileSync(nca, path.join(firmwareDir, path.basename(nca)));
      }
      firmwareOk = true;
      logger.log(
        `[switch-keys] Firmware installed (${ncas.length} NCAs) to`,
        firmwareDir
      );
    } catch (err) {
      logger.warn("[switch-keys] Firmware download failed:", err);
    }

    // Cleanup temp
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }

    return { keys: keysOk, firmware: firmwareOk };
  } catch (err) {
    logger.error("[switch-keys] Setup failed:", err);
    return {
      keys: false,
      firmware: false,
      error: (err as Error).message,
    };
  }
};

const downloadSwitchKeys = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<{ keys: boolean; firmware: boolean; error?: string }> => {
  return downloadSwitchKeysImpl();
};

registerEvent("downloadSwitchKeys", downloadSwitchKeys);
