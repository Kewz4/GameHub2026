/* global globalThis */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { ClassicLevel } from "classic-level";
import { extractFile } from "@electron/asar";

const root = path.resolve(import.meta.dirname, "..");
const source = process.env.GAMEHUB_LIVE_DATA;
const playwright = process.env.PLAYWRIGHT_PACKAGE;
const mode = process.env.GAMEHUB_MAINTENANCE_MODE ?? "inspect";
if (!source || !playwright)
  throw new Error("Set GAMEHUB_LIVE_DATA and PLAYWRIGHT_PACKAGE.");
const { _electron: electron } = await import(
  pathToFileURL(path.join(playwright, "index.mjs")).href
);
const runRoot = path.join(
  root,
  "artifacts",
  "maintenance-202609",
  `${Date.now()}-${mode}`
);
fs.mkdirSync(runRoot, { recursive: true });
const clone = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-maintenance-"));
const data = path.join(clone, "data");
fs.mkdirSync(data);
const report = {
  mode,
  profile: "live-populated-clone",
  checks: [],
  errors: [],
  screenshots: [],
};
let app;
let launchedGame = null;
let desktopPage = null;
const saveBackups = [];
const record = (name, result) => {
  report.checks.push({ name, result });
  console.log(`${name}: ${JSON.stringify(result)}`);
};
const safeMessage = (error) =>
  String(error?.message ?? error)
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(
      /([?&](?:token|code|key|secret|access_token)=)[^&\s]+/gi,
      "$1[redacted]"
    );
const capture = async (page, name) => {
  const file = path.join(runRoot, `${name}.png`);
  await page.screenshot({ path: file });
  report.screenshots.push(file);
};

try {
  for (const dir of ["gamehub-db", "r2-image-cache", "Assets", "ludusavi"]) {
    if (fs.existsSync(path.join(source, dir)))
      fs.cpSync(path.join(source, dir), path.join(data, dir), {
        recursive: true,
      });
  }
  fs.writeFileSync(path.join(clone, ".gamehub-setup"), "");
  const db = new ClassicLevel(path.join(data, "gamehub-db"), {
    valueEncoding: "json",
  });
  await db.open();
  const preferences = await db.get("userPreferences").catch(() => ({}));
  await db.put("userPreferences", {
    ...preferences,
    launchInBigPicture: false,
    onboardingComplete: true,
    gameRecorderEnabled: false,
    preferQuitInsteadOfHiding: false,
    overlayEnabled: true,
    overlayPerformanceEnabled: false,
  });
  await db.close();

  const installed = extractFile(
    path.join(path.dirname(source), "resources", "app.asar"),
    "out\\main\\index.js"
  ).toString("utf8");
  const nearbyUrls = (marker, radius) => {
    const i = installed.indexOf(marker);
    if (i < 0) return [];
    return [
      ...installed
        .slice(Math.max(0, i - radius), i + 1000)
        .matchAll(/https:\/\/[^\s"'`\\)]+/g),
    ].map((m) => m[0]);
  };
  const broker =
    process.env.GAMEHUB_R2_CREDENTIALS_URL ??
    nearbyUrls("r2_credentials_broker_not_configured", 12000).find((u) =>
      new URL(u).hostname.endsWith(".workers.dev")
    );
  const api =
    process.env.GAMEHUB_API_URL ??
    nearbyUrls("/auth/refresh", 4000).find(
      (u) => !/workers\.dev|cloudflarestorage\.com/.test(new URL(u).hostname)
    );
  if (!broker || !api)
    throw new Error("Installed service configuration could not be resolved.");

  const started = Date.now();
  app = await electron.launch({
    executablePath: path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [
      path.join(root, "out/main/index.js"),
      "--no-sandbox",
      ...(mode === "cold-big-picture" ? ["hydralauncher://bigpicture"] : []),
    ],
    cwd: root,
    timeout: 60000,
    env: {
      ...process.env,
      APPDATA: clone,
      LOCALAPPDATA: clone,
      PORTABLE_EXECUTABLE_DIR: clone,
      GAMEHUB_READ_ONLY_VISUAL_QA: "true",
      GAMEHUB_R2_CREDENTIALS_URL: broker,
      GAMEHUB_API_URL: api,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  });
  let page;
  for (let attempt = 0; attempt < 120; attempt++) {
    for (const candidate of app.windows()) {
      const url = candidate.url();
      if (url.includes("update-checker"))
        await candidate
          .evaluate(() => window.electron.updateCheckerProceed())
          .catch(() => {});
      if (/index\.html#\/?$/.test(url) || /index\.html#\/?library$/.test(url))
        page = candidate;
    }
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!page)
    throw new Error("The populated desktop window did not initialize.");
  desktopPage = page;
  await page.waitForSelector(".sidebar", { timeout: 60000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  record("desktop-ready-ms", Date.now() - started);
  page.on("pageerror", (error) => report.errors.push(safeMessage(error)));

  const games = await app.evaluate(async () => {
    const { gamesSublevel } = globalThis.__gameHubRecorderQaControl;
    return (await gamesSublevel.values().all()).map((game) => ({
      title: game.title,
      shop: game.shop,
      objectId: game.objectId,
      executablePath: game.executablePath,
      nativeExecutablePath: game.nativeExecutablePath,
    }));
  });
  record("populated-library", { count: games.length });
  const hades =
    games.find(
      (game) => game.shop === "steam" && game.objectId === "1145350"
    ) ?? games.find((game) => /^hades (ii|2)$/i.test(game.title));
  if (hades) record("hades-library-entry", hades);

  if (mode === "inspect" || mode === "spotify") {
    const status = await page.evaluate(() =>
      window.electron.spotifyGetStatus()
    );
    record("spotify-authorization", {
      configured: status.configured,
      connected: status.connected,
      needsReauth: status.needsReauth,
      secureStorage: status.secureStorage,
      error: status.lastError?.code ?? null,
    });
    if (status.connected) {
      const playback = await page.evaluate(() =>
        window.electron.spotifyGetPlayback()
      );
      const devices = await page.evaluate(() =>
        window.electron.spotifyGetDevices()
      );
      record(
        "spotify-live-playback",
        playback.ok
          ? {
              ok: true,
              playing: playback.data?.isPlaying ?? false,
              track: playback.data?.item?.title ?? null,
            }
          : playback
      );
      record(
        "spotify-live-devices",
        devices.ok ? { ok: true, count: devices.data.length } : devices
      );
    }
    if (hades) {
      const overview = await page
        .evaluate(
          (game) =>
            window.electron.getCloudSaveOverview(game.objectId, game.shop),
          hades
        )
        .catch((error) => ({ error: safeMessage(error) }));
      record("hades-cloud-overview", overview);
    }
    await capture(page, "desktop-live");
  }

  if (mode === "big-picture" || mode === "cold-big-picture") {
    await app.evaluate(({ app }) =>
      app.emit("second-instance", {}, [
        "GameHub.exe",
        "hydralauncher://bigpicture",
      ])
    );
    const bp = await (async () => {
      for (let i = 0; i < 100; i++) {
        const found = app
          .windows()
          .find((window) => /#\/?big-picture/.test(window.url()));
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Big Picture deep link did not open a window.");
    })();
    bp.on("pageerror", (error) => report.errors.push(safeMessage(error)));
    await bp.waitForSelector(".home-page", { timeout: 60000 });
    await bp.setViewportSize({ width: 1920, height: 1080 });
    await app.evaluate(({ app }) => {
      for (let i = 0; i < 3; i++)
        app.emit("second-instance", {}, [
          "GameHub.exe",
          "hydralauncher://bigpicture",
        ]);
    });
    const windows = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => /index\.html/.test(w.webContents.getURL()))
        .map((w) => ({
          url: w.webContents.getURL().split("#")[1],
          visible: w.isVisible(),
        }))
    );
    record("deeplink-window-ownership", windows);
    if (windows.filter((w) => /^\/?big-picture/.test(w.url ?? "")).length !== 1)
      throw new Error("Duplicate Big Picture windows.");
    await capture(bp, "big-picture-live");
    await bp.evaluate(() => {
      location.hash = "/big-picture/settings";
    });
    await bp.waitForSelector(".settings-page", { timeout: 30000 });
    record(
      "settings-layout",
      await bp.evaluate(() =>
        [
          ".header",
          ".settings-page",
          ".settings-page__stack",
          ".settings-page__tabs-wrap",
          ".settings-page__content",
        ].map((selector) => {
          const element = document.querySelector(selector);
          if (!element) return { selector, missing: true };
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            selector,
            top: rect.top,
            height: rect.height,
            paddingTop: style.paddingTop,
            marginTop: style.marginTop,
            scrollTop: element.scrollTop,
            offsetTop: element.offsetTop,
            headerFootprint: style.getPropertyValue(
              "--big-picture-header-footprint"
            ),
          };
        })
      )
    );
    await capture(bp, "settings-live");
  }

  if (mode === "overlay-ui") {
    if (!hades) throw new Error("Hades II metadata is unavailable.");
    await app.evaluate(
      async ({ BrowserWindow }, request) => {
        const control = globalThis.__gameHubRecorderQaControl;
        const game = await control.gamesSublevel.get(
          control.levelKeys.game(request.game.shop, request.game.objectId)
        );
        // Only supply persisted metadata. Do not arm global input or target a
        // running game during renderer/controller acceptance.
        control.OverlayManager.activeGame = game;
        const overlay = new BrowserWindow({
          width: 1440,
          height: 900,
          show: false,
          webPreferences: {
            preload: request.preload,
            sandbox: false,
            backgroundThrottling: false,
          },
        });
        control.OverlayManager.overlayWindow = overlay;
        await globalThis.__windowManager.loadWindowURL(overlay, "overlay");
        // Chromium may stop producing screenshot frames after resizing a
        // never-shown window. The background QA policy already makes it fully
        // transparent, non-focusable and click-through before this call.
        if (process.env.GAMEHUB_BACKGROUND_QA === "true")
          overlay.showInactive();
      },
      { game: hades, preload: path.join(root, "out/preload/index.mjs") }
    );
    const overlay = app
      .windows()
      .find((window) => /#\/?overlay$/.test(window.url()));
    if (!overlay) throw new Error("Overlay renderer was not created.");
    overlay.on("pageerror", (error) => report.errors.push(safeMessage(error)));
    await overlay.waitForSelector(".overlay-header", { timeout: 30000 });
    // Foreground state is an explicit fixture in background renderer QA;
    // native in-game shortcut tests do not use this override.
    await overlay.evaluate(() => {
      Object.defineProperty(document, "hasFocus", {
        configurable: true,
        value: () => true,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => [],
      });
    });
    const send = async (action) => {
      await app.evaluate(
        (_electron, action) =>
          globalThis.__gameHubRecorderQaControl.OverlayManager.overlayWindow.webContents.send(
            "on-overlay-gamepad-action",
            action
          ),
        action
      );
      await overlay.waitForTimeout(140);
    };
    await app.evaluate(() =>
      globalThis.__gameHubRecorderQaControl.OverlayManager.overlayWindow.webContents.send(
        "on-overlay-mode",
        "full"
      )
    );
    const widgetIds = await overlay
      .locator("[data-widget]")
      .evaluateAll((elements) =>
        elements.map((element) => element.dataset.widget)
      );
    const visited = new Set();
    for (let i = 0; i < widgetIds.length + 2; i++) {
      await send("next-tab");
      visited.add(
        await overlay.evaluate(() =>
          document.activeElement
            ?.closest("[data-widget]")
            ?.getAttribute("data-widget")
        )
      );
    }
    visited.delete(null);
    if (visited.size < Math.min(2, widgetIds.length))
      throw new Error("Bumpers did not move between overlay widgets.");
    for (const direction of [
      "down",
      "right",
      "down",
      "left",
      "up",
      "up",
      "right",
      "left",
    ]) {
      await send(direction);
      if (
        !(await overlay.evaluate(
          () =>
            document.activeElement instanceof HTMLElement &&
            document.activeElement !== document.body
        ))
      )
        throw new Error("Overlay controller focus was lost.");
    }
    await overlay.getByRole("button", { name: "Widgets", exact: true }).focus();
    await send("accept");
    await overlay.locator("#overlay-widget-menu").waitFor({ state: "visible" });
    await send("back");
    await overlay.evaluate(() => {
      window.__overlayAuditFocus = [];
      document.addEventListener("focusin", (event) => {
        window.__overlayAuditFocus.push({
          target:
            event.target?.getAttribute?.("aria-label") ??
            event.target?.className,
          open: document.querySelector(".overlay-widget-options")?.id,
        });
        window.__overlayAuditFocus = window.__overlayAuditFocus.slice(-12);
      });
    });
    await overlay.locator("#overlay-widget-menu").waitFor({ state: "hidden" });
    await overlay.getByRole("button", { name: "Widgets", exact: true }).focus();
    await send("accept");
    await overlay
      .getByRole("button", { name: "Restore default layout", exact: true })
      .focus();
    await send("accept");
    const confirm = overlay.locator("#overlay-reset-layout-dialog");
    await confirm.waitFor({ state: "visible" });
    await send("back");
    await confirm.waitFor({ state: "hidden" });
    record("overlay-controller-dom", {
      widgets: widgetIds,
      visited: [...visited],
      directions: 8,
      menusDismissed: 2,
      input: "real overlay IPC with simulated controller actions",
    });
    await send("back");
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
      { width: 900, height: 640 },
    ]) {
      await app.evaluate(
        (_electron, viewport) =>
          globalThis.__gameHubRecorderQaControl.OverlayManager.overlayWindow.setContentSize(
            viewport.width,
            viewport.height
          ),
        viewport
      );
      await overlay.waitForFunction(
        ({ width, height }) =>
          window.innerWidth === width && window.innerHeight === height,
        viewport
      );
      await overlay.waitForTimeout(200);
      const titles = await overlay
        .locator(".overlay-card__title h2")
        .evaluateAll((elements) =>
          elements.map((element) => ({
            title: element.textContent,
            clipped: element.scrollWidth > element.clientWidth + 1,
          }))
        );
      if (titles.some((title) => title.clipped))
        throw new Error(
          `Clipped overlay titles: ${JSON.stringify({ viewport, titles })}`
        );
      for (const id of widgetIds) {
        const trigger = overlay.locator(
          `[data-widget="${id}"] .overlay-widget__options-trigger`
        );
        await trigger.focus();
        await send("accept");
        const menu = overlay.locator(`#overlay-widget-options-${id}`);
        await menu.waitFor({ state: "visible" });
        await send("down");
        const menuState = await overlay.evaluate((id) => {
          const menu = document.getElementById(`overlay-widget-options-${id}`);
          return {
            retained: !!menu?.contains(document.activeElement),
            focus: window.__overlayAuditFocus,
          };
        }, id);
        if (!menuState.retained)
          throw new Error(
            `${id} options lost controller scope: ${JSON.stringify(menuState)}`
          );
        await send("back");
        await menu.waitFor({ state: "hidden" });
        if (
          !(await trigger.evaluate(
            (element) => element === document.activeElement
          ))
        )
          throw new Error(`${id} options did not restore focus.`);
      }
      const chrome = await overlay
        .locator(".overlay-card")
        .evaluateAll((elements) =>
          elements.map((element) => ({
            id: element.dataset.widget,
            border: getComputedStyle(element).borderWidth,
            blur: getComputedStyle(element).backdropFilter,
            headerControls: element.querySelectorAll(
              ".overlay-card__tools button"
            ).length,
          }))
        );
      if (
        chrome.some(
          (item) =>
            item.border !== "0px" ||
            item.blur !== "none" ||
            item.headerControls !== 1
        )
      )
        throw new Error(`Overlay chrome drift: ${JSON.stringify(chrome)}`);
      record(`overlay-taste-${viewport.width}x${viewport.height}`, {
        titles,
        optionsMenus: widgetIds.length,
        chrome,
      });
      await capture(
        overlay,
        `overlay-taste-${viewport.width}x${viewport.height}`
      );
    }
    if (
      await overlay
        .getByRole("button", { name: "Search music", exact: true })
        .count()
    ) {
      await overlay
        .getByRole("button", { name: "Search music", exact: true })
        .focus();
      await send("accept");
      await overlay
        .getByRole("textbox", {
          name: "Search tracks and artists",
          exact: true,
        })
        .waitFor();
      if (
        !(await overlay
          .getByRole("textbox", {
            name: "Search tracks and artists",
            exact: true,
          })
          .evaluate((element) => element === document.activeElement))
      )
        throw new Error("Empty music action did not focus search.");
      record("overlay-empty-music-search", { passed: true });
    }
    await capture(overlay, "overlay-populated-controller");
  }

  if (mode === "music") {
    await app.evaluate(async () => {
      const { database, levelKeys } = globalThis.__gameHubRecorderQaControl;
      const preferences = await database.get(levelKeys.userPreferences);
      await database.put(levelKeys.userPreferences, {
        ...preferences,
        musicProvider: "gamehub",
      });
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Show music player", exact: true })
      .waitFor({ timeout: 30000 });
    await page.evaluate(() => window.electron.musicSetVolume(0, true));
    await page
      .getByRole("button", { name: "Show music player", exact: true })
      .click();
    await page
      .getByRole("searchbox", { name: "Search songs or artists" })
      .fill("Darren Korb");
    await page
      .getByRole("button", { name: "Search music", exact: true })
      .click();
    const results = page.getByRole("list", { name: "Music search results" });
    await results.waitFor({ timeout: 30000 });
    record("music-live-search-results", {
      count: await results.getByRole("button").count(),
    });
    await results.getByRole("button").first().click();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("audio")].some(
          (audio) => !audio.paused && audio.currentTime > 2
        ),
      undefined,
      { timeout: 90000 }
    );
    const playback = await page.evaluate(() => window.electron.musicGetState());
    record("music-live-decoding", {
      state: playback.state,
      source: playback.audioSource,
      title: playback.nowPlaying?.title,
      durationMs: playback.durationMs,
    });
    await capture(page, "music-widget-live");
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("audio")].every((audio) => audio.paused)
    );
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("audio")].some((audio) => !audio.paused)
    );
    await page
      .getByRole("button", { name: "Hide music player", exact: true })
      .click();
    record("music-after-widget-close", {
      playing: await page.evaluate(() =>
        [...document.querySelectorAll("audio")].some((audio) => !audio.paused)
      ),
    });
    await page.evaluate(() => window.electron.musicStop());
  }

  if (mode === "launch-hades") {
    if (!hades?.executablePath || !fs.existsSync(hades.executablePath))
      throw new Error("Hades II executable is unavailable.");
    const processes = await app.evaluate(async () =>
      globalThis.__gameHubRecorderQaControl.NativeAddon.listProcesses()
    );
    if (processes.some((process) => /hades2\.exe/i.test(process.name ?? "")))
      throw new Error(
        "Hades II is already running; leave the user's session alone."
      );
    await page.evaluate(
      (game) =>
        window.electron.setCloudSaveAutomaticSyncEnabled(
          game.objectId,
          game.shop,
          false
        ),
      hades
    );
    await page.evaluate(
      (game) =>
        window.electron.openGame(game.shop, game.objectId, game.executablePath),
      hades
    );
    launchedGame = hades;
    await app.evaluate(async (_electron, game) => {
      const control = globalThis.__gameHubRecorderQaControl;
      const fullGame = await control.gamesSublevel.get(
        control.levelKeys.game(game.shop, game.objectId)
      );
      control.OverlayManager.setActiveGame(fullGame);
    }, hades);
    record("hades-launch", { launched: true, overlayArmedByHarness: true });
    let overlayOpened = false;
    for (let attempt = 0; attempt < 180; attempt++) {
      const state = await app.evaluate(() => {
        const control = globalThis.__gameHubRecorderQaControl;
        const overlay = control.OverlayManager;
        return {
          targetPid: overlay.getTargetProcessId(),
          keyboardEvents: control.NativeAddon.getOverlayKeyboardEventCount(),
          gameElevated: control.NativeAddon.isProcessElevated(
            overlay.getTargetProcessId() || 0
          ),
          launcherElevated: control.NativeAddon.isCurrentProcessElevated(),
          shortcut: overlay.registeredShortcut,
          osHotkey: overlay.registeredWithElectron,
          visible: overlay.overlayWindow?.isVisible() ?? false,
          eligible: overlay.windowModeEligibility,
          nativeForegroundPid: control.NativeAddon.getForegroundProcessId(),
        };
      });
      if (attempt % 15 === 0 || state.visible)
        record("live-overlay-state", state);
      if (state.visible) {
        overlayOpened = true;
        const overlayPage = app
          .windows()
          .find((window) => /#\/?overlay$/.test(window.url()));
        if (overlayPage) {
          await capture(overlayPage, "hades-overlay-live");
        }
        await new Promise((resolve) => setTimeout(resolve, 30000));
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!overlayOpened)
      throw new Error("The live game shortcut did not open the overlay.");
  }

  if (mode === "sync-hades") {
    if (!hades) throw new Error("Hades II is not in the populated library.");
    for (const [index, saves] of [
      path.join(os.homedir(), "Saved Games", "Hades II"),
      path.join(os.homedir(), "Documents", "Saved Games", "Hades II"),
    ].entries()) {
      if (fs.existsSync(saves)) {
        const backup = path.join(runRoot, `hades-before-sync-${index}`);
        fs.cpSync(saves, backup, { recursive: true });
        saveBackups.push({ source: saves, backup });
      }
    }
    const before = await page.evaluate(
      (game) => window.electron.getCloudSaveOverview(game.objectId, game.shop),
      hades
    );
    record("before-sync", before);
    const result = await page.evaluate(
      (game) => window.electron.syncGameCloudSave(game.objectId, game.shop),
      hades
    );
    record("hades-real-sync", result);
    const head = await app.evaluate(
      async (_electron, game) =>
        globalThis.__gameHubRecorderQaControl.cloudSaveReadback.getR2ActiveCloudSaveSnapshot(
          game.objectId,
          game.shop
        ),
      hades
    );
    if (!head?.document?.files?.length)
      throw new Error("No remote Hades II files after sync.");
    const destination = path.join(runRoot, "readback");
    fs.mkdirSync(destination);
    const verified = [];
    for (const file of head.document.files) {
      const filePath = path.join(destination, `${file.hash}.blob`);
      if (!fs.existsSync(filePath))
        await app.evaluate(
          async (_electron, request) => {
            await globalThis.__gameHubRecorderQaControl.cloudSaveReadback.downloadR2CloudSaveBlob(
              request.game.objectId,
              request.game.shop,
              request.hash,
              request.destination
            );
          },
          { game: hades, hash: file.hash, destination: filePath }
        );
      const bytes = fs.readFileSync(filePath);
      const hash = crypto.createHash("sha256").update(bytes).digest("hex");
      if (hash !== file.hash)
        throw new Error(`Readback hash mismatch: ${file.relativePath}`);
      verified.push({ file: file.relativePath, bytes: bytes.length, hash });
    }
    record("hades-remote-byte-verification", verified);
    const second = await page.evaluate(
      (game) => window.electron.syncGameCloudSave(game.objectId, game.shop),
      hades
    );
    record("hades-idempotent-sync", second);
    await page.evaluate(() => {
      location.hash = "/cloud-saves";
    });
    await page.waitForTimeout(1500);
    await capture(page, "cloud-saves-live");
  }
} catch (error) {
  if (mode === "overlay-ui" && app) {
    const overlay = app
      .windows()
      .find((window) => /#\/?overlay$/.test(window.url()));
    if (overlay)
      record(
        "overlay-failure-state",
        await overlay
          .evaluate(() => ({
            focus: window.__overlayAuditFocus,
            active: document.activeElement?.outerHTML?.slice(0, 800),
            menus: [
              ...document.querySelectorAll('[data-controller-scope="true"]'),
            ].map((element) => ({
              id: element.id,
              text: element.textContent?.slice(0, 100),
            })),
            mode: document.querySelector(".overlay")?.className,
          }))
          .catch(() => null)
      );
  }
  if (mode === "music" && desktopPage) {
    record(
      "music-failure-state",
      await desktopPage
        .evaluate(async () => {
          const state = await window.electron.musicGetState();
          return {
            state: state.state,
            source: state.audioSource,
            error: state.playbackError,
            audio: [...document.querySelectorAll("audio")].map((audio) => ({
              paused: audio.paused,
              time: audio.currentTime,
              readyState: audio.readyState,
              error: audio.error?.message,
            })),
          };
        })
        .catch(() => null)
    );
  }
  report.errors.push(safeMessage(error));
  console.error(safeMessage(error));
  process.exitCode = 1;
} finally {
  if (app && launchedGame) {
    await desktopPage
      ?.evaluate(
        (game) => window.electron.closeGame(game.shop, game.objectId),
        launchedGame
      )
      .catch(() => {});
  }
  if (app) await app.close().catch(() => {});
  for (const saved of saveBackups) {
    const recovered = [];
    const changed = [];
    for (const name of fs.readdirSync(saved.backup)) {
      const backupFile = path.join(saved.backup, name);
      const sourceFile = path.join(saved.source, name);
      if (!fs.statSync(backupFile).isFile()) continue;
      if (!fs.existsSync(sourceFile)) {
        fs.copyFileSync(backupFile, sourceFile, fs.constants.COPYFILE_EXCL);
        recovered.push(name);
      }
      const digest = (file) =>
        crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      if (digest(backupFile) !== digest(sourceFile)) changed.push(name);
    }
    record("original-save-file-integrity", {
      recovered,
      changed,
      checked: fs.readdirSync(saved.backup).length,
    });
    if (recovered.length || changed.length) process.exitCode = 1;
  }
  fs.writeFileSync(
    path.join(runRoot, "report.json"),
    JSON.stringify(report, null, 2)
  );
  console.log(`Report: ${path.join(runRoot, "report.json")}`);
}
