#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");
const sharp = require("sharp");

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE;
if (!playwrightPackage) {
  throw new Error("Set PLAYWRIGHT_PACKAGE to Playwright's package directory.");
}

const { _electron: electron } = await import(
  pathToFileURL(path.join(playwrightPackage, "index.mjs")).href
);

const electronExecutable = path.join(
  repositoryRoot,
  "node_modules",
  "electron",
  "dist",
  "electron.exe"
);
const host = path.join(
  repositoryRoot,
  "scripts",
  "overlay-notification-visual-host.cjs"
);
const renderer = path.join(repositoryRoot, "out", "renderer", "index.html");
const outputDirectory = process.env.OVERLAY_VISUAL_OUTPUT
  ? path.resolve(process.env.OVERLAY_VISUAL_OUTPUT)
  : path.join(
      repositoryRoot,
      "artifacts",
      "overlay",
      "right-edge-visual-acceptance"
    );

for (const required of [electronExecutable, host, renderer]) {
  if (!fs.existsSync(required)) throw new Error(`Missing ${required}`);
}
await fs.promises.mkdir(outputDirectory, { recursive: true });

const DELAYED_BADGE_MS = 900;
const badge = new PNG({ width: 64, height: 64 });
for (let y = 0; y < badge.height; y += 1) {
  for (let x = 0; x < badge.width; x += 1) {
    const offset = (badge.width * y + x) << 2;
    const inCenter = x >= 18 && x <= 45 && y >= 18 && y <= 45;
    const onCross = Math.abs(x - 31.5) < 4 || Math.abs(y - 31.5) < 4;
    const color = inCenter && onCross ? [38, 208, 124] : [25, 65, 145];
    badge.data[offset] = color[0];
    badge.data[offset + 1] = color[1];
    badge.data[offset + 2] = color[2];
    badge.data[offset + 3] = 255;
  }
}
const badgePng = PNG.sync.write(badge);

let badgeRequests = 0;
let firstBadgeRequestAt = null;
let firstBadgeResponseAt = null;
const badgeServer = http.createServer((request, response) => {
  if (request.url !== "/delayed-achievement.png") {
    response.writeHead(404).end();
    return;
  }

  badgeRequests += 1;
  firstBadgeRequestAt ??= performance.now();
  setTimeout(() => {
    firstBadgeResponseAt ??= performance.now();
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": badgePng.length,
      "Cache-Control": "public, max-age=3600, immutable",
    });
    response.end(badgePng);
  }, DELAYED_BADGE_MS);
});
await new Promise((resolve, reject) => {
  badgeServer.once("error", reject);
  badgeServer.listen(0, "127.0.0.1", resolve);
});
const badgeAddress = badgeServer.address();
assert.ok(badgeAddress && typeof badgeAddress === "object");
const delayedBadgeUrl = `http://127.0.0.1:${badgeAddress.port}/delayed-achievement.png`;

const readPng = async (file) => PNG.sync.read(await fs.promises.readFile(file));

const alphaAt = (png, x, y) => png.data[(png.width * y + x) * 4 + 3];

const assertRightEdgeConnectedShape = async (file, label) => {
  const png = await readPng(file);
  const rightCorners = [
    [png.width - 1, 0],
    [png.width - 1, png.height - 1],
  ];
  for (const [cornerX, cornerY] of rightCorners) {
    for (let dy = 0; dy < 3; dy += 1) {
      for (let dx = 0; dx < 3; dx += 1) {
        const x = cornerX - dx;
        const y = cornerY === 0 ? dy : cornerY - dy;
        assert.ok(
          alphaAt(png, x, y) >= 235,
          `${label} is detached from the right edge at ${x},${y}`
        );
      }
    }
  }

  const leftCorners = [
    [0, 0],
    [0, png.height - 1],
  ];
  for (const [cornerX, cornerY] of leftCorners) {
    for (let dy = 0; dy < 2; dy += 1) {
      for (let dx = 0; dx < 2; dx += 1) {
        const x = cornerX + dx;
        const y = cornerY === 0 ? dy : cornerY - dy;
        assert.ok(
          alphaAt(png, x, y) <= 16,
          `${label} paints outside its rounded left edge at ${x},${y}`
        );
      }
    }
  }

  assert.ok(
    alphaAt(png, Math.floor(png.width / 2), Math.floor(png.height / 2)) >= 235,
    `${label} is unexpectedly translucent through the card interior`
  );
  return {
    width: png.width,
    height: png.height,
    alpha: {
      topLeft: alphaAt(png, 0, 0),
      bottomLeft: alphaAt(png, 0, png.height - 1),
      topRight: alphaAt(png, png.width - 1, 0),
      bottomRight: alphaAt(png, png.width - 1, png.height - 1),
      center: alphaAt(
        png,
        Math.floor(png.width / 2),
        Math.floor(png.height / 2)
      ),
    },
  };
};

const assertFullyTransparent = async (file, label) => {
  const png = await readPng(file);
  let nonTransparentPixels = 0;
  for (let index = 3; index < png.data.length; index += 4) {
    if (png.data[index] > 8) nonTransparentPixels += 1;
  }
  assert.equal(
    nonTransparentPixels,
    0,
    `${label} painted ${nonTransparentPixels} pixels before the badge decoded`
  );
};

const makeBackdrop = async (capture, fixture, suffix) => {
  const composite = path.join(
    outputDirectory,
    `overlay-${suffix}-${fixture.name}-right-edge.png`
  );
  const left = fixture.expected.x - fixture.target.x;
  const top = fixture.expected.y - fixture.target.y;
  await sharp({
    create: {
      width: fixture.target.width,
      height: fixture.target.height,
      channels: 4,
      background: { r: 14, g: 18, b: 25, alpha: 1 },
    },
  })
    .composite([{ input: capture, left, top }])
    .png()
    .toFile(composite);
  return composite;
};

const fixtures = [
  {
    name: "wide-440",
    target: { x: 0, y: 0, width: 1920, height: 1080 },
    expectedReady: { x: 1480, y: 24, width: 440, height: 64 },
    expectedError: { x: 1480, y: 24, width: 440, height: 80 },
  },
  {
    name: "medium-406",
    target: { x: 0, y: 0, width: 430, height: 300 },
    expectedReady: { x: 24, y: 24, width: 406, height: 64 },
    expectedError: { x: 24, y: 24, width: 406, height: 80 },
  },
  {
    name: "compact-316",
    target: { x: 0, y: 0, width: 340, height: 300 },
    expectedReady: { x: 24, y: 24, width: 316, height: 82 },
    expectedError: { x: 24, y: 24, width: 316, height: 96 },
  },
];

const electronApp = await electron.launch({
  executablePath: electronExecutable,
  args: [host],
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
});

const results = {
  outputDirectory,
  toast: [],
  achievement: {},
  pageErrors: [],
};

try {
  const page = await electronApp.firstWindow();
  page.on("pageerror", (error) => results.pageErrors.push(error.message));

  await page.addInitScript(() => {
    const noopListener = () => () => undefined;
    const listeners = {
      achievement: new Set(),
      combined: new Set(),
      inApp: new Set(),
    };
    const subscribe = (set) => (callback) => {
      set.add(callback);
      return () => set.delete(callback);
    };
    const state = {
      rendererReadyAt: null,
      achievementTriggeredAt: null,
      iconMountedAt: null,
      notificationHiddenAt: null,
    };

    const markIcon = (root) => {
      const icon = root.querySelector?.(".achievement-notification__icon");
      if (icon && state.iconMountedAt === null) {
        state.iconMountedAt = performance.now();
      }
    };
    const observe = (root) => {
      const observer = new MutationObserver(() => markIcon(root));
      observer.observe(root, { childList: true, subtree: true });
      markIcon(root);
    };
    const originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachShadow(options) {
      const shadowRoot = originalAttachShadow.call(this, options);
      observe(shadowRoot);
      return shadowRoot;
    };
    observe(document);

    window.__overlayNotificationQa = {
      state,
      emitAchievement(position, achievements) {
        state.achievementTriggeredAt = performance.now();
        for (const callback of listeners.achievement) {
          callback(position, achievements);
        }
      },
    };

    let userPreferences = {
      language: "en",
      themeMode: "dark",
      achievementNotificationsEnabled: true,
      achievementCustomNotificationsEnabled: true,
      achievementCustomNotificationPosition: "top-right",
      achievementSoundVolume: 0,
    };
    const api = {
      platform: "win32",
      isWayland: false,
      getVersion: async () => "visual-qa",
      isStaging: async () => false,
      updateUserPreferences: async (preferences) => {
        userPreferences = { ...userPreferences, ...preferences };
      },
      leveldb: {
        get: async (key) =>
          key === "userPreferences" ? userPreferences : null,
        put: async () => undefined,
        del: async () => undefined,
        clear: async () => undefined,
        values: async () => [],
        iterator: async () => [],
      },
      onAchievementUnlocked: subscribe(listeners.achievement),
      onCombinedAchievementsUnlocked: subscribe(listeners.combined),
      onInAppAchievementUnlocked: subscribe(listeners.inApp),
      achievementNotificationRendererReady: () => {
        state.rendererReadyAt = performance.now();
      },
      hideAchievementCustomNotificationWindow: async () => {
        state.notificationHiddenAt = performance.now();
      },
      onCustomThemeUpdated: noopListener,
      getThemeSoundDataUrl: async () => null,
    };

    Object.defineProperty(window, "electron", {
      configurable: false,
      value: new Proxy(api, {
        get(target, property) {
          if (property in target) return target[property];
          if (String(property).startsWith("on")) return noopListener;
          return async () => undefined;
        },
      }),
    });
  });

  const rendererUrl = pathToFileURL(renderer).href;

  const setHostBounds = async (bounds) => {
    const actual = await electronApp.evaluate(({ BrowserWindow }, next) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setBounds(next, false);
      return window.getBounds();
    }, bounds);
    assert.deepEqual(actual, bounds, "Electron changed the production bounds");
    await page.waitForFunction(
      (size) =>
        window.innerWidth === size.width && window.innerHeight === size.height,
      bounds
    );
  };

  const inspectToast = async (fixture, kind) => {
    const expected =
      kind === "error" ? fixture.expectedError : fixture.expectedReady;
    await setHostBounds(expected);
    const query =
      kind === "error"
        ? "?kind=overlay-unavailable&reason=exclusive-fullscreen"
        : "";
    await page.goto(`${rendererUrl}#/overlay-toast${query}`);
    const selector =
      kind === "error" ? ".overlay-toast--error" : ".overlay-toast";
    await page.locator(selector).waitFor({ state: "visible" });

    const animationContract = await page.locator(selector).evaluate((toast) => {
      const style = getComputedStyle(toast);
      const animation = toast.getAnimations()[0];
      if (!animation)
        throw new Error("Missing right-origin entrance animation");
      animation.pause();
      animation.currentTime = 70;
      return {
        name: style.animationName,
        duration: style.animationDuration,
        timingFunction: style.animationTimingFunction,
      };
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve))
    );

    const entranceState = await page.locator(selector).evaluate((toast) => {
      const style = getComputedStyle(toast);
      const rect = toast.getBoundingClientRect();
      return {
        opacity: Number(style.opacity),
        transform: style.transform,
        x: rect.x,
        right: rect.right,
      };
    });
    assert.equal(animationContract.name, "overlay-toast-enter-from-right");
    assert.equal(animationContract.duration, "0.28s");
    assert.ok(
      entranceState.x > 0 && entranceState.x < expected.width,
      "entrance frame did not originate right"
    );
    assert.ok(
      entranceState.right > expected.width,
      "entrance frame is not visibly crossing the right edge"
    );
    assert.ok(entranceState.opacity > 0 && entranceState.opacity <= 1);

    const entranceCapture = path.join(
      outputDirectory,
      `overlay-${kind}-${fixture.name}-entering-from-right.png`
    );
    await page.screenshot({ path: entranceCapture, omitBackground: true });
    const entranceComposite = await makeBackdrop(
      entranceCapture,
      { ...fixture, expected },
      `${kind}-${fixture.name}-entrance`
    );

    await page.locator(selector).evaluate((toast) => {
      const animation = toast.getAnimations()[0];
      if (!animation) throw new Error("Entrance animation disappeared");
      animation.finish();
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve))
    );

    const inspection = await page.locator(selector).evaluate((toast) => {
      const style = getComputedStyle(toast);
      const rect = toast.getBoundingClientRect();
      const content = Array.from(
        toast.querySelectorAll(
          ":scope > .overlay-toast__dot, :scope > .overlay-toast__body"
        )
      ).map((element) => element.getBoundingClientRect());
      const contentTop = Math.min(...content.map((child) => child.top));
      const contentBottom = Math.max(...content.map((child) => child.bottom));
      const outside = Array.from(toast.querySelectorAll("*"))
        .filter((element) => {
          const child = element.getBoundingClientRect();
          return (
            child.left < rect.left - 0.5 ||
            child.top < rect.top - 0.5 ||
            child.right > rect.right + 0.5 ||
            child.bottom > rect.bottom + 0.5
          );
        })
        .map((element) => element.className || element.tagName);
      return {
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        scrollWidth: toast.scrollWidth,
        clientWidth: toast.clientWidth,
        scrollHeight: toast.scrollHeight,
        clientHeight: toast.clientHeight,
        outside,
        boxShadow: style.boxShadow,
        backdropFilter: style.backdropFilter,
        borderTopWidth: style.borderTopWidth,
        borderTopLeftRadius: style.borderTopLeftRadius,
        borderBottomLeftRadius: style.borderBottomLeftRadius,
        borderTopRightRadius: style.borderTopRightRadius,
        borderBottomRightRadius: style.borderBottomRightRadius,
        topWhitespace: contentTop - rect.top,
        bottomWhitespace: rect.bottom - contentBottom,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        rootBackground: getComputedStyle(document.getElementById("root"))
          .backgroundColor,
        text: toast.textContent?.replace(/\s+/g, " ").trim(),
      };
    });

    assert.deepEqual(inspection.rect, {
      x: 0,
      y: 0,
      width: expected.width,
      height: expected.height,
    });
    assert.equal(inspection.scrollWidth, inspection.clientWidth);
    assert.equal(inspection.scrollHeight, inspection.clientHeight);
    assert.deepEqual(inspection.outside, []);
    assert.equal(inspection.boxShadow, "none");
    assert.equal(inspection.backdropFilter, "none");
    assert.equal(inspection.borderTopWidth, "0px");
    assert.notEqual(inspection.borderTopLeftRadius, "0px");
    assert.notEqual(inspection.borderBottomLeftRadius, "0px");
    assert.equal(inspection.borderTopRightRadius, "0px");
    assert.equal(inspection.borderBottomRightRadius, "0px");
    assert.ok(
      inspection.bottomWhitespace <= 16,
      `${kind} ${fixture.name} leaves ${inspection.bottomWhitespace}px empty below its content`
    );
    assert.ok(
      Math.abs(inspection.topWhitespace - inspection.bottomWhitespace) <= 1,
      `${kind} ${fixture.name} content is not vertically balanced`
    );
    assert.equal(inspection.bodyBackground, "rgba(0, 0, 0, 0)");
    assert.equal(inspection.rootBackground, "rgba(0, 0, 0, 0)");

    const capture = path.join(
      outputDirectory,
      `overlay-${kind}-${fixture.name}.png`
    );
    await page.screenshot({ path: capture, omitBackground: true });
    const imageGeometry = await assertRightEdgeConnectedShape(
      capture,
      `${kind} ${fixture.name}`
    );
    assert.equal(imageGeometry.width, expected.width);
    assert.equal(imageGeometry.height, expected.height);
    const composite = await makeBackdrop(
      capture,
      { ...fixture, expected },
      kind
    );
    return {
      kind,
      fixture: fixture.name,
      target: fixture.target,
      bounds: expected,
      rightOffset:
        fixture.target.x + fixture.target.width - (expected.x + expected.width),
      capture,
      composite,
      entranceCapture,
      entranceComposite,
      animationContract,
      entranceState,
      imageGeometry,
      inspection,
    };
  };

  for (const fixture of fixtures) {
    results.toast.push(await inspectToast(fixture, "ready"));
    results.toast.push(await inspectToast(fixture, "error"));
  }
  for (const result of results.toast) {
    assert.equal(result.rightOffset, 0);
  }

  const notificationBounds = { x: 0, y: 0, width: 360, height: 140 };
  await setHostBounds(notificationBounds);
  await page.goto(`${rendererUrl}#/achievement-notification`);
  await page.waitForFunction(
    () => window.__overlayNotificationQa?.state.rendererReadyAt !== null
  );

  await page.evaluate((iconUrl) => {
    window.__overlayNotificationQa.emitAchievement("top-right", [
      {
        title: "No Placeholder",
        description: "Decoded before the first painted frame",
        iconUrl,
        isHidden: false,
        isRare: false,
        isPlatinum: false,
        points: 25,
      },
    ]);
  }, delayedBadgeUrl);

  await page.waitForTimeout(250);
  assert.equal(
    await page.locator(".achievement-notification").count(),
    0,
    "The notification mounted before its delayed badge decoded"
  );
  const beforeDecode = path.join(
    outputDirectory,
    "achievement-delayed-before-decode-transparent.png"
  );
  await page.screenshot({ path: beforeDecode, omitBackground: true });
  await assertFullyTransparent(beforeDecode, "achievement pre-decode frame");

  const notification = page.locator(".achievement-notification");
  const icon = page.locator(".achievement-notification__icon");
  await notification.waitFor({ state: "visible", timeout: 5_000 });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve))
  );

  const iconState = await icon.evaluate((image) => ({
    complete: image.complete,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    currentSrc: image.currentSrc,
  }));
  assert.deepEqual(iconState, {
    complete: true,
    naturalWidth: 64,
    naturalHeight: 64,
    currentSrc: delayedBadgeUrl,
  });
  const notificationFrame = await page
    .locator(".achievement-notification__outer-container")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderTopWidth: style.borderTopWidth,
        borderRightWidth: style.borderRightWidth,
        borderBottomWidth: style.borderBottomWidth,
        borderLeftWidth: style.borderLeftWidth,
      };
    });
  assert.deepEqual(notificationFrame, {
    borderTopWidth: "0px",
    borderRightWidth: "0px",
    borderBottomWidth: "0px",
    borderLeftWidth: "0px",
  });

  const firstVisible = path.join(
    outputDirectory,
    "achievement-delayed-first-visible-frame.png"
  );
  await page.screenshot({ path: firstVisible, omitBackground: true });
  const firstVisibleState = await page.evaluate(
    () => window.__overlayNotificationQa.state
  );
  assert.ok(firstVisibleState.iconMountedAt !== null);
  assert.ok(firstBadgeResponseAt !== null);
  assert.ok(
    firstVisibleState.iconMountedAt >= firstVisibleState.achievementTriggeredAt,
    "The mounted badge timestamp precedes the unlock event"
  );
  assert.ok(
    firstVisibleState.iconMountedAt -
      firstVisibleState.achievementTriggeredAt >=
      DELAYED_BADGE_MS - 100,
    "The notification mounted before the deliberately delayed response"
  );

  await page.waitForTimeout(1_450);
  const expanded = path.join(
    outputDirectory,
    "achievement-delayed-expanded.png"
  );
  await page.screenshot({ path: expanded, omitBackground: true });
  const iconCapture = path.join(
    outputDirectory,
    "achievement-delayed-icon.png"
  );
  await icon.screenshot({ path: iconCapture, omitBackground: true });
  const iconPng = await readPng(iconCapture);
  assert.equal(iconPng.width, 64);
  assert.equal(iconPng.height, 64);
  const centerOffset = (iconPng.width * 32 + 32) * 4;
  const center = Array.from(iconPng.data.slice(centerOffset, centerOffset + 4));
  assert.ok(center[0] < 80 && center[1] > 170 && center[2] < 160);
  assert.equal(center[3], 255);

  results.achievement = {
    delayedBadgeMs: DELAYED_BADGE_MS,
    badgeRequests,
    firstBadgeRequestAt,
    firstBadgeResponseAt,
    rendererState: firstVisibleState,
    iconState,
    notificationFrame,
    iconCenterRgba: center,
    beforeDecode,
    firstVisible,
    expanded,
    iconCapture,
  };

  assert.deepEqual(results.pageErrors, []);
  const report = path.join(outputDirectory, "visual-acceptance.json");
  await fs.promises.writeFile(report, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify({ ...results, report }, null, 2));
} finally {
  await electronApp.close().catch(() => {});
  await new Promise((resolve) => badgeServer.close(resolve));
}
