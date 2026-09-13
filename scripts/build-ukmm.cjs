#!/usr/bin/env node
/**
 * Build the patched UKMM headless binary and drop it into ./binaries so
 * electron-builder bundles it as an app resource.
 *
 * UKMM's shipped CLI cannot install a BCML .bnp or an optioned mod without its
 * GUI (both paths bail to the GUI in the released binary). We fix that by
 * cloning UKMM at a pinned tag, applying a small in-tree patch that adds a
 * headless `install-bnp [--options <json>]` subcommand (which calls UKMM's own
 * convert_bnp + set_enabled_options + merge/RSTB rebuild + deploy), and
 * compiling it ourselves. The result is a fully headless mod pipeline — no
 * terminal, no UKMM window.
 *
 * Idempotent: if the target binary already exists (and FORCE isn't set) it's a
 * no-op, so local dev builds don't recompile Rust every time.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const UKMM_REPO = "https://github.com/NiceneNerd/ukmm.git";
const UKMM_TAG = "v0.17.1";
const UKMM_COMMIT = "77596e4c70132ef0c585061643a5e9c95121554f";

const repoRoot = path.resolve(__dirname, "..");
const patchFile = path.join(
  repoRoot,
  "native",
  "ukmm",
  "ukmm-headless-install-bnp.patch"
);
const binariesDir = path.join(repoRoot, "binaries");

const platform = process.argv[2] || process.platform;
const isWin = platform === "win32" || platform === "win";
const required = process.argv.includes("--required");
const outName = isWin ? "ukmm.exe" : "ukmm";
const outPath = path.join(binariesDir, outName);

function run(cmd, args, opts = {}) {
  console.log(`[build-ukmm] $ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

function haveCargo() {
  try {
    execFileSync("cargo", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function main() {
  if (fs.existsSync(outPath) && !process.env.FORCE_BUILD_UKMM) {
    if (!isWin) fs.chmodSync(outPath, 0o755);
    console.log(`[build-ukmm] ${outPath} already exists — skipping.`);
    return;
  }
  if (!haveCargo()) {
    if (required)
      throw new Error("Rust is required to build the Linux BOTW mod helper.");
    // Don't hard-fail local `yarn build` on machines without Rust; the mod
    // feature simply won't have its binary. CI has the Rust toolchain.
    console.warn(
      "[build-ukmm] cargo not found — skipping UKMM build. " +
        "BOTW mod install will be unavailable in this build."
    );
    return;
  }
  if (!fs.existsSync(patchFile)) {
    throw new Error(`[build-ukmm] patch not found: ${patchFile}`);
  }

  fs.mkdirSync(binariesDir, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ukmm-build-"));
  const srcDir = path.join(workDir, "ukmm");

  try {
    // Shallow clone the pinned tag, then hard-pin to the exact commit.
    run("git", [
      "clone",
      "--depth",
      "1",
      "--branch",
      UKMM_TAG,
      UKMM_REPO,
      srcDir,
    ]);
    run("git", ["-C", srcDir, "fetch", "--depth", "1", "origin", UKMM_COMMIT]);
    run("git", ["-C", srcDir, "checkout", UKMM_COMMIT]);

    // Apply our headless patch.
    run("git", ["-C", srcDir, "apply", "--3way", patchFile]);

    // Compile the single `ukmm` binary in release mode.
    run("cargo", ["build", "--release", "--bin", "ukmm"], { cwd: srcDir });

    const built = path.join(srcDir, "target", "release", outName);
    if (!fs.existsSync(built)) {
      throw new Error(`[build-ukmm] expected binary missing: ${built}`);
    }
    fs.copyFileSync(built, outPath);
    if (!isWin) fs.chmodSync(outPath, 0o755);
    console.log(`[build-ukmm] wrote ${outPath}`);
  } catch (err) {
    if (required) throw err;
    // NON-FATAL: a UKMM build failure must not sink the whole app release. The
    // binary is bundled via a tolerant glob, so packaging still succeeds; the
    // app simply reports BOTW mod support as unavailable until the next build.
    console.error(
      `[build-ukmm] FAILED to build UKMM helper — BOTW mod install will be ` +
        `unavailable in this build. Error:\n${err && err.message ? err.message : err}`
    );
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

main();
