# Testing GameHub with Playwright + Electron

This document describes how to launch and test the built GameHub Electron app
headlessly in a Linux/CI environment (and in this agent sandbox). It exists so
future sessions can quickly re-run an end-to-end smoke test of the desktop app
— this is how the blank-launch regression in v4.8.x was diagnosed.

## TL;DR

```bash
# 1. Build the app bundles WITH the same env vars CI sets (see below).
export MAIN_VITE_API_URL="https://hydra-api-us-east-1.losbroxas.org"
export MAIN_VITE_AUTH_URL="https://auth.hydralauncher.gg"
export MAIN_VITE_CHECKOUT_URL="https://checkout.hydralauncher.gg"
export MAIN_VITE_WS_URL="wss://ws.hydralauncher.gg"
export RENDERER_VITE_EXTERNAL_RESOURCES_URL="https://assets.hydralauncher.gg"
export MAIN_VITE_EXTERNAL_RESOURCES_URL="https://assets.hydralauncher.gg"
npx electron-vite build

# 2. Launch under a virtual display and run a Playwright script.
xvfb-run -a node scripts/smoke-test.mjs
```

## Why each piece matters

### Playwright's Electron driver

Playwright ships an Electron launcher at `playwright._electron`. In this
environment Playwright is installed **globally**, not in the project, so import
it by absolute path and pass the **local** Electron binary explicitly
(Playwright cannot auto-discover it when it lives in the project's
`node_modules`):

```js
import { _electron as electron } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "node:path";

const app = await electron.launch({
  executablePath: path.resolve("node_modules/electron/dist/electron"),
  args: ["out/main/index.js", "--no-sandbox"],
  cwd: process.cwd(),
  timeout: 60000,
});
```

- `out/main/index.js` is the built main-process entry (from `electron-vite build`).
- `--no-sandbox` is **required** because the sandbox runs as root here; without
  it Electron aborts with
  `Running as root without --no-sandbox is not supported`.
  (Note: the app only auto-adds `--no-sandbox` on non-Linux, so on Linux you
  must pass it yourself.)

### Virtual display (xvfb)

The app creates real `BrowserWindow`s, so it needs an X display. Wrap the node
invocation in `xvfb-run -a` (auto-picks a free display number). Headless Chromium
flags are not enough — Electron windows need a display server.

### Build env vars

`src/main/constants.ts` reads `import.meta.env.MAIN_VITE_API_URL` at module load
(`MAIN_VITE_API_URL.includes("staging")`). If you build **without** that env var
set, the value is `undefined` and the main process throws
`Cannot read properties of undefined (reading 'includes')` on startup. CI
(`.github/workflows/release.yml`) always sets these — replicate them locally
(the values above are the workflow defaults). The renderer also needs
`RENDERER_VITE_EXTERNAL_RESOURCES_URL` to resolve asset URLs.

## What you can do with the launched app

```js
// Run code IN the main process (has access to the `electron` module + app):
const version = await app.evaluate(async ({ app }) => app.getVersion());

// Get the first renderer window:
const win = await app.firstWindow({ timeout: 40000 });
console.log(win.url());          // e.g. file://…/out/renderer/index.html#update-checker

// Capture renderer console + uncaught errors (this is how the blank-screen
// "No handler registered for 'getVersion'" was found):
win.on("console", (m) => console.log(`[console.${m.type()}]`, m.text()));
win.on("pageerror", (e) => console.log("[pageerror]", String(e)));

// Assert the renderer actually painted (not a blank window):
await win.waitForFunction(() => {
  const r = document.getElementById("root") || document.body;
  return r && r.innerText.trim().length > 0;
}, { timeout: 15000 });

await win.screenshot({ path: "shot.png" });
await app.close();
```

## Startup diagnostics baked into the app

`src/main/index.ts` writes a `startup.log` to the userData dir on every launch:

- Linux (unpackaged dev run): `~/GameHub/startup.log`
- Windows / packaged: `%APPDATA%\GameHub\startup.log`

It records `startup` → `db opened` → `events registered`, plus any
`UNCAUGHT` / `UNHANDLED_REJECTION` with full stack traces. If a launch is blank,
read this file first — it pinpointed the `import("./events")` SyntaxError that
caused the blank window.

## Gotchas / lessons learned

- **The renderer bootstrap depends on IPC handlers.**
  `src/renderer/src/main.tsx` does top-level `await` on `getVersion()`,
  `isStaging()` and the `userPreferences` read. If those IPC handlers are not
  registered yet (they come from `import("./events")`), the renderer module
  throws during evaluation and React never mounts → **blank window**. The main
  process therefore registers events + opens the DB **before** creating any
  window.

- **Never end a bundled string literal with the word `import` + a quote**
  (e.g. `"…for manual import"`). electron-vite's CJS-shim plugin
  (`vite:esm-shim`) scans each chunk with a regex that treats a trailing
  ` import"` as an ESM import statement and injects its
  `// -- CommonJS Shims --` banner at that byte offset — landing inside the
  adjacent string literal and corrupting the whole chunk
  (`SyntaxError: Invalid or unexpected token`). Verify every built main chunk
  parses:

  ```bash
  cd out/main && for f in *.js; do node --check "$f" || echo "BAD: $f"; done
  ```

- `app.getVersion()` returns Electron's version (e.g. `40.9.3`) when launched
  via `electron out/main/index.js` because that directory has no `package.json`.
  This is expected in the smoke test; the packaged app reports the real version.

- Graphics/dbus stderr noise (`GPU`, `Vulkan`, `EGL`, `Failed to connect to the
  bus`) is harmless in a headless sandbox — filter it out when scanning logs.

## Reference smoke-test script

A minimal end-to-end check (launch → window paints → screenshot → clean close):

```js
import { _electron as electron } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "node:path";

const app = await electron.launch({
  executablePath: path.resolve("node_modules/electron/dist/electron"),
  args: ["out/main/index.js", "--no-sandbox"],
  cwd: process.cwd(),
  timeout: 60000,
});

const win = await app.firstWindow({ timeout: 40000 });
win.on("pageerror", (e) => { console.error("RENDERER ERROR:", String(e)); process.exitCode = 1; });

await win.waitForFunction(
  () => (document.getElementById("root") || document.body).innerText.trim().length > 0,
  { timeout: 15000 }
);
console.log("OK:", JSON.stringify(
  await win.evaluate(() => (document.getElementById("root") || document.body).innerText.replace(/\s+/g, " ").slice(0, 120))
));
await win.screenshot({ path: "smoke.png" });
await app.close();
```

Run it with `xvfb-run -a node smoke-test.mjs` after building.
