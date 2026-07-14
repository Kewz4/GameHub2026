import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { emulatorsInstallPath } from "@main/constants";
import { getEmulatorConfig } from "@main/services/emulators/emulators-repository";
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
  });
  await pipeline(response.data, createWriteStream(dest));
}

/**
 * Download prod.keys and system firmware for the Eden (Switch) emulator,
 * extracting them into the emulator's portable data directory.
 */
const downloadSwitchKeys = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<{ keys: boolean; firmware: boolean; error?: string }> => {
  try {
    const config = await getEmulatorConfig("switch").catch(() => null);
    if (config?.binary !== "eden" || !config.executablePath) {
      return {
        keys: false,
        firmware: false,
        error: "Eden is not installed. Please install Eden first.",
      };
    }

    const installDir = path.dirname(config.executablePath);
    const keysDir = path.join(installDir, "keys");
    const firmwareDir = path.join(
      installDir,
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

    // 1. Download and extract prod.keys
    try {
      const keysZip = path.join(tmpDir, "prodkeys.zip");
      logger.log("[switch-keys] Downloading prod.keys…");
      await downloadTo(PROD_KEYS_URL, keysZip);
      await SevenZip.extractFile(keysZip, keysDir);
      keysOk = true;
      logger.log("[switch-keys] prod.keys extracted to", keysDir);
    } catch (err) {
      logger.warn("[switch-keys] prod.keys download failed:", err);
    }

    // 2. Download and extract firmware
    try {
      const fwZip = path.join(tmpDir, "firmware.zip");
      logger.log("[switch-keys] Downloading firmware…");
      await downloadTo(FIRMWARE_URL, fwZip);
      await SevenZip.extractFile(fwZip, firmwareDir);
      firmwareOk = true;
      logger.log("[switch-keys] Firmware extracted to", firmwareDir);
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

registerEvent("downloadSwitchKeys", downloadSwitchKeys);
