import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { EmulatorConfig, EmulatorSystem } from "@types";
import {
  BIG_PICTURE_EMULATOR_SYSTEM_LABELS,
  BIG_PICTURE_EMULATOR_SYSTEMS,
  getBigPictureEmulatorCardAction,
  getBigPictureEmulatorInstallSystems,
  getBigPictureEmulatorRuntimeStatus,
  supportsBigPictureMemoryCards,
} from "./emulation-parity";

const EXPECTED_SYSTEMS: EmulatorSystem[] = [
  "ps1",
  "ps2",
  "ps3",
  "psp",
  "n3ds",
  "nds",
  "dsi",
  "n64",
  "gb",
  "gbc",
  "gba",
  "wiiu",
  "wii",
  "gc",
  "switch",
];

function config(overrides: Partial<EmulatorConfig> = {}): EmulatorConfig {
  return {
    system: "switch",
    binary: "eden",
    executablePath: null,
    detectedVersion: null,
    detectedAt: null,
    romFolders: [],
    lastScanAt: null,
    totalFiles: 0,
    totalSizeBytes: 0,
    ...overrides,
  };
}

describe("Big Picture emulator parity", () => {
  it("exposes every supported emulator platform, including Switch", () => {
    assert.deepEqual([...BIG_PICTURE_EMULATOR_SYSTEMS], EXPECTED_SYSTEMS);
    assert.deepEqual(
      Object.keys(BIG_PICTURE_EMULATOR_SYSTEM_LABELS).sort(),
      [...EXPECTED_SYSTEMS].sort()
    );
  });

  it("opens every configured emulator in management instead of setup", () => {
    for (const system of EXPECTED_SYSTEMS) {
      assert.equal(
        getBigPictureEmulatorCardAction(
          config({
            system,
            executablePath: `C:\\Emulators\\${system}.exe`,
            detectedAt: 1,
          })
        ),
        "manage"
      );
    }

    assert.equal(getBigPictureEmulatorCardAction(config()), "setup");
  });

  it("limits memory-card management to the supported PS1 and PS2 paths", () => {
    assert.equal(supportsBigPictureMemoryCards("ps1"), true);
    assert.equal(supportsBigPictureMemoryCards("ps2"), true);

    for (const system of EXPECTED_SYSTEMS.filter(
      (candidate) => candidate !== "ps1" && candidate !== "ps2"
    )) {
      assert.equal(supportsBigPictureMemoryCards(system), false);
    }
  });

  it("does not report a missing configured executable as ready", () => {
    const configured = config({
      executablePath: "C:\\Emulators\\Eden.exe",
      detectedAt: 1,
    });

    assert.equal(
      getBigPictureEmulatorRuntimeStatus(configured, null),
      "checking"
    );
    assert.equal(getBigPictureEmulatorRuntimeStatus(configured, true), "ready");
    assert.equal(
      getBigPictureEmulatorRuntimeStatus(configured, false),
      "missing"
    );
    assert.equal(getBigPictureEmulatorRuntimeStatus(config(), false), "setup");
  });

  it("keeps shared emulator installs synchronized across their systems", () => {
    const configs = Object.fromEntries(
      EXPECTED_SYSTEMS.map((system) => [system, config({ system })])
    ) as Record<EmulatorSystem, EmulatorConfig>;

    for (const system of [
      "ps1",
      "psp",
      "nds",
      "dsi",
      "n64",
      "gb",
      "gbc",
      "gba",
    ] as const) {
      configs[system].binary = "ralibretro";
    }
    configs.ps2.binary = "pcsx2";
    configs.ps3.binary = "rpcs3";
    configs.n3ds.binary = "azahar";
    configs.wiiu.binary = "cemu";
    configs.wii.binary = "dolphin";
    configs.gc.binary = "dolphin";

    assert.deepEqual(getBigPictureEmulatorInstallSystems(configs, "ps1"), [
      "ps1",
      "psp",
      "nds",
      "dsi",
      "n64",
      "gb",
      "gbc",
      "gba",
    ]);
    assert.deepEqual(getBigPictureEmulatorInstallSystems(configs, "wii"), [
      "wii",
      "gc",
    ]);
    assert.deepEqual(getBigPictureEmulatorInstallSystems(configs, "switch"), [
      "switch",
    ]);
  });
});
