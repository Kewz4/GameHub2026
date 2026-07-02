#!/usr/bin/env node
/* global globalThis */
/**
 * Reproduces and verifies the fix for the exact bug the user hit in production:
 * a LevelDB config saved by an OLD app version (before N64/PSP/PS1/GBA moved
 * onto the shared RALibretro binary) still has `binary: "raproject64"` /
 * `"ravba"` / etc. for those systems. Without migration:
 *   - the UI shows the stale emulator name ("RAProject64") under N64;
 *   - clicking "Start setup" calls installEmulator("raproject64", ...);
 *   - primarySystemForBinary("raproject64") used to silently fall back to
 *     "ps1", so it grabbed PS1's (now RALibretro's) download URL — the zip
 *     downloaded fine — but executableNamesFor("raproject64") then crashed
 *     (`systemsForBinary("raproject64")[0]` is undefined → TypeError reading
 *     "windowsNames" of undefined), logged as an unhelpful `{}`.
 *
 *  M1  A stale n64 config (binary "raproject64") is migrated on read: binary
 *      becomes "ralibretro", executablePath/version reset (they belonged to a
 *      program that no longer exists in the registry), romFolders preserved.
 *  M2  Same for gba (stale "ravba" → "ralibretro").
 *  M3  getEmulatorInstallOptions for the now-orphaned "raproject64" binary
 *      returns an empty list (no crash, no silent cross-resolution to another
 *      binary's download).
 */
import { _electron as electron } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "node:path";

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

// Seed pre-consolidation configs exactly as an old app version would have
// written them: real executablePath from a real RAProject64/RAVBA install,
// plus ROM folders that must survive the migration.
await app.evaluate(async () => {
  const s = globalThis.__levelSublevels;
  await s.emulatorsSublevel.put("n64", {
    system: "n64",
    binary: "raproject64",
    executablePath: "C:\\Games\\RAProject64\\Project64.exe",
    detectedVersion: "2.3.2",
    detectedAt: Date.now() - 86_400_000,
    romFolders: [
      {
        id: "f1",
        path: "C:\\Games\\N64 Games",
        scanSubfolders: true,
        fileCount: 12,
        sizeBytes: 500_000_000,
        lastScanAt: Date.now() - 3_600_000,
      },
    ],
    lastScanAt: Date.now() - 3_600_000,
    totalFiles: 12,
    totalSizeBytes: 500_000_000,
  });
  await s.emulatorsSublevel.put("gba", {
    system: "gba",
    binary: "ravba",
    executablePath: "C:\\Games\\RAVBA\\RAVBA.exe",
    detectedVersion: "1.0",
    detectedAt: Date.now() - 86_400_000,
    romFolders: [],
    lastScanAt: null,
    totalFiles: 0,
    totalSizeBytes: 0,
  });
});

// ── M1/M2: reading the configs migrates the stale binary ────────────────────
console.log("[M1/M2] Stale binary fields migrate to the current registry");
const configs = await win.evaluate(() => window.electron.getEmulatorConfigs());

const n64 = configs.n64;
if (n64.binary === "ralibretro")
  ok(`n64 binary migrated: raproject64 → ${n64.binary}`);
else fail(`n64 binary NOT migrated`, `still "${n64.binary}"`);

if (n64.executablePath === null)
  ok(
    "n64 stale executablePath cleared (RAProject64's exe doesn't apply to RALibretro)"
  );
else fail("n64 executablePath not cleared", n64.executablePath);

if (n64.romFolders.length === 1 && n64.romFolders[0].fileCount === 12)
  ok("n64 ROM folders preserved across the migration");
else fail("n64 ROM folders lost", JSON.stringify(n64.romFolders));

const gba = configs.gba;
if (gba.binary === "ralibretro")
  ok(`gba binary migrated: ravba → ${gba.binary}`);
else fail(`gba binary NOT migrated`, `still "${gba.binary}"`);

// ── M3: an orphaned binary no longer crashes or cross-resolves ─────────────
console.log(
  "\n[M3] getEmulatorInstallOptions('raproject64') fails clean, not crash"
);
const orphanOptions = await win
  .evaluate(() => window.electron.getEmulatorInstallOptions("raproject64"))
  .catch((e) => ({ __threw: String(e) }));
if (Array.isArray(orphanOptions) && orphanOptions.length === 0)
  ok("orphaned binary returns [] instead of crashing or borrowing ps1's URL");
else
  fail(
    "orphaned binary did not return an empty array",
    JSON.stringify(orphanOptions).slice(0, 200)
  );

console.log(`\n${"─".repeat(58)}`);
console.log(`Stale-binary migration: ${passed} passed, ${failed} failed`);
await app.close().catch(() => {});
process.exit(failed > 0 ? 1 : 0);
