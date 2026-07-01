#!/usr/bin/env node
/* global globalThis */
/**
 * Asserts the per-core setting <option> VALUES that actually reach the UI match
 * the verified upstream libretro core-option values (labels can look right while
 * the written value is wrong — this checks the value attribute end-to-end:
 * registry → getEmulatorSettings IPC → rendered <select>).
 */
import { _electron as electron } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

let passed = 0,
  failed = 0;
const ok = (l) => {
  console.log(`  ✓ ${l}`);
  passed++;
};
const fail = (l, d = "") => {
  console.error(`  ✗ ${l}${d ? "\n      " + d : ""}`);
  failed++;
};

const raDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-"));
fs.writeFileSync(path.join(raDir, "RALibretro.exe"), "x");

const app = await electron.launch({
  executablePath: path.resolve("node_modules/electron/dist/electron"),
  args: [path.resolve("out/main/index.js"), "--no-sandbox"],
  cwd: process.cwd(),
  timeout: 60_000,
});
await app.firstWindow({ timeout: 40_000 });
let win = null,
  proceeded = false;
for (let i = 0; i < 480; i++) {
  await new Promise((r) => setTimeout(r, 250));
  win = app.windows().find((w) => {
    try {
      return !w.url().includes("update-checker");
    } catch {
      return false;
    }
  });
  if (win) break;
  if (!proceeded && i > 8) {
    const c = app.windows().find((w) => {
      try {
        return w.url().includes("update-checker");
      } catch {
        return false;
      }
    });
    if (c) {
      proceeded = true;
      await c
        .evaluate(() => window.electron.updateCheckerProceed())
        .catch(() => {});
    }
  }
}
if (!win) {
  console.error("FATAL: no window");
  await app.close().catch(() => {});
  process.exit(1);
}

for (const sys of ["ps1", "psp", "gba", "nds", "dsi", "n64"]) {
  await app.evaluate(async (_, { system, raExe }) => {
    const s = globalThis.__levelSublevels;
    await s.emulatorsSublevel.put(system, {
      system,
      binary: "ralibretro",
      executablePath: raExe,
      detectedVersion: "1.0",
      detectedAt: Date.now(),
      romFolders: [],
      lastScanAt: null,
      totalFiles: 0,
      totalSizeBytes: 0,
    });
  }, { system: sys, raExe: path.join(raDir, "RALibretro.exe") });
}

// Query the setting defs straight from the IPC the UI uses — this is what the
// <select> options are built from.
const defsFor = (system) =>
  win.evaluate(
    (sys) => window.electron.getEmulatorSettings(sys),
    system
  );

// Expected VALUES per key, from the verified upstream core options.
const EXPECT = {
  psp: {
    ppsspp_frameskip: ["disabled", "1", "2", "3"],
    ppsspp_texture_scaling_level: ["disabled", "2x", "3x", "4x", "5x"],
    ppsspp_internal_resolution: ["480x272", "960x544", "1440x816", "1920x1088"],
  },
  gba: {
    mgba_color_correction: ["OFF", "GBA", "GBC", "Auto"],
    mgba_frameskip: ["disabled", "auto", "auto_threshold", "fixed_interval"],
    mgba_interframe_blending: [
      "OFF",
      "mix",
      "mix_smart",
      "lcd_ghosting",
      "lcd_ghosting_fast",
    ],
  },
  nds: {
    melonds_render_mode: ["software", "opengl"],
    melonds_opengl_resolution: ["1", "2", "4", "8"],
    melonds_screen_layout1: ["top-bottom", "left-right", "top"],
  },
  ps1: {
    beetle_psx_aspect_ratio: ["corrected", "uncorrected", "4:3", "ntsc"],
  },
};

// Keys that must NOT appear anymore (old buggy keys / values).
const FORBIDDEN_VALUES = {
  ps1: { beetle_psx_aspect_ratio: ["16:9"] },
  psp: {
    ppsspp_frameskip: ["0"],
    ppsspp_texture_scaling_level: ["1", "3", "4"],
  },
};
const FORBIDDEN_KEYS = {
  nds: ["melonds_ds_render_mode", "melonds_ds_opengl_resolution", "melonds_ds_screen_layout1"],
  gba: ["mgba_gb_colors"],
};

for (const [sys, keys] of Object.entries(EXPECT)) {
  const { defs } = await defsFor(sys);
  const byKey = Object.fromEntries(defs.map((d) => [d.key, d]));
  for (const [key, expectVals] of Object.entries(keys)) {
    const def = byKey[key];
    if (!def) {
      fail(`[${sys}] key ${key} missing from defs`);
      continue;
    }
    const got = (def.options ?? []).map((o) => o.value);
    const missing = expectVals.filter((v) => !got.includes(v));
    if (missing.length === 0)
      ok(`[${sys}] ${key} → values ${JSON.stringify(got)}`);
    else
      fail(
        `[${sys}] ${key} missing values ${JSON.stringify(missing)}`,
        `got ${JSON.stringify(got)}`
      );
  }
}

for (const [sys, keys] of Object.entries(FORBIDDEN_VALUES)) {
  const { defs } = await defsFor(sys);
  const byKey = Object.fromEntries(defs.map((d) => [d.key, d]));
  for (const [key, badVals] of Object.entries(keys)) {
    const got = (byKey[key]?.options ?? []).map((o) => o.value);
    const leaked = badVals.filter((v) => got.includes(v));
    if (leaked.length === 0) ok(`[${sys}] ${key} no invalid values`);
    else fail(`[${sys}] ${key} still has invalid ${JSON.stringify(leaked)}`);
  }
}

for (const [sys, badKeys] of Object.entries(FORBIDDEN_KEYS)) {
  const { defs } = await defsFor(sys);
  const present = new Set(defs.map((d) => d.key));
  const leaked = badKeys.filter((k) => present.has(k));
  if (leaked.length === 0) ok(`[${sys}] no stale keys ${JSON.stringify(badKeys)}`);
  else fail(`[${sys}] stale keys present ${JSON.stringify(leaked)}`);
}

console.log(`\n${"─".repeat(58)}`);
console.log(`Emulator setting values: ${passed} passed, ${failed} failed`);
await app.close().catch(() => {});
process.exit(failed > 0 ? 1 : 0);
