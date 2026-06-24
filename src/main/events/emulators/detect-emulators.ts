import { registerEvent } from "../register-event";
import { emulators } from "@main/services";

const detectEmulators = async () => {
  const systems = ["ps1", "ps2", "ps3"] as const;
  await Promise.all(
    systems.map(async (system) => {
      const result = await emulators.detectEmulator(emulators.KNOWN_BINARIES[system]);
      if (!result) return;
      const binary = emulators.KNOWN_BINARIES[system];
      const version = emulators.getEmulatorVersion(
        result.executablePath,
        binary
      );
      await emulators.updateEmulatorConfig(system, (current) => ({
        ...current,
        executablePath: result.executablePath,
        detectedVersion: version,
        detectedAt: Date.now(),
      }));
    })
  );
  return emulators.getAllEmulatorConfigs();
};

registerEvent("detectEmulators", detectEmulators);
