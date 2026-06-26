import { registerEvent } from "../register-event";
import { emulators } from "@main/services";

const checkPs3Firmware = async () => {
  const config = await emulators.getEmulatorConfig("ps3");
  if (!config.executablePath) return { installed: false };
  const installed = await emulators.isPs3FirmwareInstalled(
    config.executablePath
  );
  return { installed };
};

registerEvent("checkPs3Firmware", checkPs3Firmware);
