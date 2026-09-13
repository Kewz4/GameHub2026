/* global globalThis */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const HD = { id: "hd", width: 1280, height: 720 };
const FULL_HD = { id: "full-hd", width: 1920, height: 1080 };
const evidence = {
  area: "linux-frontend-parity",
  fixture: "synthetic-populated-account-and-game-data",
  input: "simulated-controller-and-pointer",
};

async function waitUntil(check, message) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

export async function runLinuxUiCases({
  page,
  electronApp,
  runCase,
  navigateHash,
  captureViewport,
  applyViewport,
  pressGamepadButton,
  installMockXboxGamepad,
  focusNavigationItem,
  qaApiState,
  isolatedData,
}) {
  assert.equal(
    process.platform,
    "linux",
    "Linux evidence requires a native Linux runtime"
  );
  const runtime = await electronApp.evaluate(({ app }) => ({
    platform: process.platform,
    userData: app.getPath("userData"),
    xdgData: process.env.XDG_DATA_HOME,
    display: Boolean(process.env.DISPLAY),
    wayland: Boolean(process.env.WAYLAND_DISPLAY),
  }));
  assert.equal(runtime.platform, "linux");
  assert.equal(path.resolve(runtime.userData), path.resolve(isolatedData));
  assert.ok(runtime.xdgData?.startsWith(path.dirname(isolatedData) + path.sep));

  const fixtureRoot = path.join(isolatedData, "linux-ui-fixture");
  const saveFolder = path.join(fixtureRoot, "saves");
  const executable = path.join(fixtureRoot, "portal2-linux-fixture");
  fs.mkdirSync(saveFolder, { recursive: true });
  fs.writeFileSync(executable, "Synthetic UI fixture; never execute.\n");
  fs.writeFileSync(
    path.join(saveFolder, "profile.sav"),
    "synthetic-save-data\n"
  );
  const configFile = path.join(isolatedData, "ludusavi", "config.yaml");
  const config = YAML.parse(fs.readFileSync(configFile, "utf8"));
  config.customGames = [
    ...(config.customGames ?? []).filter(
      (item) => item.name !== "gamehub-manual:steam:620"
    ),
    { name: "gamehub-manual:steam:620", files: [saveFolder], registry: [] },
  ];
  fs.writeFileSync(configFile, YAML.stringify(config));
  await electronApp.evaluate(async ({ shell }, file) => {
    const games = globalThis.__levelSublevels.gamesSublevel;
    const game = await games.get("steam:620");
    await games.put("steam:620", {
      ...game,
      executablePath: file,
      isInstalledLocally: true,
      platform: "Linux",
    });
    // Spy only on the OS file-manager handoff, so Xvfb doesn't need a file
    // manager. Path resolution and production IPC still execute normally.
    globalThis.__linuxUiShellPaths = [];
    globalThis.__linuxUiOriginalOpenPath = shell.openPath;
    shell.openPath = async (target) => {
      globalThis.__linuxUiShellPaths.push(target);
      return "";
    };
  }, executable);

  try {
    await runCase("linux-parity-runtime", evidence, async () => {
      const values = await page.evaluate(async () => ({
        platform: window.electron.platform,
        libraryCount: (await window.electron.getLibrary()).length,
        saveFolder: await window.electron.getGameSaveFolder("steam", "620"),
      }));
      assert.equal(values.platform, "linux");
      assert.ok(values.libraryCount >= 4);
      assert.equal(values.saveFolder, saveFolder);
      return {
        runtime: {
          platform: runtime.platform,
          display: runtime.display,
          wayland: runtime.wayland,
        },
        libraryCount: values.libraryCount,
        manualSaveMappingResolved: true,
      };
    });

    await runCase("linux-parity-desktop-library-scan", evidence, async () => {
      await applyViewport(page, HD);
      await navigateHash(page, "/library", ".library__content");
      const scan = page
        .locator("[data-tooltip-content]")
        .filter({ has: page.locator("svg.octicon-search") });
      const headerButtons = page.locator(
        ".header__section .header__action-button[data-tooltip-content]"
      );
      assert.ok(
        (await headerButtons.count()) >= 2,
        "Scan and refresh controls must be present on Linux"
      );
      const scanButton = (await scan.count())
        ? scan.first()
        : headerButtons.first();
      await scanButton.click();
      await page.locator(".scan-games-modal").waitFor({ state: "visible" });
      const screenshot = await captureViewport(
        page,
        "linux-parity-desktop-scan",
        HD
      );
      await page
        .getByRole("button", { name: "Cancel", exact: true })
        .last()
        .click();
      return {
        screenshot,
        scanEntryPoint: true,
        refreshEntryPoint: true,
        diskScanStarted: false,
      };
    });

    await runCase(
      "linux-parity-desktop-save-folder-applications-menu",
      evidence,
      async () => {
        await navigateHash(page, "/game/steam/620", ".game-details__container");
        await page
          .getByRole("button", { name: "Options", exact: true })
          .click();
        const menu = page.locator(".game-options-modal__container");
        await menu.waitFor({ state: "visible" });
        const applications = menu.getByRole("button", {
          name: "Add to applications menu",
          exact: true,
        });
        assert.equal(await applications.isEnabled(), true);
        await applications.click();
        const applicationsDir = path.join(runtime.xdgData, "applications");
        await waitUntil(
          () =>
            fs.existsSync(applicationsDir) &&
            fs
              .readdirSync(applicationsDir)
              .some((name) => name.endsWith(".desktop")),
          "Applications-menu action did not produce a .desktop entry"
        );
        const entry = fs
          .readdirSync(applicationsDir)
          .filter((name) => name.endsWith(".desktop"))
          .map((name) =>
            fs.readFileSync(path.join(applicationsDir, name), "utf8")
          )
          .find((text) => text.includes("Portal 2"));
        assert.ok(entry?.includes("hydralauncher://run?"));
        await menu
          .getByRole("button", { name: "Locations", exact: true })
          .click();
        const openSave = menu.getByRole("button", {
          name: "Open save folder",
          exact: true,
        });
        await waitUntil(
          () => openSave.isEnabled(),
          "Linux save-folder action remained disabled"
        );
        await openSave.click();
        const paths = await electronApp.evaluate(
          () => globalThis.__linuxUiShellPaths
        );
        assert.ok(paths.includes(saveFolder));
        const screenshot = await captureViewport(
          page,
          "linux-parity-desktop-save-folder",
          HD
        );
        await page.keyboard.press("Escape");
        return {
          screenshot,
          actualDesktopEntryWritten: true,
          saveFolderIpcDispatched: true,
          fileManagerHandoff: "spied, not launched",
        };
      }
    );

    await runCase(
      "linux-parity-bp-native-executable-and-save-folder",
      evidence,
      async () => {
        await navigateHash(page, "/big-picture/game/steam/620", ".game-page");
        await installMockXboxGamepad(page);
        await page.locator("#game-hero-open-settings").click();
        const openSave = page.locator("#game-launch-settings-save-folder");
        await waitUntil(
          () => openSave.isEnabled(),
          "Big Picture Linux save-folder action stayed disabled"
        );
        assert.equal(
          await page
            .locator("#game-launch-settings-shortcut-start-menu")
            .innerText(),
          "Add to applications menu"
        );
        await focusNavigationItem(
          page,
          openSave,
          "game-launch-settings-save-folder"
        );
        await pressGamepadButton(page, 0);
        const paths = await electronApp.evaluate(
          () => globalThis.__linuxUiShellPaths
        );
        assert.ok(paths.filter((item) => item === saveFolder).length >= 2);
        await page.locator("#game-launch-settings-primary-control").click();
        await page
          .locator(".file-explorer-modal")
          .waitFor({ state: "visible" });
        await page
          .getByRole("button", { name: /portal2-linux-fixture/ })
          .waitFor({ state: "visible" });
        const screenshot = await captureViewport(
          page,
          "linux-parity-bp-extensionless-picker",
          HD
        );
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        return {
          screenshot,
          extensionlessNativeExecutableVisible: true,
          controllerSaveFolderDispatch: true,
        };
      }
    );

    await runCase(
      "linux-parity-bp-proton-deck-controller-filters",
      evidence,
      async () => {
        await navigateHash(
          page,
          "/big-picture/catalogue",
          ".catalogue-results-page"
        );
        await installMockXboxGamepad(page);
        const proton = page.locator("#catalogue-proton-select");
        await focusNavigationItem(page, proton, "catalogue-proton-select");
        await pressGamepadButton(page, 0);
        await pressGamepadButton(page, 13);
        await pressGamepadButton(page, 13);
        await pressGamepadButton(page, 0);
        const deck = page.locator("#catalogue-deck-select");
        await focusNavigationItem(page, deck, "catalogue-deck-select");
        await pressGamepadButton(page, 0);
        await pressGamepadButton(page, 13);
        await pressGamepadButton(page, 13);
        await pressGamepadButton(page, 0);
        await waitUntil(
          () =>
            qaApiState.catalogueSearches.some(
              (search) =>
                search.protondbSupportBadges?.includes("gold") &&
                search.deckCompatibility?.includes("verified")
            ),
          "Controller filters did not reach the catalogue API payload"
        );
        const screenshots = [];
        for (const viewport of [HD, FULL_HD]) {
          await applyViewport(page, viewport);
          screenshots.push(
            await captureViewport(
              page,
              "linux-parity-bp-compatibility",
              viewport
            )
          );
          const fits = await page
            .locator(".catalogue-header")
            .evaluate(
              (element) => element.scrollWidth <= element.clientWidth + 1
            );
          assert.equal(
            fits,
            true,
            "Linux compatibility controls overflow their header"
          );
        }
        await page.locator("#catalogue-clear-filters").click();
        const hash = await page.evaluate(() => location.hash);
        assert.equal(hash.includes("protondbSupportBadges"), false);
        assert.equal(hash.includes("deckCompatibility"), false);
        return {
          screenshots,
          controllerSelectionReachedApi: true,
          clearFiltersWorked: true,
        };
      }
    );

    await runCase(
      "linux-parity-capture-capability-settings",
      evidence,
      async () => {
        await applyViewport(page, HD);
        const state = await page.evaluate(() =>
          window.electron.gameRecorderGetPreferences()
        );
        assert.equal(typeof state.desktopCaptureAvailable, "boolean");
        assert.equal(typeof state.systemAudioCaptureAvailable, "boolean");
        await navigateHash(
          page,
          "/settings?tab=content_gameplay",
          ".settings__container"
        );
        const souvenir = page.locator("#settings-enable-achievement-souvenirs");
        await souvenir.waitFor({ state: "visible" });
        assert.equal(
          await souvenir.isDisabled(),
          !state.desktopCaptureAvailable
        );
        const audio = page.locator("#settings-game-recorder-capture-audio");
        if (!state.systemAudioCaptureAvailable)
          assert.equal(await audio.isDisabled(), true);
        await souvenir.scrollIntoViewIfNeeded();
        const desktopScreenshot = await captureViewport(
          page,
          "linux-parity-desktop-capture-capability",
          HD
        );
        await navigateHash(
          page,
          "/big-picture/settings?tab=content",
          ".settings-page"
        );
        const bpSouvenir = page.getByRole("checkbox", {
          name: "Capture achievement souvenirs",
          exact: true,
        });
        await bpSouvenir.waitFor({ state: "visible" });
        assert.equal(
          await bpSouvenir.isDisabled(),
          !state.desktopCaptureAvailable
        );
        const bpScreenshot = await captureViewport(
          page,
          "linux-parity-bp-capture-capability",
          HD
        );
        return {
          screenshots: [desktopScreenshot, bpScreenshot],
          screenshotCapability: state.desktopCaptureAvailable,
          systemAudioCapability: state.systemAudioCaptureAvailable,
          gameCaptured: false,
        };
      }
    );

    await runCase(
      "linux-parity-retroarch-setup-and-account-input",
      evidence,
      async () => {
        await navigateHash(
          page,
          "/big-picture/settings?tab=emulation",
          ".settings-page"
        );
        await page
          .getByText("RetroArch", { exact: true })
          .first()
          .waitFor({ state: "visible" });
        await page.locator("#emulation-ra-password").scrollIntoViewIfNeeded();
        assert.equal(
          await page.locator("#emulation-ra-password").getAttribute("type"),
          "password"
        );
        assert.equal(
          await page.locator("#emulation-ra-sign-in").isDisabled(),
          true
        );
        const screenshot = await captureViewport(
          page,
          "linux-parity-bp-retroarch-account",
          HD
        );
        return {
          screenshot,
          nativeEmulatorName: "RetroArch",
          passwordInputMasked: true,
          externalAuthenticationAttempted: false,
        };
      }
    );
  } finally {
    await electronApp.evaluate(({ shell }) => {
      if (globalThis.__linuxUiOriginalOpenPath)
        shell.openPath = globalThis.__linuxUiOriginalOpenPath;
      delete globalThis.__linuxUiOriginalOpenPath;
      delete globalThis.__linuxUiShellPaths;
    });
  }
}
