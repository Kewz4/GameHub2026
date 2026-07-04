import fs from "node:fs";
import path from "node:path";

import type { EmulatorBinary } from "@types";
import { logger } from "../logger";

/**
 * TRUE portable setup for the emulators GameHub installs. Out of the box several
 * of these write their config + saves into per-user AppData/Documents, which is
 * exactly what we don't want for a self-contained, movable install. On install
 * we drop the portable-mode marker each emulator looks for and pre-create the
 * in-folder data tree so every write (config, NAND, saves, shader cache, graphic
 * packs) stays inside `userData/emulators/<binary>/`.
 *
 * Markers verified against each emulator:
 *  - PCSX2   → `portable.ini`  → data under `<install>/{inis,memcards,...}`
 *  - Dolphin → `portable.txt`  → data under `<install>/User/{Config,Wii,GC}`
 *  - Azahar  → a `user/` folder → data under `<install>/user/{config,nand,sdmc}`
 *  - Cemu    → a `portable/` folder → ALL data under `<install>/portable/...`
 *  - RPCS3 / RALibretro are portable already (config sits next to the exe).
 */

const ensureDir = (dir: string) => fs.mkdirSync(dir, { recursive: true });

const ensureFile = (file: string, contents = "") => {
  if (!fs.existsSync(file)) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, contents);
  }
};

/**
 * Cemu's portable data root. Cemu runs in portable mode when a folder named
 * `portable` sits next to the executable, and then keeps EVERYTHING (settings.xml,
 * mlc01, controllerProfiles, graphicPacks, gameProfiles, shaderCache) inside it.
 * When that folder is absent (e.g. a user's own pre-existing install that stores
 * data next to the exe) we fall back to the install dir so we read/write the same
 * files Cemu does.
 */
export const cemuDataDir = (installDir: string): string => {
  const portable = path.join(installDir, "portable");
  return fs.existsSync(portable) ? portable : installDir;
};

/** A seed Cemu settings.xml so portable mode + graphic-pack downloads are on. */
const CEMU_SEED_SETTINGS = `<?xml version="1.0" encoding="UTF-8"?>
<content>
    <mlc_path></mlc_path>
    <permanent_storage>true</permanent_storage>
    <gp_download>true</gp_download>
    <GraphicPack>
    </GraphicPack>
    <Graphic>
        <api>1</api>
        <VSync>0</VSync>
        <AsyncCompile>true</AsyncCompile>
        <vkAccurateBarriers>true</vkAccurateBarriers>
    </Graphic>
</content>
`;

/**
 * Write the portable marker + pre-create the data tree for a freshly installed
 * emulator. Best-effort and idempotent: never throws into the install flow.
 */
export const writePortableSetup = (
  binary: EmulatorBinary,
  installDir: string
): void => {
  try {
    switch (binary) {
      case "pcsx2": {
        ensureFile(path.join(installDir, "portable.ini"));
        ensureDir(path.join(installDir, "inis"));
        ensureDir(path.join(installDir, "memcards"));
        ensureDir(path.join(installDir, "sstates"));
        break;
      }

      case "dolphin": {
        // portable.txt makes Dolphin use <install>/User for all data.
        ensureFile(path.join(installDir, "portable.txt"));
        ensureDir(path.join(installDir, "User", "Config"));
        ensureDir(path.join(installDir, "User", "Wii"));
        ensureDir(path.join(installDir, "User", "GC"));
        break;
      }

      case "azahar": {
        // A `user/` folder next to the exe switches Citra/Azahar to portable,
        // rooting nand/sdmc/config under it instead of AppData.
        const user = path.join(installDir, "user");
        ensureDir(path.join(user, "config"));
        ensureDir(path.join(user, "nand"));
        ensureDir(path.join(user, "sdmc"));
        ensureDir(path.join(user, "sysdata"));
        ensureDir(path.join(user, "shaders"));
        break;
      }

      case "cemu": {
        // The `portable` folder is Cemu's portable trigger; all data lives in it.
        const data = path.join(installDir, "portable");
        ensureDir(data);
        ensureDir(path.join(data, "mlc01", "usr", "save"));
        ensureDir(path.join(data, "graphicPacks", "downloadedGraphicPacks"));
        ensureDir(path.join(data, "controllerProfiles"));
        ensureFile(path.join(data, "settings.xml"), CEMU_SEED_SETTINGS);
        break;
      }

      default:
        // rpcs3, ralibretro, duckstation: already portable next to the exe.
        break;
    }
    logger.log(`[portable] setup written for ${binary} at ${installDir}`);
  } catch (err) {
    logger.warn(`[portable] setup failed for ${binary}`, err);
  }
};
