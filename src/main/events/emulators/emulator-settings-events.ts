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
  applyControllerStoreToAll,
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

/** Effective profile for a scope: the per-binary override, else global. */
const getControllerProfile = async (
  _e: Electron.IpcMainInvokeEvent,
  binary?: EmulatorBinary
): Promise<{
  profile: ControllerProfile;
  isCustom: boolean;
  type: EmulatedControllerType | null;
}> => {
  const store = await loadStore();
  const override = binary ? store.byBinary[binary] : undefined;
  return {
    profile: override ?? store.global,
    isCustom: Boolean(override),
    type: (binary && store.types[binary]) || null,
  };
};

/**
 * Save a profile. With no `binary`, updates the global profile and re-applies to
 * every installed emulator (that uses global). With a `binary`, saves a
 * per-console override and writes just that emulator's config.
 */
const saveControllerProfile = async (
  _e: Electron.IpcMainInvokeEvent,
  profile: ControllerProfile,
  binary?: EmulatorBinary,
  type?: EmulatedControllerType
): Promise<{ applied: { binary: string; ok: boolean }[] }> => {
  const store = await loadStore();

  if (binary) {
    store.byBinary[binary] = profile;
    if (type) store.types[binary] = type;
    await db.put(STORE_KEY, store, { valueEncoding: "json" });
    const ok = await applyControllerToBinary(binary, profile, type);
    return { applied: [{ binary, ok }] };
  }

  store.global = profile;
  await db.put(STORE_KEY, store, { valueEncoding: "json" });
  const applied = await applyControllerStoreToAll(store);
  return { applied };
};

/** Clear a per-console override so the emulator uses the global profile again. */
const useGlobalController = async (
  _e: Electron.IpcMainInvokeEvent,
  binary: EmulatorBinary
): Promise<boolean> => {
  const store = await loadStore();
  delete store.byBinary[binary];
  await db.put(STORE_KEY, store, { valueEncoding: "json" });
  return applyControllerToBinary(binary, store.global, store.types[binary]);
};

registerEvent("getEmulatorSettings", getEmulatorSettings);
registerEvent("setEmulatorSettings", setEmulatorSettings);
registerEvent("getControllerProfile", getControllerProfile);
registerEvent("saveControllerProfile", saveControllerProfile);
registerEvent("useGlobalController", useGlobalController);
