import type { EmulatorSystem } from "@types";

export const isEmulatorBiosInstalled = async (
  _system: EmulatorSystem,
  _executablePath: string
): Promise<boolean> => true;
