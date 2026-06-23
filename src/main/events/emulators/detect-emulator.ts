import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const detectEmulator = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
) => {
  const result = await emulators.detectEmulator(system);
  if (!result) return null;
  const binary = emulators.KNOWN_BINARIES[system];
  const version = emulators.getEmulatorVersion(result.executablePath, binary);
  return emulators.updateEmulatorConfig(system, (current) => ({
    ...current,
    executablePath: result.executablePath,
    detectedVersion: version,
    detectedAt: Date.now(),
  }));
};

registerEvent("detectEmulator", detectEmulator);
