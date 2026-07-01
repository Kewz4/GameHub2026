import type { ControllerProfile, EmulatorSystem } from "@types";
import { registerEvent } from "../register-event";
import { db } from "@main/level";
import {
  getSettingDefs,
  readEmulatorSettings,
  writeEmulatorSettings,
  type SettingDef,
  type SettingValue,
} from "@main/services/emulators/emulator-settings";
import {
  DEFAULT_CONTROLLER_PROFILE,
  applyControllerProfileToAll,
} from "@main/services/emulators/controller-profile";

const CONTROLLER_PROFILE_KEY = "controllerProfile";

/** Settings schema + current values for a system's emulator. */
const getEmulatorSettings = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
): Promise<{ defs: SettingDef[]; values: SettingValue[] }> => {
  return {
    defs: getSettingDefs(system),
    values: await readEmulatorSettings(system),
  };
};

const setEmulatorSettings = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  values: SettingValue[]
): Promise<boolean> => {
  return writeEmulatorSettings(system, values);
};

const getControllerProfile = async (): Promise<ControllerProfile> => {
  const stored = await db
    .get<string, ControllerProfile>(CONTROLLER_PROFILE_KEY, {
      valueEncoding: "json",
    })
    .catch(() => null);
  // Merge with defaults so a stored profile missing a newer control still works.
  return {
    ...DEFAULT_CONTROLLER_PROFILE,
    ...(stored ?? {}),
    bindings: {
      ...DEFAULT_CONTROLLER_PROFILE.bindings,
      ...(stored?.bindings ?? {}),
    },
  };
};

/** Persist the controller profile and write it into every installed emulator. */
const saveControllerProfile = async (
  _event: Electron.IpcMainInvokeEvent,
  profile: ControllerProfile
): Promise<{ applied: { binary: string; ok: boolean }[] }> => {
  await db.put(CONTROLLER_PROFILE_KEY, profile, { valueEncoding: "json" });
  const applied = await applyControllerProfileToAll(profile);
  return { applied };
};

registerEvent("getEmulatorSettings", getEmulatorSettings);
registerEvent("setEmulatorSettings", setEmulatorSettings);
registerEvent("getControllerProfile", getControllerProfile);
registerEvent("saveControllerProfile", saveControllerProfile);
