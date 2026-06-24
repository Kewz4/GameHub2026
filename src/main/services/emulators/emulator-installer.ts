import type {
  EmulatorBinary,
  EmulatorInstallProgress,
  EmulatorInstallResult,
} from "@types";

export const installEmulator = async (
  _binary: EmulatorBinary,
  _optionId: string,
  _onProgress: (p: EmulatorInstallProgress) => void
): Promise<EmulatorInstallResult> => ({ ok: false, reason: "Not implemented" });
