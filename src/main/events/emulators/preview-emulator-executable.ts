import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";
import path from "node:path";

const previewEmulatorExecutable = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  executablePath: string
) => {
  const normalizedPath = path.normalize(executablePath);
  if (!emulators.isValidEmulatorExecutable(normalizedPath)) return null;
  const binary = emulators.KNOWN_BINARIES[system];
  const version = emulators.getEmulatorVersion(normalizedPath, binary);
  return { executablePath: normalizedPath, detectedVersion: version };
};

registerEvent("previewEmulatorExecutable", previewEmulatorExecutable);
