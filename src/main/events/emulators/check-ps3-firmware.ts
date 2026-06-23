import { registerEvent } from "../register-event";
import { emulators } from "@main/services";

const checkPs3Firmware = async () => {
  const config = await emulators.getEmulatorConfig("ps3");
  if (!config.executablePath) return false;
  return emulators.isPs3FirmwareInstalled(config.executablePath);
};

registerEvent("checkPs3Firmware", checkPs3Firmware);
