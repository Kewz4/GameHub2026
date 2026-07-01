#!/usr/bin/env node
/* global globalThis */
/**
 * Playwright+Electron end-to-end test of the controller apply + per-console
 * profiles against the running app: seeds a fake installed RALibretro + PCSX2,
 * saves a global mapping (verifies both configs written), then saves a
 * per-console override for PCSX2 and confirms it diverges from global.
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

// Fake installed emulators on disk.
const raDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-"));
const pcDir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-"));
fs.writeFileSync(path.join(raDir, "RALibretro.exe"), "x");
fs.writeFileSync(
  path.join(raDir, "RALibretro.json"),
  JSON.stringify({ bindings: {} })
);
fs.writeFileSync(path.join(pcDir, "pcsx2-qt.exe"), "x");

const app = await electron.launch({
  executablePath: path.resolve("node_modules/electron/dist/electron"),
  args: [path.resolve("out/main/index.js"), "--no-sandbox"],
  cwd: process.cwd(),
  timeout: 60_000,
});
await app.firstWindow({ timeout: 40_000 });
let win = null;
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
}
if (!win) {
  console.error("FATAL: no window");
  await app.close().catch(() => {});
  process.exit(1);
}

// Seed emulator configs pointing at our fake installs.
await app.evaluate(
  async (_, { raExe, pcExe }) => {
    const s = globalThis.__levelSublevels;
    const mk = (system, binary, exe) => ({
      system,
      binary,
      executablePath: exe,
      detectedVersion: "test",
      detectedAt: Date.now(),
      romFolders: [],
      lastScanAt: null,
      totalFiles: 0,
      totalSizeBytes: 0,
    });
    await s.emulatorsSublevel.put("ps1", mk("ps1", "ralibretro", raExe));
    await s.emulatorsSublevel.put("n64", mk("n64", "ralibretro", raExe));
    await s.emulatorsSublevel.put("ps2", mk("ps2", "pcsx2", pcExe));
  },
  {
    raExe: path.join(raDir, "RALibretro.exe"),
    pcExe: path.join(pcDir, "pcsx2-qt.exe"),
  }
);

// ── A1: save GLOBAL profile → writes RALibretro + PCSX2 configs ────────────────
console.log("[A1] Global mapping applies to all installed emulators");
const profile = await win
  .evaluate(() => window.electron.getControllerProfile())
  .then((r) => r.profile);
const applyRes = await win
  .evaluate((p) => window.electron.saveControllerProfile(p), profile)
  .catch((e) => ({ __error: String(e) }));
console.log("    applied:", JSON.stringify(applyRes.applied ?? applyRes));
const raJson = JSON.parse(
  fs.readFileSync(path.join(raDir, "RALibretro.json"), "utf8")
);
if (raJson.bindings?.J0_A === "J0 b" && raJson.bindings?.J0_B === "J0 a")
  ok("RALibretro.json written with the mapping");
else
  fail(
    "RALibretro.json not written correctly",
    JSON.stringify(raJson.bindings)
  );
const pcIni = path.join(pcDir, "inis", "PCSX2.ini");
if (
  fs.existsSync(pcIni) &&
  fs.readFileSync(pcIni, "utf8").includes("Cross = SDL-0/A")
)
  ok("PCSX2.ini [Pad1] written (portable inis/ + Cross=SDL-0/A)");
else fail("PCSX2.ini not written");
if (fs.existsSync(path.join(pcDir, "portable.ini")))
  ok("PCSX2 portable.ini marker created");
else fail("portable.ini missing");

// ── A2: per-console override for PCSX2 diverges from global ────────────────────
console.log("\n[A2] Per-console override (PCSX2) is independent of global");
const custom = { ...profile, bindings: { ...profile.bindings, a: "y" } };
await win
  .evaluate((p) => window.electron.saveControllerProfile(p, "pcsx2"), custom)
  .catch(() => {});
const pcIni2 = fs.readFileSync(pcIni, "utf8");
if (pcIni2.includes("Cross = SDL-0/Y"))
  ok("PCSX2 custom override wrote Cross=SDL-0/Y (remapped)");
else
  fail(
    "PCSX2 override not applied",
    pcIni2.split("\n").find((l) => l.startsWith("Cross"))
  );
// RALibretro (global) unchanged.
const raJson2 = JSON.parse(
  fs.readFileSync(path.join(raDir, "RALibretro.json"), "utf8")
);
if (raJson2.bindings.J0_B === "J0 a")
  ok("RALibretro (global) unchanged by the PCSX2 override");
else fail("global leaked into RALibretro", raJson2.bindings.J0_B);

const isCustom = await win
  .evaluate(() => window.electron.getControllerProfile("pcsx2"))
  .then((r) => r.isCustom);
if (isCustom === true)
  ok("getControllerProfile('pcsx2') reports isCustom=true");
else fail("override not persisted as custom");

// ── A3: settings write to the core option file ────────────────────────────────
console.log("\n[A3] N64 setting writes to the mupen64plus core option file");
// Seed a core option file for the fake RALibretro install.
fs.mkdirSync(path.join(raDir, "Cores"), { recursive: true });
fs.writeFileSync(
  path.join(raDir, "Cores", "mupen64plus_next_libretro.json"),
  JSON.stringify({ core: {} })
);
const setOk = await win
  .evaluate(() =>
    window.electron.setEmulatorSettings("n64", [
      { key: "mupen64plus-rdp-plugin", value: "parallel" },
    ])
  )
  .catch(() => false);
const coreJson = JSON.parse(
  fs.readFileSync(
    path.join(raDir, "Cores", "mupen64plus_next_libretro.json"),
    "utf8"
  )
);
if (setOk && coreJson.core["mupen64plus-rdp-plugin"] === "parallel")
  ok("N64 renderer setting persisted to the core option JSON");
else fail("N64 setting not written", JSON.stringify(coreJson.core));

console.log(`\n${"─".repeat(58)}`);
console.log(`Controller apply: ${passed} passed, ${failed} failed`);
await app.close().catch(() => {});
process.exit(failed > 0 ? 1 : 0);
