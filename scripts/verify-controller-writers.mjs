#!/usr/bin/env node
/**
 * Unit-tests the controller-profile → per-emulator config writers against the
 * formats verified from each emulator's source. No Electron needed.
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
  console.error(`  ✗ ${l}${d ? "\n      " + d : ""}`);
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
    external: ["@types", "electron", "@main/level", "../logger"],
    logLevel: "silent",
  });
  return import(pathToFileURL(out).href);
}

const mod = await loadTs("src/main/services/emulators/controller-writers.ts");
const {
  DEFAULT_CONTROLLER_PROFILE: P,
  ralibretroBindings,
  pcsx2PadSection,
  rpcs3Yaml,
  dolphinGcPadSection,
} = mod;

// ── RALibretro: must match the hand-tuned config the user shipped ─────────────
console.log("[C1] RALibretro bindings (SDL tokens, RA face-label convention)");
const ra = ralibretroBindings(P);
const expectRA = {
  J0_UP: "J0 dpup",
  J0_A: "J0 b",
  J0_B: "J0 a",
  J0_X: "J0 y",
  J0_Y: "J0 x",
  J0_L: "J0 leftshoulder",
  J0_R2: "J0 righttrigger",
  J0_SELECT: "J0 back",
  J0_LSTICK_LEFT: "J0 -leftx",
  J0_RSTICK_DOWN: "J0 +righty",
};
let raOk = true;
for (const [k, v] of Object.entries(expectRA)) {
  if (ra[k] !== v) {
    fail(`RALibretro ${k} = ${ra[k]} (expected ${v})`);
    raOk = false;
  }
}
if (raOk)
  ok("RALibretro J0 bindings match the verified default (incl. A/B, X/Y swap)");

// Compare against the actual shipped zip config if present.
const zipCfg =
  "/tmp/claude-0/-home-user-hydra/54dd853f-8735-50a3-9551-a72aa80e77bd/scratchpad/ra/RALibretro.json";
if (fs.existsSync(zipCfg)) {
  const real = JSON.parse(fs.readFileSync(zipCfg, "utf8")).bindings;
  const j0 = Object.keys(ra);
  const mismatches = j0.filter((k) => real[k] !== ra[k]);
  if (mismatches.length === 0)
    ok("generated J0 bindings byte-match the user's shipped RALibretro.json");
  else
    fail(
      `${mismatches.length} bindings differ from the shipped config`,
      mismatches
        .slice(0, 3)
        .map((k) => `${k}: ${ra[k]} vs ${real[k]}`)
        .join("; ")
    );
} else {
  console.log("    (shipped zip config not present — skipping byte-match)");
}

// ── PCSX2 ─────────────────────────────────────────────────────────────────────
console.log("\n[C2] PCSX2 [Pad1] (SDL-0/ tokens, DualShock2)");
const pc = pcsx2PadSection(P);
const pcChecks = [
  "[Pad1]",
  "Type = DualShock2",
  "Cross = SDL-0/A",
  "Circle = SDL-0/B",
  "Square = SDL-0/X",
  "Triangle = SDL-0/Y",
  "L2 = SDL-0/+LeftTrigger",
  "Select = SDL-0/Back",
  "LLeft = SDL-0/-LeftX",
];
const pcMiss = pcChecks.filter((c) => !pc.includes(c));
if (pcMiss.length === 0)
  ok("PCSX2 section has correct DualShock2 SDL bindings");
else fail("PCSX2 missing lines", pcMiss.join(" | "));

// ── RPCS3 ─────────────────────────────────────────────────────────────────────
console.log("\n[C3] RPCS3 Default.yml (XInput handler)");
const rp = rpcs3Yaml(P);
const rpChecks = [
  "Player 1 Input:",
  "Handler: XInput",
  "Cross: A",
  "Circle: B",
  "Square: X",
  "Triangle: Y",
  "L1: LB",
  "R2: RT",
  "Left Stick Left: LS X-",
];
const rpMiss = rpChecks.filter((c) => !rp.includes(c));
if (rpMiss.length === 0) ok("RPCS3 YAML has correct XInput bindings");
else fail("RPCS3 missing lines", rpMiss.join(" | "));

// ── Dolphin ───────────────────────────────────────────────────────────────────
console.log("\n[C4] Dolphin GCPadNew.ini [GCPad1] (SDL named tokens)");
const dp = dolphinGcPadSection(P);
const dpChecks = [
  "[GCPad1]",
  "Device = SDL/0/Controller",
  "Buttons/A = `Button A`",
  "Buttons/B = `Button B`",
  "D-Pad/Up = `Pad N`",
  "Main Stick/Left = `Left X-`",
  "Triggers/L-Analog = `Trigger L`",
];
const dpMiss = dpChecks.filter((c) => !dp.includes(c));
if (dpMiss.length === 0) ok("Dolphin section has correct GC SDL bindings");
else fail("Dolphin missing lines", dpMiss.join(" | "));

// ── Remap propagation ─────────────────────────────────────────────────────────
console.log("\n[C5] Remapping a control propagates to every emulator");
const remapped = {
  ...P,
  bindings: { ...P.bindings, a: "y" }, // physical bottom now reads SDL 'y'
};
const ra2 = ralibretroBindings(remapped);
const pc2 = pcsx2PadSection(remapped);
if (ra2.J0_B === "J0 y" && pc2.includes("Cross = SDL-0/Y"))
  ok("remap of 'a'→y shows in RALibretro (J0_B) and PCSX2 (Cross)");
else fail("remap did not propagate", `${ra2.J0_B} / PCSX2`);

console.log(`\n${"─".repeat(56)}`);
console.log(`Controller writers: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
