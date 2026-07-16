import type {
  ControllerProfile,
  ControllerProfileStore,
  EmulatedControllerType,
  EmulatorBinary,
  EmulatorSystem,
} from "@types";
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
  reapplyAllControllerProfiles,
  applyControllerToBinary,
} from "@main/services/emulators/controller-profile";

const STORE_KEY = "controllerProfileStore";

async function loadStore(): Promise<ControllerProfileStore> {
  const stored = await db
    .get<string, ControllerProfileStore>(STORE_KEY, { valueEncoding: "json" })
    .catch(() => null);
  return {
    global: {
      ...DEFAULT_CONTROLLER_PROFILE,
      ...(stored?.global ?? {}),
      bindings: {
        ...DEFAULT_CONTROLLER_PROFILE.bindings,
        ...(stored?.global?.bindings ?? {}),
      },
    },
    byBinary: stored?.byBinary ?? {},
    types: stored?.types ?? {},
  };
}

// ── Emulator settings (core options) ──────────────────────────────────────────
const getEmulatorSettings = async (
  _e: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
): Promise<{ defs: SettingDef[]; values: SettingValue[] }> => ({
  defs: getSettingDefs(system),
  values: await readEmulatorSettings(system),
});

const setEmulatorSettings = async (
  _e: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  values: SettingValue[]
): Promise<boolean> => writeEmulatorSettings(system, values);

// ── Controller profiles (global + per-console) ────────────────────────────────

/**
 * Effective profile for one emulator. Each emulator now owns its own profile;
 * if it has none yet, seed from the legacy `global` (or the built-in default)
 * so the first visit shows a sensible standard mapping the user can tweak.
 */
const getControllerProfile = async (
  _e: Electron.IpcMainInvokeEvent,
  binary?: EmulatorBinary
): Promise<{
  profile: ControllerProfile;
  isCustom: boolean;
  type: EmulatedControllerType | null;
}> => {
  const store = await loadStore();
  const saved = binary ? store.byBinary[binary] : undefined;
  return {
    profile: saved ?? store.global,
    isCustom: Boolean(saved),
    type: (binary && store.types[binary]) || null,
  };
};

/**
 * Save a controller profile for ONE emulator and write just that emulator's
 * native config. Profiles are per-emulator — there is no "apply to all".
 */
const saveControllerProfile = async (
  _e: Electron.IpcMainInvokeEvent,
  profile: ControllerProfile,
  binary?: EmulatorBinary,
  type?: EmulatedControllerType
): Promise<{ applied: { binary: string; ok: boolean }[] }> => {
  if (!binary) return { applied: [] };
  const store = await loadStore();
  store.byBinary[binary] = profile;
  if (type) store.types[binary] = type;
  await db.put(STORE_KEY, store, { valueEncoding: "json" });
  const ok = await applyControllerToBinary(binary, profile, type);
  return { applied: [{ binary, ok }] };
};

/**
 * Re-apply every saved per-emulator profile to its native config. Called once
 * at startup so controllers configured in a past session survive restarts.
 */
export async function reapplyControllerProfilesOnStartup(): Promise<void> {
  const store = await loadStore();
  await reapplyAllControllerProfiles(store);
}

registerEvent("getEmulatorSettings", getEmulatorSettings);
registerEvent("setEmulatorSettings", setEmulatorSettings);
registerEvent("getControllerProfile", getControllerProfile);
registerEvent("saveControllerProfile", saveControllerProfile);
