#!/usr/bin/env node
/**
 * Pure-logic verification (no Electron) for the per-system setup step list and
 * the No-Intro region parser. Uses the project's esbuild to transpile the TS
 * sources to a temp ESM file, then imports them.
 *   node scripts/verify-emulator-logic.mjs
 */
import { build } from "../node_modules/esbuild/lib/main.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

let passed = 0;
let failed = 0;
const ok = (l) => {
  console.log(`  ✓ ${l}`);
  passed++;
};
const fail = (l, d = "") => {
  console.error(`  ✗ ${l}${d ? " — " + d : ""}`);
  failed++;
};

async function loadTs(srcRel) {
  const outFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "tsbuild-")),
    "mod.mjs"
  );
  await build({
    entryPoints: [path.resolve(srcRel)],
    outfile: outFile,
    bundle: true,
    format: "esm",
    platform: "node",
    // Type-only imports (e.g. @types) are erased; nothing to resolve at runtime.
    external: ["@types", "electron"],
    logLevel: "silent",
  });
  return import(pathToFileURL(outFile).href);
}

// ── BIOS step list ────────────────────────────────────────────────────────────
console.log("[L1] stepListForSystem — BIOS only for PS1/PS2, firmware for PS3");
const { stepListForSystem } = await loadTs(
  "src/renderer/src/pages/settings/emulation/setup/types.ts"
);
const has = (sys, step) => stepListForSystem(sys).includes(step);

if (has("ps1", "bios") && has("ps2", "bios"))
  ok("ps1 & ps2 include a BIOS step");
else fail("ps1/ps2 missing BIOS step");

if (has("ps3", "firmware") && !has("ps3", "bios"))
  ok("ps3 has firmware step, not BIOS");
else fail("ps3 step list wrong", JSON.stringify(stepListForSystem("ps3")));

const cartSystems = [
  "wiiu",
  "gb",
  "gba",
  "n64",
  "nds",
  "n3ds",
  "wii",
  "gc",
  "psp",
];
const wrong = cartSystems.filter((s) => has(s, "bios") || has(s, "firmware"));
if (wrong.length === 0)
  ok(`no BIOS/firmware step for ${cartSystems.join(", ")}`);
else fail("these wrongly show a BIOS/firmware step", wrong.join(", "));

console.log("    wiiu steps:", JSON.stringify(stepListForSystem("wiiu")));
console.log("    ps2  steps:", JSON.stringify(stepListForSystem("ps2")));

// ── Region parser ─────────────────────────────────────────────────────────────
console.log(
  "\n[L2] parseRomFilename — region extraction for matching/filtering"
);
const { parseRomFilename } = await loadTs(
  "src/main/services/emulators/parse-rom-filename.ts"
);
const cases = [
  ["Super Smash Bros. for Wii U (USA).wux", "USA"],
  ["Super Smash Bros. for Wii U - Update v208 (USA).wux", "USA"],
  ["Super Smash Bros. for Wii U - All DLC Pack (Europe).wux", "Europe"],
  ["Pokemon - Red Version (USA, Europe) (SGB Enhanced).zip", "USA"],
  ["Some Game (Japan).nds", "Japan"],
];
for (const [name, expected] of cases) {
  const got = parseRomFilename(name).region;
  if (got === expected) ok(`"${name}" → ${got}`);
  else fail(`"${name}" → ${got}, expected ${expected}`);
}

console.log(`\n${"─".repeat(55)}`);
console.log(`Logic results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
