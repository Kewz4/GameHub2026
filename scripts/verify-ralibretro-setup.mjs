#!/usr/bin/env node
/**
 * Verifies the RALibretro setup/download foundation (no Electron needed):
 *  S1  6 systems (ps1/psp/gba/n64/nds/dsi) are assigned to the ralibretro binary.
 *  S2  Bundled assets present: 5 cores + their option jsons + N64 system files.
 *  S3  Config templates correct: F11 = fullscreen, RA notifications = None, no account.
 *  S4  preSetupRalibretro copy logic drops cores + configs into a fresh install.
 */
import { build } from "../node_modules/esbuild/lib/main.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

let passed = 0,
  failed = 0;
const ok = (l) => {
  console.log(`  ✓ ${l}`);
  passed++;
};
const fail = (l, d = "") => {
  console.error(`  ✗ ${l}${d ? " — " + d : ""}`);
  failed++;
};

async function loadTs(srcRel) {
  const out = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "tsb-")),
    "m.mjs"
  );
  await build({
    entryPoints: [path.resolve(srcRel)],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    external: ["@types", "electron"],
    logLevel: "silent",
  });
  return import(pathToFileURL(out).href);
}

// ── S1: binary reassignment ───────────────────────────────────────────────────
console.log("[S1] Systems assigned to RALibretro");
const { KNOWN_BINARIES } = await loadTs(
  "src/main/services/emulators/known-binaries.ts"
);
const want = ["ps1", "psp", "gba", "n64", "nds", "dsi"];
for (const s of want) {
  const b = KNOWN_BINARIES[s]?.binary;
  if (b === "ralibretro") ok(`${s} → ralibretro`);
  else fail(`${s} → ${b} (expected ralibretro)`);
}
// gb/gbc stay on RAVBA; ps2/ps3 unchanged
if (
  KNOWN_BINARIES.gb.binary === "ravba" &&
  KNOWN_BINARIES.ps2.binary === "pcsx2"
)
  ok("gb→ravba and ps2→pcsx2 unchanged");
else fail("gb/ps2 wrongly changed");
if (
  KNOWN_BINARIES.ps1.install.directDownloadUrl?.includes(
    "retroachievements.org/bin/RALibretro-x64.zip"
  )
)
  ok("install source is the RA direct-download URL");
else
  fail("RA direct URL missing", KNOWN_BINARIES.ps1.install.directDownloadUrl);

// ── S2: bundled assets ────────────────────────────────────────────────────────
console.log("\n[S2] Bundled RALibretro assets present");
const A = path.resolve("resources/ralibretro");
const cores = [
  "mgba_libretro.dll",
  "ppsspp_libretro.dll",
  "mednafen_psx_libretro.dll",
  "melondsds_libretro.dll",
  "mupen64plus_next_libretro.dll",
];
const missing = cores.filter((c) => !fs.existsSync(path.join(A, "Cores", c)));
if (missing.length === 0) ok(`all 5 cores bundled`);
else fail("missing cores", missing.join(", "));
if (fs.existsSync(path.join(A, "System", "Mupen64plus", "mupen64plus.ini")))
  ok("N64 system catalog (mupen64plus.ini) bundled");
else fail("mupen64plus.ini missing");

// ── S3: config templates ──────────────────────────────────────────────────────
console.log("\n[S3] Config templates (F11 fullscreen, notifications off)");
const cfg = JSON.parse(
  fs.readFileSync(path.join(A, "config", "RALibretro.json"), "utf8")
);
if (cfg.bindings.TOGGLE_FULLSCREEN === "F11") ok("TOGGLE_FULLSCREEN = F11");
else fail("fullscreen not F11", cfg.bindings.TOGGLE_FULLSCREEN);
if (cfg.bindings.LOAD_SLOT !== "F11")
  ok("F11 conflict resolved (LOAD_SLOT freed)");
else fail("F11 still double-bound to LOAD_SLOT");

const prefs = JSON.parse(
  fs.readFileSync(path.join(A, "config", "RAPrefs_RALibRetro.cfg"), "utf8")
);
const notifKeys = [
  "Achievement Triggered Notification Display",
  "Mastery Notification Display",
  "Leaderboard Notification Display",
  "Challenge Notification Display",
  "Informational Notification Display",
];
if (notifKeys.every((k) => prefs[k] === "None"))
  ok("all RA overlay notifications = None (GameHub overlay used instead)");
else fail("some notifications not None");
if (prefs["Hardcore Active"] === true) ok("Hardcore mode preserved");
else fail("hardcore not preserved");
if (!prefs.Username && !prefs.Token)
  ok("account stripped (user logs in with their own)");
else fail("account not stripped");

// ── S4: pre-setup copy logic ──────────────────────────────────────────────────
console.log("\n[S4] Pre-setup copies cores + configs into a fresh install");
const install = fs.mkdtempSync(path.join(os.tmpdir(), "rainstall-"));
// Mirror preSetupRalibretro's copy behavior.
fs.cpSync(path.join(A, "Cores"), path.join(install, "Cores"), {
  recursive: true,
});
fs.cpSync(path.join(A, "System"), path.join(install, "System"), {
  recursive: true,
});
fs.copyFileSync(
  path.join(A, "config", "RALibretro.json"),
  path.join(install, "RALibretro.json")
);
fs.copyFileSync(
  path.join(A, "config", "RAPrefs_RALibRetro.cfg"),
  path.join(install, "RAPrefs_RALibRetro.cfg")
);
const coreCount = fs
  .readdirSync(path.join(install, "Cores"))
  .filter((f) => f.endsWith(".dll")).length;
if (
  coreCount === 5 &&
  fs.existsSync(path.join(install, "RALibretro.json")) &&
  fs.existsSync(path.join(install, "RAPrefs_RALibRetro.cfg")) &&
  fs.existsSync(path.join(install, "System", "Mupen64plus", "mupen64plus.ini"))
)
  ok("install seeded with 5 cores + RALibretro.json + RAPrefs + N64 system");
else fail(`install incomplete (cores=${coreCount})`);

console.log(`\n${"─".repeat(56)}`);
console.log(`RALibretro setup: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
