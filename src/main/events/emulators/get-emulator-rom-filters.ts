import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import { platformToSystem } from "@main/helpers";
import type { EmulatorSystem } from "@types";

/**
 * ROM file-dialog config for a console/emulated game: the launchable file
 * extensions for the system, plus whether the system is folder-based (Cemu
 * extracts Wii U titles into a `code/content/meta` FOLDER, not a single file,
 * so the picker must allow selecting a directory).
 *
 * Accepts either an EmulatorSystem key (e.g. "wiiu") or a platform label (e.g.
 * "Nintendo Wii U") — Big Picture passes the game's raw platform string.
 */
const getEmulatorRomFilters = async (
  _event: Electron.IpcMainInvokeEvent,
  systemOrPlatform: string
): Promise<{ extensions: string[]; folderBased: boolean }> => {
  const system = (
    emulators.KNOWN_BINARIES[systemOrPlatform as EmulatorSystem]
      ? systemOrPlatform
      : platformToSystem(systemOrPlatform)
  ) as EmulatorSystem | null;
  const binary = system ? emulators.KNOWN_BINARIES[system] : undefined;
  if (!binary) return { extensions: [], folderBased: false };
  return {
    // Strip the leading dot — Electron dialog filters want bare extensions.
    extensions: (binary.romExtensions ?? []).map((ext) =>
      ext.replace(/^\./, "")
    ),
    folderBased: (binary.romDirectoryMarkers ?? []).length > 0,
  };
};

registerEvent("getEmulatorRomFilters", getEmulatorRomFilters);
