import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  "overlay-screenshot-host.cjs"
);
const renderer = path.join(repositoryRoot, "out", "renderer", "index.html");
const output = path.join(
  repositoryRoot,
  "artifacts",
  "overlay",
  "gamehub-overlay-playwright-electron.png"
);

for (const required of [electronExecutable, host, renderer]) {
  if (!fs.existsSync(required)) throw new Error(`Missing ${required}`);
}
await fs.promises.mkdir(path.dirname(output), { recursive: true });

const electronApp = await electron.launch({
  executablePath: electronExecutable,
  args: [host],
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
});

try {
  const page = await electronApp.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    const achievementIcon =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#171717"/><path d="M20 16h24v8c0 9-5 15-12 18-7-3-12-9-12-18v-8Zm12 26v7m-9 0h18" fill="none" stroke="#f4f4f4" stroke-width="4" stroke-linecap="round"/></svg>'
      );
    const now = Date.now();
    const context = {
      game: {
        title: "The First Berserker: Khazan",
        objectId: "2680010",
        shop: "steam",
        iconUrl: null,
        logoImageUrl: null,
        heroImageUrl: null,
        coverImageUrl: null,
        playTimeInMilliseconds: 7_620_000,
        sessionStartedAt: now - 3_847_000,
      },
      user: null,
      achievements: [
        {
          name: "first_step",
          displayName: "A Warrior Reborn",
          description: "Complete the opening battle.",
          icon: achievementIcon,
          unlocked: true,
          unlockTime: now - 3_000_000,
        },
        {
          name: "edge_of_death",
          displayName: "At Death's Door",
          description: "Defeat a boss with less than 10% vitality.",
          icon: achievementIcon,
          unlocked: true,
          unlockTime: now - 600_000,
        },
        {
          name: "mastery",
          displayName: "Weapon Mastery",
          description: "Unlock every skill in one weapon tree.",
          icon: achievementIcon,
          unlocked: false,
          unlockTime: null,
        },
      ],
      shortcut: "Shift+F3",
      controllerShortcut: "Guide",
      performance: {
        fps: 117,
        averageFps: 112,
        onePercentLow: 88,
        frameTimeMs: 8.5,
        updatedAt: now,
        captureStatus: "capturing",
        captureMessage: "PresentMon • DXGI • Hardware: Independent Flip",
      },
      performancePinned: true,
      settings: {
        performanceEnabled: true,
        performanceRows: {
          fps: true,
          averageFps: true,
          frameTime: true,
          onePercentLow: true,
        },
      },
    };
    const recorderState = {
      status: "buffering",
      configuration: {
        enabled: true,
        resolution: "1080p",
        fps: 60,
        instantReplayEnabled: true,
        replayDurationSeconds: 30,
        captureGameAudio: true,
        outputDirectory: null,
      },
      resolvedOutputDirectory: "C:\\Users\\Player\\Videos\\GameHub",
      recordingStartedAt: null,
      bufferedSeconds: 30,
      captureActive: true,
      gameTitle: context.game.title,
      lastSavedClipPath: null,
      statusMessage: null,
      errorMessage: null,
    };
    const musicTrack = {
      id: "track-1",
      title: "Black Sea",
      artist: "GameHub Mix",
      album: "Focus Mode",
      coverArt: null,
      duration: 236,
    };
    const musicState = {
      queue: [
        musicTrack,
        {
          ...musicTrack,
          id: "track-2",
          title: "Ashen Crown",
          artist: "Night Signal",
        },
      ],
      currentIndex: 0,
      nowPlaying: musicTrack,
      state: "paused",
      shuffle: false,
      repeat: "none",
      progressMs: 74_000,
      durationMs: 236_000,
      audioUrl: null,
      audioSource: "youtube",
      playbackError: null,
      playbackNotice: null,
    };

    const listeners = () => () => undefined;
    const api = {
      platform: "win32",
      isWayland: false,
      getVersion: async () => "1.1.20",
      isStaging: async () => false,
      updateUserPreferences: async () => undefined,
      onCustomThemeUpdated: listeners,
      onUserPreferencesUpdated: listeners,
      leveldb: {
        get: async (key) =>
          key === "userPreferences"
            ? { language: "en", themeMode: "dark" }
            : null,
        put: async () => undefined,
        del: async () => undefined,
        clear: async () => undefined,
        values: async () => [],
        iterator: async () => [],
      },
      getOverlayContext: async () => context,
      getOverlayNote: async () =>
        "Boss phase two: dodge inward, then punish the overhead swing.",
      saveOverlayNote: async () => undefined,
      closeHydraOverlay: async () => undefined,
      setOverlayPerformancePinned: async () => undefined,
      onOverlayMode: listeners,
      onOverlayShown: listeners,
      onOverlayPerformance: listeners,
      onOverlayPerformancePin: listeners,
      onOverlayGamepadAction: listeners,
      gameRecorderGetState: async () => recorderState,
      gameRecorderStart: async () => ({
        ...recorderState,
        status: "recording",
        recordingStartedAt: Date.now(),
      }),
      gameRecorderStop: async () => ({
        ok: true,
        path: "C:\\Users\\Player\\Videos\\GameHub\\recording.webm",
        error: null,
      }),
      gameRecorderSaveReplay: async () => ({
        ok: true,
        path: "C:\\Users\\Player\\Videos\\GameHub\\replay.webm",
        error: null,
      }),
      gameRecorderOpenOutputDirectory: async () => undefined,
      onGameRecorderState: listeners,
      musicGetState: async () => musicState,
      musicGetPlaylists: async () => [],
      musicSearch: async () => [],
      getPinnedApps: async () => [
        { name: "Discord", path: "C:\\Apps\\Discord.exe" },
        { name: "OBS Studio", path: "C:\\Apps\\obs64.exe" },
      ],
      pickPinnedApp: async () => [],
      removePinnedApp: async () => [],
      launchPinnedApp: async () => "",
      getAudioSessions: async () => [
        {
          pid: 8120,
          name: "Khazan",
          volume: 0.82,
          muted: false,
        },
        {
          pid: 2240,
          name: "GameHub Music",
          volume: 0.58,
          muted: false,
        },
      ],
      setAudioSessionVolume: async () => true,
      setAudioSessionMute: async () => true,
    };
    Object.defineProperty(window, "electron", {
      configurable: false,
      value: new Proxy(api, {
        get(target, property) {
          if (property in target) return target[property];
          if (String(property).startsWith("on")) return listeners;
          return async () => undefined;
        },
      }),
    });
  });

  await page.goto(`${pathToFileURL(renderer).href}#/overlay`);
  await page.waitForSelector(".overlay--full", { timeout: 30_000 });
  await page.waitForSelector('[data-widget="capture"]', { timeout: 10_000 });
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: output, fullPage: true });

  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
    widgets: document.querySelectorAll("[data-widget]").length,
    captureText:
      document.querySelector('[data-widget="capture"]')?.textContent ?? "",
  }));
  if (pageErrors.length) {
    throw new Error(`Renderer errors: ${pageErrors.join(" | ")}`);
  }
  console.log(JSON.stringify({ output, ...dimensions }, null, 2));
} finally {
  await electronApp.close();
}
