/* global globalThis */

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
  ...(process.platform === "darwin"
    ? ["Electron.app", "Contents", "MacOS", "Electron"]
    : [process.platform === "win32" ? "electron.exe" : "electron"])
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
const firstOpenOutput = path.join(
  repositoryRoot,
  "artifacts",
  "overlay",
  "gamehub-overlay-first-open.png"
);
const secondOpenOutput = path.join(
  repositoryRoot,
  "artifacts",
  "overlay",
  "gamehub-overlay-second-open.png"
);
const controllerFullHdOutput = path.join(
  repositoryRoot,
  "artifacts",
  "overlay",
  "gamehub-overlay-controller-1920x1080.png"
);
const controllerCompactOutput = path.join(
  repositoryRoot,
  "artifacts",
  "overlay",
  "gamehub-overlay-controller-1280x720.png"
);

for (const required of [electronExecutable, host, renderer]) {
  if (!fs.existsSync(required)) throw new Error(`Missing ${required}`);
}
await fs.promises.mkdir(path.dirname(output), { recursive: true });

const electronApp = await electron.launch({
  executablePath: electronExecutable,
  args: [host, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
});

try {
  const nativeIconDataUrl = await electronApp
    .evaluate(async ({ app }, executablePath) => {
      const image = await app.getFileIcon(executablePath, { size: "large" });
      return image.toDataURL();
    }, electronExecutable)
    .catch((error) => {
      if (process.platform === "win32") throw error;
      return "";
    });
  if (
    process.platform === "win32" &&
    !nativeIconDataUrl.startsWith("data:image/")
  ) {
    throw new Error("Electron did not resolve a native executable icon.");
  }

  const page = await electronApp.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const assertCompactOverlayLegibility = async (label) => {
    const result = await page.evaluate(() => {
      if (window.innerWidth > 1100) return { checked: false };

      const viewportHasHorizontalScroll =
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth;
      const clippedHeaders = Array.from(
        document.querySelectorAll("[data-widget] .overlay-card__title h2")
      )
        .filter((heading) => {
          const widget = heading.closest("[data-widget]");
          if (!(widget instanceof HTMLElement)) return true;
          const headingRect = heading.getBoundingClientRect();
          const widgetRect = widget.getBoundingClientRect();
          return (
            headingRect.left < widgetRect.left ||
            headingRect.right > widgetRect.right ||
            headingRect.width <= 0
          );
        })
        .map((heading) => heading.textContent?.trim() ?? "unknown");
      const overlappingHeaderTools = Array.from(
        document.querySelectorAll("[data-widget] .overlay-card__title h2")
      )
        .filter((heading) => {
          const header = heading.closest(".overlay-card__head");
          const tools = header?.querySelector(".overlay-card__tools");
          if (!(tools instanceof HTMLElement)) return false;
          const headingRect = heading.getBoundingClientRect();
          const toolsRect = tools.getBoundingClientRect();
          return (
            Math.min(headingRect.right, toolsRect.right) >
              Math.max(headingRect.left, toolsRect.left) &&
            Math.min(headingRect.bottom, toolsRect.bottom) >
              Math.max(headingRect.top, toolsRect.top)
          );
        })
        .map((heading) => heading.textContent?.trim() ?? "unknown");
      const clippedPerformanceValues = Array.from(
        document.querySelectorAll(
          '[data-widget="performance"] .overlay-perf__row b'
        )
      )
        .filter((value) => {
          const widget = value.closest("[data-widget]");
          if (!(widget instanceof HTMLElement)) return true;
          const valueRect = value.getBoundingClientRect();
          const widgetRect = widget.getBoundingClientRect();
          return (
            valueRect.left < widgetRect.left ||
            valueRect.right > widgetRect.right ||
            valueRect.width <= 0
          );
        })
        .map((value) => value.textContent?.trim() ?? "unknown");
      const achievementsFilter = document.querySelector(
        '[data-widget="achievements"] .overlay-ach__filters'
      );
      const expectedAchievementFilters = [
        "All",
        "Unlocked",
        "Locked",
        "Hidden",
        "Missable",
      ];
      const achievementFilterLabels = achievementsFilter
        ? Array.from(achievementsFilter.querySelectorAll("button")).map(
            (button) => button.textContent?.trim() ?? ""
          )
        : [];
      const missingAchievementFilters = expectedAchievementFilters.filter(
        (label) => !achievementFilterLabels.includes(label)
      );
      const clippedAchievementFilters = achievementsFilter
        ? Array.from(achievementsFilter.querySelectorAll("button"))
            .filter((button) => {
              const widget = button.closest("[data-widget]");
              if (!(widget instanceof HTMLElement)) return true;
              const buttonRect = button.getBoundingClientRect();
              const widgetRect = widget.getBoundingClientRect();
              return (
                buttonRect.left < widgetRect.left ||
                buttonRect.right > widgetRect.right ||
                buttonRect.top < widgetRect.top ||
                buttonRect.bottom > widgetRect.bottom ||
                buttonRect.width <= 0
              );
            })
            .map((button) => button.textContent?.trim() ?? "unknown")
        : ["missing filter row"];
      const achievementsFilterHasHorizontalScroll =
        achievementsFilter instanceof HTMLElement &&
        achievementsFilter.scrollWidth > achievementsFilter.clientWidth;

      return {
        checked: true,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        viewportHasHorizontalScroll,
        clippedHeaders,
        overlappingHeaderTools,
        clippedPerformanceValues,
        clippedAchievementFilters,
        missingAchievementFilters,
        achievementsFilterHasHorizontalScroll,
      };
    });

    if (
      result.checked &&
      (result.viewportHasHorizontalScroll ||
        result.clippedHeaders.length ||
        result.overlappingHeaderTools.length ||
        result.clippedPerformanceValues.length ||
        result.clippedAchievementFilters.length ||
        result.missingAchievementFilters.length ||
        result.achievementsFilterHasHorizontalScroll)
    ) {
      throw new Error(
        `${label} has clipped compact overlay content: ${JSON.stringify(result)}.`
      );
    }
  };

  const assertWidgetToolsClearHeader = async (label) => {
    const overlaps = await page.evaluate(() => {
      const docks = Array.from(
        document.querySelectorAll(
          ".overlay-header__game, .overlay-header__actions"
        )
      ).map((element) => element.getBoundingClientRect());
      return Array.from(document.querySelectorAll("[data-widget]"))
        .filter((widget) => {
          const tools = widget.querySelector(".overlay-card__tools");
          if (!(tools instanceof HTMLElement)) return true;
          const rect = tools.getBoundingClientRect();
          return docks.some(
            (dock) =>
              rect.left < dock.right &&
              rect.right > dock.left &&
              rect.top < dock.bottom &&
              rect.bottom > dock.top
          );
        })
        .map((widget) => widget.getAttribute("data-widget") ?? "unknown");
    });
    if (overlaps.length) {
      throw new Error(
        `${label} left widget tools under floating header controls: ${overlaps.join(", ")}.`
      );
    }
  };

  const assertOverlayThemeContrast = async () => {
    const themes = [
      {
        name: "dark",
        variables: {
          "--fg-rgb": "255, 255, 255",
          "--bg-rgb": "18, 18, 18",
          "--color-background": "#121212",
          "--color-dark-background": "#080808",
          "--color-text": "#eeeeee",
          "--color-text-bright": "#ffffff",
        },
      },
      {
        name: "light",
        variables: {
          "--fg-rgb": "17, 17, 19",
          "--bg-rgb": "245, 245, 247",
          "--color-background": "#f5f5f7",
          "--color-dark-background": "#ececef",
          "--color-text": "#1c1c1e",
          "--color-text-bright": "#000000",
        },
      },
      {
        name: "custom",
        variables: {
          "--fg-rgb": "250, 250, 250",
          "--bg-rgb": "15, 10, 20",
          "--color-background": "#18131f",
          "--color-dark-background": "#0b0712",
          "--color-text": "#f0edf4",
          "--color-text-bright": "#ffffff",
        },
      },
    ];

    const results = await page.evaluate(async (themeFixtures) => {
      const root = document.documentElement;
      const properties = Array.from(
        new Set(themeFixtures.flatMap((theme) => Object.keys(theme.variables)))
      );
      const original = Object.fromEntries(
        properties.map((property) => [
          property,
          root.style.getPropertyValue(property),
        ])
      );
      const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
      const parseColor = (value) => {
        if (!value || value === "transparent") {
          return { red: 0, green: 0, blue: 0, alpha: 0 };
        }
        const rgb = value.match(
          /^rgba?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:(?:\s*,\s*|\s*\/\s*)([\d.]+))?\s*\)$/i
        );
        if (rgb) {
          return {
            red: Number(rgb[1]),
            green: Number(rgb[2]),
            blue: Number(rgb[3]),
            alpha: rgb[4] === undefined ? 1 : Number(rgb[4]),
          };
        }
        const srgb = value.match(
          /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/i
        );
        if (srgb) {
          return {
            red: Number(srgb[1]) * 255,
            green: Number(srgb[2]) * 255,
            blue: Number(srgb[3]) * 255,
            alpha: srgb[4] === undefined ? 1 : Number(srgb[4]),
          };
        }
        throw new Error(`Unsupported computed color: ${value}`);
      };
      const composite = (foreground, background) => {
        const foregroundAlpha = clamp(foreground.alpha, 0, 1);
        const backgroundAlpha = clamp(background.alpha, 0, 1);
        const alpha = foregroundAlpha + backgroundAlpha * (1 - foregroundAlpha);
        if (!alpha) return { red: 0, green: 0, blue: 0, alpha: 0 };
        const channel = (foregroundValue, backgroundValue) =>
          (foregroundValue * foregroundAlpha +
            backgroundValue * backgroundAlpha * (1 - foregroundAlpha)) /
          alpha;
        return {
          red: channel(foreground.red, background.red),
          green: channel(foreground.green, background.green),
          blue: channel(foreground.blue, background.blue),
          alpha,
        };
      };
      const luminance = (color) => {
        const linear = (channel) => {
          const srgbChannel = clamp(channel, 0, 255) / 255;
          return srgbChannel <= 0.04045
            ? srgbChannel / 12.92
            : Math.pow((srgbChannel + 0.055) / 1.055, 2.4);
        };
        return (
          0.2126 * linear(color.red) +
          0.7152 * linear(color.green) +
          0.0722 * linear(color.blue)
        );
      };
      const ratio = (left, right) => {
        const leftLuminance = luminance(left);
        const rightLuminance = luminance(right);
        return (
          (Math.max(leftLuminance, rightLuminance) + 0.05) /
          (Math.min(leftLuminance, rightLuminance) + 0.05)
        );
      };
      const effectiveAncestorBackground = (element) => {
        const ancestors = [];
        let current = element.parentElement;
        while (current) {
          ancestors.unshift(current);
          current = current.parentElement;
        }
        return ancestors.reduce(
          (background, ancestor) =>
            composite(
              parseColor(getComputedStyle(ancestor).backgroundColor),
              background
            ),
          { red: 0, green: 0, blue: 0, alpha: 1 }
        );
      };
      const renderedContrast = (element) => {
        const style = getComputedStyle(element);
        const parentBackground = effectiveAncestorBackground(element);
        const localBackground = composite(
          parseColor(style.backgroundColor),
          parentBackground
        );
        const localText = composite(parseColor(style.color), localBackground);
        const opacity = clamp(Number(style.opacity || 1), 0, 1);
        const renderedBackground = composite(
          { ...localBackground, alpha: opacity },
          parentBackground
        );
        const renderedText = composite(
          { ...localText, alpha: opacity },
          parentBackground
        );
        return ratio(renderedText, renderedBackground);
      };

      try {
        const themeResults = [];
        for (const theme of themeFixtures) {
          for (const [property, value] of Object.entries(theme.variables)) {
            root.style.setProperty(property, value);
          }
          // Chromium can retain a resolved descendant color for the remainder
          // of a synchronous task when only an inherited custom-property input
          // changes. Let style/layout settle exactly as it does during a real
          // runtime theme switch before sampling computed contrast.
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );
          await new Promise((resolve) => setTimeout(resolve, 150));
          const sampleDefinitions = [
            ["header metadata", ".overlay-header__meta"],
            ["widget metadata", ".overlay-card__count"],
            [
              "widget options",
              ".overlay-widget__options-trigger:not(:disabled)",
            ],
            ["widget resize tool", ".overlay-widget__resize:not(:disabled)"],
            ["Spotify play control", ".spotify-overlay-panel__play-button"],
          ];
          const activeSamples = sampleDefinitions.map(([sample, selector]) => {
            const element = document.querySelector(selector);
            if (!(element instanceof HTMLElement)) {
              throw new Error(`Contrast fixture could not find ${sample}.`);
            }
            return {
              sample,
              ratio: renderedContrast(element),
              minimum: 4.5,
              computed: {
                color: getComputedStyle(element).color,
                backgroundColor: getComputedStyle(element).backgroundColor,
                opacity: getComputedStyle(element).opacity,
                foregroundRgb:
                  getComputedStyle(element).getPropertyValue("--fg-rgb"),
                faintColor:
                  getComputedStyle(element).getPropertyValue(
                    "--color-text-faint"
                  ),
                parentBackgroundColor: element.parentElement
                  ? getComputedStyle(element.parentElement).backgroundColor
                  : null,
                cardBackgroundColor: element.closest(".overlay-card")
                  ? getComputedStyle(element.closest(".overlay-card"))
                      .backgroundColor
                  : null,
              },
            };
          });
          const tool = document.querySelector(
            ".overlay-widget__options-trigger:not(:disabled)"
          );
          if (!(tool instanceof HTMLButtonElement)) {
            throw new Error(
              "Contrast fixture could not disable a widget tool."
            );
          }
          tool.disabled = true;
          const disabled = {
            sample: "disabled widget tool",
            ratio: renderedContrast(tool),
            minimum: 3,
          };
          tool.disabled = false;
          themeResults.push(
            ...[...activeSamples, disabled].map((sample) => ({
              theme: theme.name,
              ...sample,
            }))
          );
        }
        return themeResults;
      } finally {
        for (const [property, value] of Object.entries(original)) {
          if (value) root.style.setProperty(property, value);
          else root.style.removeProperty(property);
        }
      }
    }, themes);

    const failures = results.filter((result) => result.ratio < result.minimum);
    if (failures.length) {
      throw new Error(
        `Overlay computed contrast regression: ${JSON.stringify(failures)}.`
      );
    }
    return results;
  };

  await page.addInitScript(
    ({ platform }) => {
      window.localStorage.removeItem("gamehub.overlay.layout.v4");
      window.localStorage.setItem("gamehub.overlay.layout-locked.v1", "false");
      window.localStorage.setItem(
        "gamehub.overlay.layout.v3",
        JSON.stringify({
          friends: {
            x: 1,
            y: 0.18,
            z: 4,
            width: 0.21,
            height: 0.31,
            visible: true,
          },
          mixer: {
            x: 1,
            y: 0.48,
            z: 5,
            width: 0.21,
            height: 0.28,
            visible: true,
          },
        })
      );
      const qaGamepad = {
        id: "GameHub Playwright standard controller",
        index: 0,
        connected: true,
        mapping: "standard",
        timestamp: 0,
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({
          pressed: false,
          touched: false,
          value: 0,
        })),
        vibrationActuator: null,
      };
      window.__qaGamepad = qaGamepad;
      window.__qaGamepadPollCount = 0;
      window.__setQaGamepadButton = (index, pressed) => {
        qaGamepad.buttons[index] = {
          pressed,
          touched: pressed,
          value: pressed ? 1 : 0,
        };
        qaGamepad.timestamp = performance.now();
      };
      window.__setQaGamepadAxis = (index, value) => {
        qaGamepad.axes[index] = value;
        qaGamepad.timestamp = performance.now();
      };
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => {
          window.__qaGamepadPollCount += 1;
          return [qaGamepad, null, null, null];
        },
      });
      const achievementIcon =
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#171717"/><path d="M20 16h24v8c0 9-5 15-12 18-7-3-12-9-12-18v-8Zm12 26v7m-9 0h18" fill="none" stroke="#f4f4f4" stroke-width="4" stroke-linecap="round"/></svg>'
        );
      const discordIcon =
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#5865f2"/><path d="M20 20c8-4 16-4 24 0 4 6 6 13 5 21-4 4-8 6-12 7l-3-4c2 0 4-1 6-2-6 3-12 3-18 0 2 1 4 2 6 2l-3 4c-4-1-8-3-12-7-1-8 1-15 5-21Z" fill="#fff"/><circle cx="25" cy="33" r="3" fill="#5865f2"/><circle cx="39" cy="33" r="3" fill="#5865f2"/></svg>'
        );
      const obsIcon =
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#161616"/><circle cx="32" cy="32" r="22" fill="none" stroke="#f4f4f4" stroke-width="3"/><path d="M31 11c8 5 11 11 8 18-2 5-7 7-13 6 5-4 7-8 5-13-2-4-5-7-9-8 3-2 6-3 9-3Zm19 28c-8 4-15 4-20-2-4-4-3-9 0-14 1 6 4 9 9 10 5 0 9-1 12-4 1 3 1 7-1 10ZM18 48c0-9 4-15 11-16 5-1 9 2 12 7-6-2-10-1-13 3-3 4-4 8-2 13-3-1-6-4-8-7Z" fill="#f4f4f4"/></svg>'
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
        user: {
          displayName: "Kenneth",
          profileImageUrl: null,
        },
        achievements: [
          {
            name: "first_step",
            displayName: "A Warrior Reborn",
            description: "Complete the opening battle.",
            icon: achievementIcon,
            icongray: achievementIcon,
            hidden: false,
            unlocked: true,
            unlockTime: now - 3_000_000,
          },
          {
            name: "edge_of_death",
            displayName: "At Death's Door",
            description: "Defeat a boss with less than 10% vitality.",
            icon: achievementIcon,
            icongray: achievementIcon,
            hidden: false,
            missable: true,
            unlocked: true,
            unlockTime: now - 600_000,
          },
          {
            name: "mastery",
            displayName: "Weapon Mastery",
            description: "Unlock every skill in one weapon tree.",
            icon: achievementIcon,
            icongray: achievementIcon,
            hidden: false,
            unlocked: false,
            unlockTime: null,
          },
          {
            name: "secret_ending",
            displayName: "A Crown in Shadow",
            description: "Discover the hidden ending.",
            icon: achievementIcon,
            icongray: achievementIcon,
            hidden: true,
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
      let recorderState = {
        status: "buffering",
        configuration: {
          enabled: true,
          resolution: "1080p",
          fps: 60,
          qualityPreset: "quality",
          instantReplayEnabled: true,
          replayDurationSeconds: 30,
          captureGameAudio: platform === "win32",
          outputDirectory: null,
        },
        resolvedOutputDirectory:
          platform === "win32"
            ? "C:\\Users\\Player\\Videos\\GameHub"
            : "/home/player/Videos/GameHub",
        desktopCaptureAvailable: true,
        systemAudioCaptureAvailable: platform === "win32",
        recordingStartedAt: null,
        bufferedSeconds: 30,
        captureActive: true,
        hardwareVideoEncodingAvailable: true,
        captureDiagnostics: {
          mimeType: 'video/mp4;codecs="avc1.640034,mp4a.40.2"',
          outputWidth: 1920,
          outputHeight: 1080,
          outputFps: 59.94,
          encodedFps: 59.7,
          targetVideoBitrate: 55_987_200,
          recentEncodedBitrate: 24_600_000,
          hasAudio: platform === "win32",
        },
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
        playbackId: 1,
        preloadedNextIndex: 1,
        preloadedAudioUrl: "https://example.invalid/preloaded-track",
        preloadedAudioSource: "youtube",
        volume: 0.8,
        muted: false,
        seekId: 0,
      };
      const spotifyCover =
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1ed760"/><stop offset=".48" stop-color="#163c25"/><stop offset="1" stop-color="#080808"/></linearGradient></defs><rect width="320" height="320" fill="url(#g)"/><circle cx="160" cy="160" r="82" fill="#080808" fill-opacity=".82"/><circle cx="160" cy="160" r="22" fill="#1ed760"/><path d="M64 238c52-31 116-42 192-16" fill="none" stroke="#f4f4f4" stroke-opacity=".8" stroke-width="10" stroke-linecap="round"/></svg>'
        );
      const spotifyTrack = {
        id: "spotify-track-1",
        uri: "spotify:track:spotify-track-1",
        type: "track",
        title: "Nocturne in Black",
        subtitle: "The GameHub Sessions",
        description: null,
        imageUrl: spotifyCover,
        externalUrl: "https://open.spotify.com/track/spotify-track-1",
        durationMs: 238_000,
        itemCount: null,
        contextUri: "spotify:album:gamehub-sessions",
        playable: true,
        explicit: false,
      };
      const spotifyPlaylist = {
        id: "spotify-playlist-1",
        uri: "spotify:playlist:spotify-playlist-1",
        type: "playlist",
        title: "Boss Fight Focus",
        subtitle: "Kenneth",
        description: "High-intensity tracks for the next encounter.",
        imageUrl: spotifyCover,
        externalUrl: "https://open.spotify.com/playlist/spotify-playlist-1",
        durationMs: null,
        itemCount: 42,
        contextUri: "spotify:playlist:spotify-playlist-1",
        playable: true,
        explicit: false,
      };
      const spotifyEpisode = {
        id: "spotify-episode-1",
        uri: "spotify:episode:spotify-episode-1",
        type: "episode",
        title: "How combat systems create flow",
        subtitle: "Game Design Radio",
        description: "A conversation about responsive action games.",
        imageUrl: spotifyCover,
        externalUrl: "https://open.spotify.com/episode/spotify-episode-1",
        durationMs: 2_760_000,
        itemCount: null,
        contextUri: "spotify:show:game-design-radio",
        playable: true,
        explicit: false,
      };
      const spotifyPage = (items) => ({
        items,
        total: items.length,
        limit: 50,
        offset: 0,
        nextOffset: null,
      });
      const spotifyPlayback = {
        isPlaying: true,
        progressMs: 96_000,
        repeatState: "off",
        shuffleState: false,
        contextUri: spotifyPlaylist.uri,
        item: spotifyTrack,
        device: {
          id: "spotify-device-1",
          name: "Kenneth's PC",
          type: "Computer",
          isActive: true,
          isPrivateSession: false,
          isRestricted: false,
          volumePercent: 72,
          supportsVolume: true,
        },
        disallows: [],
      };
      const spotifyHome = {
        forYou: [spotifyTrack, spotifyPlaylist],
        playlists: spotifyPage([spotifyPlaylist]),
        savedTracks: spotifyPage([spotifyTrack]),
        savedShows: spotifyPage([]),
        savedEpisodes: spotifyPage([spotifyEpisode]),
        topTracks: spotifyPage([spotifyTrack]),
        recentTracks: spotifyPage([spotifyTrack]),
      };
      let userPreferences = {
        language: "en",
        themeMode: "dark",
        musicProvider: "spotify",
      };

      const listeners = () => () => undefined;
      const overlayListeners = new Map();
      const subscribeOverlay = (channel) => (callback) => {
        const callbacks = overlayListeners.get(channel) ?? new Set();
        callbacks.add(callback);
        overlayListeners.set(channel, callbacks);
        return () => callbacks.delete(callback);
      };
      window.__emitOverlayEvent = (channel, ...args) => {
        for (const callback of overlayListeners.get(channel) ?? []) {
          callback(...args);
        }
      };
      window.__overlayContextDelayMs = 0;
      window.__overlayRendererReadyCount = 0;
      const api = {
        platform,
        isWayland: false,
        getVersion: async () => "1.1.20",
        isStaging: async () => false,
        updateUserPreferences: async (preferences) => {
          userPreferences = { ...userPreferences, ...preferences };
          if (preferences.gameRecorderReplayDurationSeconds) {
            recorderState = {
              ...recorderState,
              configuration: {
                ...recorderState.configuration,
                replayDurationSeconds:
                  preferences.gameRecorderReplayDurationSeconds,
              },
            };
          }
        },
        onCustomThemeUpdated: listeners,
        onUserPreferencesUpdated: listeners,
        leveldb: {
          get: async (key) =>
            key === "userPreferences" ? userPreferences : null,
          put: async () => undefined,
          del: async () => undefined,
          clear: async () => undefined,
          values: async () => [],
          iterator: async () => [],
        },
        getLibrary: async () => [],
        getOverlayContext: async () => {
          if (window.__overlayContextDelayMs) {
            await new Promise((resolve) =>
              setTimeout(resolve, window.__overlayContextDelayMs)
            );
          }
          return context;
        },
        overlayRendererReady: async () => {
          window.__overlayRendererReadyCount += 1;
        },
        getOverlayNote: async () =>
          "Boss phase two: dodge inward, then punish the overhead swing.",
        saveOverlayNote: async () => undefined,
        closeHydraOverlay: async () => undefined,
        setOverlayPerformancePinned: async () => undefined,
        onOverlayMode: subscribeOverlay("mode"),
        onOverlayShown: subscribeOverlay("shown"),
        onOverlayPerformance: listeners,
        onOverlayPerformancePin: listeners,
        onOverlayGamepadAction: (callback) => {
          window.__emitOverlayGamepad = callback;
          return () => {
            delete window.__emitOverlayGamepad;
          };
        },
        getActiveGameProcessState: async () => ({
          status: "running",
          shop: "steam",
          objectId: context.game.objectId,
          gameTitle: context.game.title,
          rootPid: 8420,
          processCount: 2,
          canPause: true,
          canResume: false,
          canClose: true,
          message: null,
          updatedAt: Date.now(),
        }),
        onGameProcessControlState: listeners,
        pauseActiveGame: async () => undefined,
        resumeActiveGame: async () => undefined,
        closeActiveGame: async () => undefined,
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
        onMusicState: listeners,
        musicGetPlaylists: async () => [],
        musicSearch: async () => [],
        musicRefreshCurrent: async () => undefined,
        musicSetVolume: async () => undefined,
        musicSeek: async () => undefined,
        spotifyGetStatus: async () => ({
          configured: true,
          connected: true,
          redirectUri: "http://127.0.0.1/callback",
          scopes: [],
          secureStorage: "available",
          account: {
            id: "spotify-account-1",
            displayName: "Kenneth",
            imageUrl: null,
            externalUrl: "https://open.spotify.com/user/spotify-account-1",
          },
          authorizedAt: Date.now() - 86_400_000,
          reauthorizationAt: Date.now() + 150 * 86_400_000,
          needsReauth: false,
          lastError: null,
        }),
        spotifyGetPlayback: async () => ({
          ok: true,
          data: spotifyPlayback,
        }),
        spotifyGetDevices: async () => ({
          ok: true,
          data: [spotifyPlayback.device],
        }),
        spotifyGetQueue: async () => ({
          ok: true,
          data: {
            currentlyPlaying: spotifyTrack,
            queue: Array.from({ length: 18 }, (_, index) => ({
              ...(index % 3 === 0 ? spotifyEpisode : spotifyTrack),
              uri: `${index % 3 === 0 ? spotifyEpisode.uri : spotifyTrack.uri}:qa-${index}`,
              title: `${index % 3 === 0 ? spotifyEpisode.title : spotifyTrack.title} ${index + 1}`,
            })),
          },
        }),
        spotifyGetHome: async () => ({
          ok: true,
          data: spotifyHome,
        }),
        spotifySearch: async () => ({
          ok: true,
          data: {
            tracks: spotifyPage([spotifyTrack]),
            playlists: spotifyPage([spotifyPlaylist]),
            shows: spotifyPage([]),
            episodes: spotifyPage([spotifyEpisode]),
          },
        }),
        spotifyGetPlaylistItems: async () => ({
          ok: true,
          data: spotifyPage([spotifyTrack, spotifyEpisode]),
        }),
        spotifyPlaybackCommand: async () => ({ ok: true, data: true }),
        spotifySetSaved: async () => ({ ok: true, data: true }),
        spotifyLibraryContains: async (uris) => ({
          ok: true,
          data: Object.fromEntries(uris.map((uri) => [uri, true])),
        }),
        spotifyOpenSettings: async () => undefined,
        spotifyControl: async () => true,
        spotifyGetNowPlaying: async () => ({
          isPlaying: true,
          trackName: spotifyTrack.title,
          artists: spotifyTrack.subtitle,
          albumName: "GameHub Sessions",
          albumImageUrl: spotifyCover,
          durationMs: spotifyTrack.durationMs,
          progressMs: spotifyPlayback.progressMs,
          trackUrl: spotifyTrack.externalUrl,
          deviceName: spotifyPlayback.device.name,
          contentType: "track",
          uri: spotifyTrack.uri,
        }),
        openExternal: async () => undefined,
        getPinnedApps: async () => [
          {
            name: "Discord",
            path: "C:\\Apps\\Discord.exe",
            iconUrl: discordIcon,
          },
          {
            name: "OBS Studio",
            path: "C:\\Apps\\obs64.exe",
            iconUrl: obsIcon,
          },
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
        hydraApi: {
          get: async () => ({
            friends: [
              {
                id: "friend-1",
                displayName: "Nova",
                profileImageUrl: null,
                isOnline: true,
                currentGame: { title: "Hades II" },
              },
              {
                id: "friend-2",
                displayName: "Valkyrie",
                profileImageUrl: null,
                isOnline: true,
                currentGame: null,
              },
              {
                id: "friend-3",
                displayName: "Ash",
                profileImageUrl: null,
                isOnline: false,
                currentGame: null,
              },
            ],
          }),
        },
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
    },
    { platform: process.platform }
  );

  const rendererUrl = pathToFileURL(renderer).href;
  await page.goto(`${rendererUrl}#/`);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.location.hash = "#/overlay";
  });
  try {
    await page.waitForSelector(".overlay--full", { timeout: 30_000 });
  } catch (error) {
    const navigationState = await page.evaluate(() => ({
      hash: window.location.hash,
      text: document.body.textContent?.replace(/\s+/g, " ").trim() ?? "",
    }));
    throw new Error(
      `Overlay route did not render after preference preloading. ` +
        `State: ${JSON.stringify(navigationState)}. ` +
        `Page errors: ${JSON.stringify(pageErrors)}.`,
      { cause: error }
    );
  }
  await page.waitForSelector('[data-widget="capture"]', { timeout: 10_000 });
  try {
    await page.waitForSelector(".spotify-overlay-panel__now-playing", {
      timeout: 10_000,
    });
  } catch (error) {
    const musicWidgetState = await page
      .locator('[data-widget="music"]')
      .evaluate((element) => ({
        className: element.className,
        text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
      }))
      .catch(() => null);
    throw new Error(
      `Spotify now-playing fixture did not render. ` +
        `Music widget: ${JSON.stringify(musicWidgetState)}. ` +
        `Page errors: ${JSON.stringify(pageErrors)}.`,
      { cause: error }
    );
  }
  await page.waitForTimeout(1_000);

  if (process.env.GAMEHUB_BACKGROUND_QA === "true") {
    // Explicit renderer-input fixture. This does not test real game focus or
    // native controller hardware, and never takes over the user's desktop.
    await page.evaluate(() => {
      Object.defineProperty(document, "hasFocus", {
        configurable: true,
        value: () => true,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
    });
  }

  const pulseBrowserGamepadButton = async (buttonIndex) => {
    await page.evaluate(
      (index) => window.__setQaGamepadButton?.(index, true),
      buttonIndex
    );
    await page.waitForTimeout(85);
    await page.evaluate(
      (index) => window.__setQaGamepadButton?.(index, false),
      buttonIndex
    );
    await page.waitForTimeout(110);
  };

  const pulseBrowserGamepadAxis = async (axisIndex, value) => {
    await page.evaluate(
      ({ index, nextValue }) => window.__setQaGamepadAxis?.(index, nextValue),
      { index: axisIndex, nextValue: value }
    );
    await page.waitForTimeout(85);
    await page.evaluate(
      (index) => window.__setQaGamepadAxis?.(index, 0),
      axisIndex
    );
    await page.waitForTimeout(110);
  };

  const restoreDefaultOverlayLayout = async () => {
    await page.getByRole("button", { name: "Reset widget layout" }).click();
    await page.waitForSelector(
      '#overlay-reset-layout-dialog[aria-modal="true"]'
    );
    await page.waitForFunction(
      () => document.activeElement?.id === "overlay-reset-layout-cancel",
      undefined,
      { timeout: 2_000 }
    );
    await page.getByRole("button", { name: "Restore defaults" }).click();
    await page.waitForSelector("#overlay-reset-layout-dialog", {
      state: "detached",
    });
  };

  // Exercise the already-warmed BrowserWindow twice. The renderer receives a
  // deliberately slow context refresh on each show; cached content must stay
  // painted, and Electron must not emit an uncommanded hide between shows.
  await page.evaluate(() => {
    window.__overlayContextDelayMs = 250;
    window.__overlayDomVisibility = [
      document.querySelector(".overlay--full") ? "visible" : "hidden",
    ];
    let previous = window.__overlayDomVisibility[0];
    window.__overlayDomObserver = new MutationObserver(() => {
      const next = document.querySelector(".overlay--full")
        ? "visible"
        : "hidden";
      if (next !== previous) {
        window.__overlayDomVisibility.push(next);
        previous = next;
      }
    });
    window.__overlayDomObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });

  const activateOverlaySurface = async (label, screenshotPath) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) throw new Error("Overlay test window is missing.");
      if (!globalThis.__overlayVisibilityRecorderInstalled) {
        globalThis.__overlayVisibilityRecorderInstalled = true;
        win.on("show", () =>
          globalThis.__overlayVisibilityTransitions?.push("visible")
        );
        win.on("hide", () =>
          globalThis.__overlayVisibilityTransitions?.push("hidden")
        );
      }
      win.hide();
      globalThis.__overlayVisibilityTransitions = [];
      win.show();
    });
    await page.evaluate(() => window.__emitOverlayEvent("shown"));
    await page.waitForTimeout(800);
    const [surfaceTransitions, domTransitions, visible] = await Promise.all([
      electronApp.evaluate(
        () => globalThis.__overlayVisibilityTransitions ?? []
      ),
      page.evaluate(() => window.__overlayDomVisibility),
      electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.isVisible()
      ),
    ]);
    if (!visible || surfaceTransitions.join(",") !== "visible") {
      throw new Error(
        `${label} blinked at the BrowserWindow layer: ${JSON.stringify(surfaceTransitions)}.`
      );
    }
    if (domTransitions.includes("hidden")) {
      throw new Error(
        `${label} removed the painted overlay while refreshing: ${JSON.stringify(domTransitions)}.`
      );
    }
    await assertCompactOverlayLegibility(label);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await page.evaluate(() => {
      window.__overlayDomVisibility = ["visible"];
    });
    return { surfaceTransitions, domTransitions };
  };

  const firstOpenTransitions = await activateOverlaySurface(
    "First overlay open",
    firstOpenOutput
  );
  const secondOpenTransitions = await activateOverlaySurface(
    "Second overlay open",
    secondOpenOutput
  );
  await page.evaluate(() => {
    window.__overlayContextDelayMs = 0;
    window.__overlayDomObserver?.disconnect();
  });

  const localClockValues = page.locator(".overlay-header__clock time");
  if ((await localClockValues.count()) !== 2) {
    throw new Error("Session pill is missing the local clock or calendar.");
  }

  const [migratedFriends, migratedMixer] = await Promise.all([
    page.locator('[data-widget="friends"]').boundingBox(),
    page.locator('[data-widget="mixer"]').boundingBox(),
  ]);
  if (!migratedFriends || !migratedMixer) {
    throw new Error("Friends or volume mixer widget is missing.");
  }
  if (
    migratedFriends.x < migratedMixer.x + migratedMixer.width &&
    migratedFriends.x + migratedFriends.width > migratedMixer.x &&
    migratedFriends.y < migratedMixer.y + migratedMixer.height &&
    migratedFriends.y + migratedFriends.height > migratedMixer.y
  ) {
    throw new Error(
      "The v3 layout migration left Friends and volume mixer overlapping."
    );
  }

  await page.getByRole("button", { name: "Widgets" }).click();
  const widgetToggles = page.locator(
    "#overlay-widget-menu input[type=checkbox]"
  );
  const widgetToggleCount = await widgetToggles.count();
  if (widgetToggleCount !== 8) {
    throw new Error(
      "Widget visibility menu does not expose all eight widgets."
    );
  }
  const notesToggle = page
    .locator("#overlay-widget-menu label")
    .filter({ hasText: "Notes" })
    .locator("input");
  await notesToggle.uncheck();
  if (await page.locator('[data-widget="notes"]').count()) {
    throw new Error("Notes widget did not hide.");
  }
  await notesToggle.check();
  await page.waitForSelector('[data-widget="notes"]');
  await page.getByRole("button", { name: "Widgets" }).click();

  if (await page.locator(".spotify-overlay-panel__volume-popover").count()) {
    throw new Error("Spotify volume slider should be collapsed by default.");
  }
  await page.locator(".overlay-mixer__adjust").first().click();
  const mixerSlider = page.locator(".overlay-mixer__slider").first();
  await mixerSlider.focus();
  await page.evaluate(() => window.__emitOverlayGamepad?.("accept"));
  await page.evaluate(() => window.__emitOverlayGamepad?.("right"));
  await page.evaluate(() => window.__emitOverlayGamepad?.("accept"));
  if ((await mixerSlider.inputValue()) !== "84") {
    throw new Error("Controller range edit mode did not adjust mixer volume.");
  }

  const activeSpotifyTab = page.locator(
    '.spotify-overlay-panel__tab[aria-selected="true"]'
  );
  await activeSpotifyTab.focus();
  await page.evaluate(() => window.__emitOverlayGamepad?.("next-tab"));
  if (
    !(
      await page
        .locator(".spotify-overlay-panel__tab")
        .filter({ hasText: "Search" })
        .getAttribute("aria-selected")
    )?.includes("true")
  ) {
    throw new Error(
      "Controller shoulder navigation did not switch Spotify tabs."
    );
  }
  await page.evaluate(() => window.__emitOverlayGamepad?.("previous-tab"));

  const captureBefore = await page
    .locator('[data-widget="capture"]')
    .boundingBox();
  const resizeHandle = await page
    .locator('[data-widget="capture"] .overlay-widget__resize')
    .boundingBox();
  if (!captureBefore || !resizeHandle)
    throw new Error("Resize handle missing.");
  await page.mouse.move(
    resizeHandle.x + resizeHandle.width / 2,
    resizeHandle.y + resizeHandle.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(resizeHandle.x + 90, resizeHandle.y + 55, {
    steps: 5,
  });
  await page.mouse.up();
  await page.waitForFunction(
    ({ previousWidth }) => {
      const widget = document.querySelector('[data-widget="capture"]');
      return (
        widget instanceof HTMLElement &&
        widget.getBoundingClientRect().width > previousWidth + 20
      );
    },
    { previousWidth: captureBefore.width },
    { timeout: 2_000 }
  );
  const captureAfter = await page
    .locator('[data-widget="capture"]')
    .boundingBox();
  if (!captureAfter || captureAfter.width <= captureBefore.width + 20) {
    throw new Error("Capture widget did not resize.");
  }
  const resizeOriginTolerance = 2;
  if (
    Math.abs(captureAfter.x - captureBefore.x) > resizeOriginTolerance ||
    Math.abs(captureAfter.y - captureBefore.y) > resizeOriginTolerance
  ) {
    throw new Error(
      `Capture resize moved its top-left origin from ` +
        `${captureBefore.x},${captureBefore.y} to ` +
        `${captureAfter.x},${captureAfter.y}.`
    );
  }

  const friendsBefore = await page
    .locator('[data-widget="friends"]')
    .boundingBox();
  const friendsGrabber = await page
    .locator('[data-widget="friends"] .overlay-card__title')
    .boundingBox();
  if (!friendsBefore || !friendsGrabber) {
    throw new Error("Friends widget drag handle is not reachable.");
  }
  await page.mouse.move(
    friendsGrabber.x + friendsGrabber.width / 2,
    friendsGrabber.y + friendsGrabber.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(friendsGrabber.x - 80, friendsGrabber.y + 35, {
    steps: 5,
  });
  await page.mouse.up();
  await page.waitForFunction(
    ({ previousX }) => {
      const widget = document.querySelector('[data-widget="friends"]');
      return (
        widget instanceof HTMLElement &&
        widget.getBoundingClientRect().x < previousX - 30
      );
    },
    { previousX: friendsBefore.x },
    { timeout: 2_000 }
  );
  const friendsAfter = await page
    .locator('[data-widget="friends"]')
    .boundingBox();
  if (!friendsAfter || friendsAfter.x >= friendsBefore.x - 30) {
    throw new Error("Friends widget could not be dragged.");
  }

  const mixerIconContrast = await page
    .locator(".overlay-mixer__mute")
    .first()
    .evaluate((button) => {
      const style = getComputedStyle(button);
      return {
        foreground: style.color,
        background: style.backgroundColor,
      };
    });
  if (mixerIconContrast.foreground === mixerIconContrast.background) {
    throw new Error("Volume mixer icon has no contrast.");
  }

  await restoreDefaultOverlayLayout();

  const [friendsDefault, mixerDefault] = await Promise.all([
    page.locator('[data-widget="friends"]').boundingBox(),
    page.locator('[data-widget="mixer"]').boundingBox(),
  ]);
  if (!friendsDefault || !mixerDefault) {
    throw new Error("Friends or volume mixer widget is missing.");
  }
  const friendsMixerOverlap =
    friendsDefault.x < mixerDefault.x + mixerDefault.width &&
    friendsDefault.x + friendsDefault.width > mixerDefault.x &&
    friendsDefault.y < mixerDefault.y + mixerDefault.height &&
    friendsDefault.y + friendsDefault.height > mixerDefault.y;
  if (friendsMixerOverlap) {
    throw new Error("Friends and volume mixer overlap in the default layout.");
  }

  for (const compactViewport of [
    { width: 1280, height: 720 },
    { width: 900, height: 640 },
  ]) {
    await electronApp.evaluate(({ BrowserWindow }, viewport) => {
      BrowserWindow.getAllWindows()[0]?.setSize(
        viewport.width,
        viewport.height
      );
    }, compactViewport);
    await page.waitForFunction(
      (viewport) =>
        window.innerWidth === viewport.width &&
        window.innerHeight === viewport.height,
      compactViewport,
      { timeout: 5_000 }
    );
    await restoreDefaultOverlayLayout();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    await assertWidgetToolsClearHeader(
      `Compact ${compactViewport.width}x${compactViewport.height}`
    );
    const spotifyContentSpace = await page
      .locator('[data-widget="music"]')
      .evaluate((widget) => {
        const widgetRect = widget.getBoundingClientRect();
        const tabs = widget
          .querySelector(".spotify-overlay-panel__tabs")
          ?.getBoundingClientRect();
        const footer = widget
          .querySelector(".spotify-overlay-panel__footer")
          ?.getBoundingClientRect();
        return tabs ? (footer?.top ?? widgetRect.bottom) - tabs.bottom : 0;
      });
    if (spotifyContentSpace < 48)
      throw new Error(
        `Spotify content has only ${spotifyContentSpace}px at ${compactViewport.width}x${compactViewport.height}: ${JSON.stringify(await page.locator('[data-widget="music"]').evaluate((widget) => [...widget.querySelectorAll(".spotify-overlay-panel, .spotify-overlay-panel > *, .spotify-overlay-panel__now-playing > *")].map((element) => ({ class: element.className, rect: element.getBoundingClientRect().toJSON(), display: getComputedStyle(element).display, grid: getComputedStyle(element).gridTemplateColumns }))))}`
      );

    const compactWidgetLayout = await page
      .locator("[data-widget]")
      .evaluateAll((widgets) =>
        widgets.map((widget) => {
          const rect = widget.getBoundingClientRect();
          return {
            id: widget.getAttribute("data-widget") ?? "unknown",
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          };
        })
      );
    if (compactWidgetLayout.length !== 8) {
      throw new Error(
        `Expected all eight widgets at ${compactViewport.width}x${
          compactViewport.height
        }, found ${compactWidgetLayout.length}.`
      );
    }
    const compactOverlaps = [];
    for (
      let leftIndex = 0;
      leftIndex < compactWidgetLayout.length;
      leftIndex++
    ) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < compactWidgetLayout.length;
        rightIndex++
      ) {
        const left = compactWidgetLayout[leftIndex];
        const right = compactWidgetLayout[rightIndex];
        const overlapWidth =
          Math.min(left.right, right.right) - Math.max(left.left, right.left);
        const overlapHeight =
          Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
        if (overlapWidth > 1 && overlapHeight > 1) {
          compactOverlaps.push(
            `${left.id}/${right.id} (${Math.round(overlapWidth)}x${Math.round(
              overlapHeight
            )})`
          );
        }
      }
    }
    if (compactOverlaps.length) {
      throw new Error(
        `Default widgets overlap at ${compactViewport.width}x${
          compactViewport.height
        }: ${compactOverlaps.join(", ")}. ` +
          `Bounds: ${JSON.stringify(compactWidgetLayout)}.`
      );
    }
    if (compactViewport.width === 1280) {
      await page.screenshot({
        path: controllerCompactOutput,
        fullPage: true,
      });
    }
  }

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1920, 1080);
  });
  await page.waitForFunction(
    () => window.innerWidth === 1920 && window.innerHeight === 1080,
    undefined,
    { timeout: 5_000 }
  );
  await restoreDefaultOverlayLayout();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
  await assertWidgetToolsClearHeader("Full HD default layout");

  const friendsCornerMoveHandle = await page
    .locator('[data-widget="friends"] .overlay-card__title')
    .boundingBox();
  if (!friendsCornerMoveHandle) {
    throw new Error("Friends move handle is missing for corner recovery QA.");
  }
  await page.mouse.move(
    friendsCornerMoveHandle.x + friendsCornerMoveHandle.width / 2,
    friendsCornerMoveHandle.y + friendsCornerMoveHandle.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(1_910, 10, { steps: 6 });
  await page.mouse.up();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
  await assertWidgetToolsClearHeader("Full HD top-right recovery");
  await restoreDefaultOverlayLayout();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );

  const contrastResults = await assertOverlayThemeContrast();

  const pinnedIconCount = await page
    .locator('[data-widget="quick-launch"] .overlay-pin-tile__icon')
    .count();
  if (pinnedIconCount !== 2) {
    throw new Error("Pinned apps did not render their resolved icons.");
  }

  const replayLength = page.getByRole("button", {
    name: "Instant Replay length",
  });

  // The in-overlay listbox must work without an OS popup. Verify its keyboard
  // path first, including focus moving into the portaled option list.
  await replayLength.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".overlay-select__list");
  await page.waitForFunction(() =>
    document.activeElement?.classList.contains("overlay-select__option")
  );
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "Last 45 seconds"
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document
        .querySelector(".overlay-capture__replay .overlay-select__value")
        ?.textContent?.trim() === "Last 45 seconds"
  );
  await page.waitForFunction(() => {
    const capture = document.querySelector('[data-widget="capture"]');
    return (
      capture?.textContent?.includes("30s of 45s buffered") &&
      capture?.textContent?.includes("Save 30s available") &&
      capture?.textContent?.includes("Buffering Instant Replay")
    );
  });

  // Tab/Shift+Tab close the portaled list and hand focus to the logical control
  // after/before the trigger instead of leaving focus on an unmounted option.
  await replayLength.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".overlay-select__list");
  await page.waitForFunction(() =>
    document.activeElement?.classList.contains("overlay-select__option")
  );
  await page.keyboard.press("Tab");
  await page.waitForSelector(".overlay-select__list", { state: "detached" });
  await page.waitForFunction(() => {
    const active = document.activeElement;
    return (
      active instanceof HTMLElement &&
      active !== document.body &&
      active.getAttribute("aria-label") !== "Instant Replay length"
    );
  });
  const tabHandoff = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    isTrigger:
      document.activeElement?.getAttribute("aria-label") ===
      "Instant Replay length",
  }));
  if (!tabHandoff.tag || tabHandoff.tag === "BODY" || tabHandoff.isTrigger) {
    throw new Error(
      `Overlay select Tab did not hand focus forward: ${JSON.stringify(tabHandoff)}.`
    );
  }
  await replayLength.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".overlay-select__list");
  await page.waitForFunction(() =>
    document.activeElement?.classList.contains("overlay-select__option")
  );
  await page.keyboard.press("Shift+Tab");
  await page.waitForSelector(".overlay-select__list", { state: "detached" });
  await page.waitForFunction(() => {
    const active = document.activeElement;
    return (
      active instanceof HTMLElement &&
      active !== document.body &&
      active.getAttribute("aria-label") !== "Instant Replay length"
    );
  });
  const reverseTabHandoff = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    isTrigger:
      document.activeElement?.getAttribute("aria-label") ===
      "Instant Replay length",
  }));
  if (
    !reverseTabHandoff.tag ||
    reverseTabHandoff.tag === "BODY" ||
    reverseTabHandoff.isTrigger
  ) {
    throw new Error(
      `Overlay select Shift+Tab did not hand focus backward: ${JSON.stringify(reverseTabHandoff)}.`
    );
  }

  // Controller A opens the same list, directions stay within its options, and
  // A commits. This catches regressions where spatial navigation escapes into
  // another widget because the list is rendered through a portal.
  await replayLength.focus();
  await page.evaluate(() => window.__emitOverlayGamepad?.("accept"));
  await page.waitForSelector(".overlay-select__list");
  await page.waitForFunction(() =>
    document.activeElement?.classList.contains("overlay-select__option")
  );
  await page.evaluate(() => window.__emitOverlayGamepad?.("right"));
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "Last 60 seconds"
  );
  await page.evaluate(() => window.__emitOverlayGamepad?.("left"));
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "Last 45 seconds"
  );
  await page.evaluate(() => window.__emitOverlayGamepad?.("accept"));
  await page.waitForFunction(
    () =>
      document
        .querySelector(".overlay-capture__replay .overlay-select__value")
        ?.textContent?.trim() === "Last 45 seconds"
  );

  // Controller Back closes only the open listbox, not the whole overlay.
  await replayLength.focus();
  await page.evaluate(() => window.__emitOverlayGamepad?.("accept"));
  await page.waitForSelector(".overlay-select__list");
  await page.evaluate(() => window.__emitOverlayGamepad?.("back"));
  await page.waitForSelector(".overlay-select__list", { state: "detached" });
  if (!(await page.locator(".overlay--full").count())) {
    throw new Error(
      "Controller Back closed the overlay instead of the select."
    );
  }

  // Switch away from the native XInput fixture and prove the renderer's
  // navigator.getGamepads polling path. The arbitration window intentionally
  // ignores a second API exposing the same physical button press.
  await page.waitForTimeout(1_050);
  if ((await page.evaluate(() => window.__qaGamepadPollCount ?? 0)) < 1) {
    throw new Error("The renderer did not poll navigator.getGamepads().");
  }

  await replayLength.focus();
  await pulseBrowserGamepadButton(0);
  await page.waitForSelector(".overlay-select__list");
  await pulseBrowserGamepadButton(15);
  await page.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "Last 60 seconds"
  );
  await pulseBrowserGamepadButton(0);
  await page.waitForFunction(
    () =>
      document
        .querySelector(".overlay-capture__replay .overlay-select__value")
        ?.textContent?.trim() === "Last 60 seconds"
  );
  await replayLength.focus();
  await pulseBrowserGamepadButton(0);
  await pulseBrowserGamepadButton(14);
  await pulseBrowserGamepadButton(0);
  await page.waitForFunction(
    () =>
      document
        .querySelector(".overlay-capture__replay .overlay-select__value")
        ?.textContent?.trim() === "Last 45 seconds"
  );

  // A enters a digital widget edit mode, the left analog stick performs a
  // pixel nudge, and A exits back to the exact edit handle.
  const friendsWidget = page.locator('[data-widget="friends"]');
  const friendsOptions = friendsWidget.getByRole("button", {
    name: "Friends widget options",
  });
  await friendsOptions.focus();
  await pulseBrowserGamepadButton(0);
  const friendsMoveButton = page.locator(
    '#overlay-widget-options-friends [data-widget-controller-edit="move"]'
  );
  const friendsBeforeControllerMove = await friendsWidget.boundingBox();
  if (!friendsBeforeControllerMove) {
    throw new Error("Friends widget is missing before controller movement.");
  }
  await friendsMoveButton.focus();
  await pulseBrowserGamepadButton(0);
  if (
    !(await page.locator(".overlay-controller-hints").innerText()).includes(
      "Move"
    )
  ) {
    throw new Error("Controller A did not engage widget move mode.");
  }
  await pulseBrowserGamepadAxis(0, -1);
  await pulseBrowserGamepadButton(0);
  const friendsAfterControllerMove = await friendsWidget.boundingBox();
  if (
    !friendsAfterControllerMove ||
    friendsAfterControllerMove.x >= friendsBeforeControllerMove.x - 4
  ) {
    throw new Error("Left analog input did not move the Friends widget.");
  }
  if (
    (await page.locator(".overlay-controller-hints").innerText()).includes(
      "Move"
    )
  ) {
    throw new Error("Controller A did not exit widget move mode.");
  }

  const friendsResizeButton = friendsWidget.locator(
    '[data-widget-controller-edit="resize"]'
  );
  const friendsBeforeControllerResize = await friendsWidget.boundingBox();
  await friendsResizeButton.focus();
  await pulseBrowserGamepadButton(0);
  await pulseBrowserGamepadButton(15);
  await pulseBrowserGamepadButton(0);
  const friendsAfterControllerResize = await friendsWidget.boundingBox();
  if (
    !friendsBeforeControllerResize ||
    !friendsAfterControllerResize ||
    friendsAfterControllerResize.width <=
      friendsBeforeControllerResize.width + 4
  ) {
    throw new Error("D-pad input did not resize the Friends widget.");
  }

  // Long Spotify shelves are one predictable focus stop until A engages the
  // region. B then disengages it and restores focus to the shelf itself.
  const spotifyBrowseRegion = page
    .locator(
      '.spotify-overlay-panel__browse [data-controller-focus-region="true"]'
    )
    .first();
  await spotifyBrowseRegion.focus();
  await pulseBrowserGamepadButton(0);
  const browseRegionEngagement = await spotifyBrowseRegion.evaluate(
    (region) => ({
      editing: region.getAttribute("data-controller-editing"),
      activeInside: region.contains(document.activeElement),
      activeIsRegion: document.activeElement === region,
    })
  );
  if (
    browseRegionEngagement.editing !== "true" ||
    !browseRegionEngagement.activeInside ||
    browseRegionEngagement.activeIsRegion
  ) {
    throw new Error(
      `Spotify browse focus engagement failed: ${JSON.stringify(browseRegionEngagement)}.`
    );
  }
  await pulseBrowserGamepadButton(1);
  const spotifyBackState = await spotifyBrowseRegion.evaluate((region) => ({
    restored: document.activeElement === region,
    editing: region.getAttribute("data-controller-editing"),
    activeTag: document.activeElement?.tagName ?? null,
    activeId: document.activeElement?.id ?? null,
    activeClass:
      document.activeElement instanceof HTMLElement
        ? document.activeElement.className
        : null,
    activeInside: region.contains(document.activeElement),
  }));
  if (!spotifyBackState.restored) {
    throw new Error(
      `Controller B did not restore focus to the Spotify shelf: ${JSON.stringify(spotifyBackState)}.`
    );
  }

  await page
    .locator(".spotify-overlay-panel__tab")
    .filter({ hasText: "Queue" })
    .click();
  const spotifyQueueRegion = page.locator(
    ".spotify-overlay-panel__queue-up-next [data-controller-focus-region]"
  );
  await spotifyQueueRegion.focus();
  await pulseBrowserGamepadButton(0);
  for (let index = 0; index < 12; index += 1) {
    await pulseBrowserGamepadButton(13);
  }
  const queueTraversal = await spotifyQueueRegion.evaluate((region) => ({
    scrollTop: region.closest(".spotify-overlay-panel__queue")?.scrollTop ?? 0,
    activeInside: region.contains(document.activeElement),
    activeLabel: document.activeElement?.getAttribute("aria-label"),
  }));
  if (!queueTraversal.activeInside || queueTraversal.scrollTop <= 0) {
    throw new Error(
      `Controller traversal stalled at the visible Spotify queue edge: ${JSON.stringify(queueTraversal)}.`
    );
  }
  await pulseBrowserGamepadButton(1);
  await page
    .locator(".spotify-overlay-panel__tab")
    .filter({ hasText: "Browse" })
    .click();

  // Bumpers are scoped to the tabbed music widget; they must not hijack focus
  // from achievements or another freeform widget.
  const selectedSpotifyTabBefore = await page
    .locator('.spotify-overlay-panel__tab[aria-selected="true"]')
    .textContent();
  await page.locator(".overlay-ach__filters button").first().focus();
  await pulseBrowserGamepadButton(5);
  const selectedSpotifyTabOutsideMusic = await page
    .locator('.spotify-overlay-panel__tab[aria-selected="true"]')
    .textContent();
  if (selectedSpotifyTabOutsideMusic !== selectedSpotifyTabBefore) {
    throw new Error("RB changed music tabs while focus was outside Music.");
  }
  await page
    .locator('.spotify-overlay-panel__tab[aria-selected="true"]')
    .focus();
  await pulseBrowserGamepadButton(5);
  const selectedSpotifyTabInsideMusic = await page
    .locator('.spotify-overlay-panel__tab[aria-selected="true"]')
    .textContent();
  if (selectedSpotifyTabInsideMusic === selectedSpotifyTabBefore) {
    throw new Error("RB did not change tabs while focus was inside Music.");
  }

  // Close Game is destructive: A opens a modal with Cancel focused, and B
  // cancels without invoking the process action or closing the overlay.
  const closeGameTrigger = page.locator("#overlay-close-game-trigger");
  await closeGameTrigger.focus();
  await page.evaluate(() => {
    window.__qaHasFocus = document.hasFocus.bind(document);
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => false,
    });
    window.__emitOverlayGamepad?.("accept");
  });
  await page.waitForTimeout(100);
  if (await page.locator("#overlay-close-game-dialog").count()) {
    throw new Error(
      "A native controller action was accepted after overlay blur."
    );
  }
  await page.evaluate(() => {
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: window.__qaHasFocus,
    });
  });
  await pulseBrowserGamepadButton(0);
  await page.waitForSelector('#overlay-close-game-dialog[aria-modal="true"]');
  if (
    !(await page
      .locator("#overlay-close-game-cancel")
      .evaluate((button) => document.activeElement === button))
  ) {
    throw new Error("Close Game confirmation did not focus the safe action.");
  }
  await pulseBrowserGamepadButton(1);
  await page.waitForSelector("#overlay-close-game-dialog", {
    state: "detached",
  });
  if (
    !(await closeGameTrigger.evaluate(
      (button) => document.activeElement === button
    ))
  ) {
    throw new Error("Close Game cancellation did not restore trigger focus.");
  }

  // Hardware text editing keeps native cursor keys, while controller A opens
  // the monochrome on-screen keyboard for every text input and textarea.
  const spotifySearchTab = page
    .locator(".spotify-overlay-panel__tab")
    .filter({ hasText: "Search" });
  await spotifySearchTab.click();
  const spotifySearchInput = page.locator(
    '.spotify-overlay-panel__search input[type="search"]'
  );
  await spotifySearchInput.fill("AB");
  await spotifySearchInput.evaluate((input) => input.setSelectionRange(2, 2));
  await page.keyboard.press("ArrowLeft");
  const searchCursor = await spotifySearchInput.evaluate((input) => ({
    selectionStart: input.selectionStart,
    stillFocused: document.activeElement === input,
  }));
  if (searchCursor.selectionStart !== 1 || !searchCursor.stillFocused) {
    throw new Error(
      `Overlay intercepted a hardware cursor key in text: ${JSON.stringify(searchCursor)}.`
    );
  }

  const notesInput = page.locator('[data-widget="notes"] textarea');
  const notesBeforeKeyboard = await notesInput.inputValue();
  await notesInput.focus();
  await pulseBrowserGamepadButton(0);
  await page.waitForSelector('#overlay-controller-keyboard[aria-modal="true"]');
  await pulseBrowserGamepadButton(0);
  await pulseBrowserGamepadButton(1);
  await page.waitForSelector("#overlay-controller-keyboard", {
    state: "detached",
  });
  if ((await notesInput.inputValue()) !== `${notesBeforeKeyboard}q`) {
    throw new Error("Controller keyboard did not update the Notes textarea.");
  }
  if (
    !(await notesInput.evaluate((input) => document.activeElement === input))
  ) {
    throw new Error("Controller keyboard did not restore text-field focus.");
  }

  if (
    (await page
      .locator('[data-widget="quick-launch"] .overlay-pin-entry__remove')
      .count()) !== 2
  ) {
    throw new Error(
      "Pinned apps do not expose controller-reachable Unpin buttons."
    );
  }

  await restoreDefaultOverlayLayout();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );

  await page.waitForTimeout(500);
  await page.screenshot({ path: output, fullPage: true });
  await page.screenshot({ path: controllerFullHdOutput, fullPage: true });

  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
    widgets: document.querySelectorAll("[data-widget]").length,
    replayLength: document
      .querySelector(".overlay-capture__replay .overlay-select__value")
      ?.textContent?.trim(),
    footerBars: document.querySelectorAll(".overlay-foot").length,
    musicProvider:
      document.querySelector(".spotify-overlay-panel") !== null
        ? "spotify"
        : "gamehub",
    localClock: Array.from(
      document.querySelectorAll(".overlay-header__clock time")
    ).map((element) => element.textContent?.trim()),
    captureText:
      document.querySelector('[data-widget="capture"]')?.textContent ?? "",
  }));
  if (
    !dimensions.captureText.includes("30s of 45s buffered") ||
    !dimensions.captureText.includes("Save 30s available") ||
    !dimensions.captureText.includes("59.7 FPS encoded") ||
    !dimensions.captureText.includes("24.6 Mbps")
  ) {
    throw new Error(
      `Instant Replay target and actual buffer are inconsistent: ${dimensions.captureText}`
    );
  }
  if (pageErrors.length) {
    throw new Error(`Renderer errors: ${pageErrors.join(" | ")}`);
  }

  const toastViewportMatrix = [
    { width: 820, height: 118, name: "wide" },
    { width: 592, height: 148, name: "medium" },
    { width: 352, height: 184, name: "narrow" },
  ];
  const toastResults = [];
  for (const viewport of toastViewportMatrix) {
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
    }, viewport);
    await page.goto(`${pathToFileURL(renderer).href}#/overlay-toast`);
    await page.reload();
    await page.waitForSelector(".overlay-toast");
    await page.locator(".overlay-toast").evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished)
      );
    });
    const result = await page.evaluate(() => {
      const toast = document.querySelector(".overlay-toast");
      if (!(toast instanceof HTMLElement)) {
        return { fits: false, reason: "missing toast" };
      }
      const toastRect = toast.getBoundingClientRect();
      const descendants = Array.from(toast.querySelectorAll("*"));
      const outside = descendants
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.left < toastRect.left - 0.5 ||
            rect.top < toastRect.top - 0.5 ||
            rect.right > toastRect.right + 0.5 ||
            rect.bottom > toastRect.bottom + 0.5
          );
        })
        .map((element) => element.className || element.tagName);
      const fits =
        toastRect.left >= 0 &&
        toastRect.top >= 0 &&
        toastRect.right <= window.innerWidth + 1 &&
        toastRect.bottom <= window.innerHeight + 1 &&
        toast.scrollWidth <= toast.clientWidth &&
        toast.scrollHeight <= toast.clientHeight &&
        outside.length === 0;
      return {
        fits,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        toast: {
          x: toastRect.x,
          y: toastRect.y,
          width: toastRect.width,
          height: toastRect.height,
        },
        outside,
        text: toast.textContent?.replace(/\s+/g, " ").trim(),
      };
    });
    const toastOutput = path.join(
      repositoryRoot,
      "artifacts",
      "overlay",
      `gamehub-overlay-toast-${viewport.name}.png`
    );
    await page.screenshot({ path: toastOutput, fullPage: true });
    toastResults.push({ name: viewport.name, output: toastOutput, ...result });
    if (!result.fits) {
      throw new Error(
        `Overlay-ready toast content is clipped at ${viewport.name} size: ${JSON.stringify(result)}.`
      );
    }
  }

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(592, 148);
  });
  await page.goto(
    `${pathToFileURL(renderer).href}#/overlay-toast?kind=overlay-unavailable&reason=exclusive-fullscreen`
  );
  await page.waitForSelector(".overlay-toast--error");
  const overlayUnavailableText = await page
    .locator(".overlay-toast--error")
    .textContent();
  if (
    !overlayUnavailableText?.includes(
      "Overlay requires Borderless or Windowed"
    ) ||
    !overlayUnavailableText.includes(
      "Exclusive fullscreen is not supported. Switch the game to Borderless or Windowed."
    )
  ) {
    throw new Error(
      `Overlay-unavailable toast rendered unexpected copy: ${overlayUnavailableText}`
    );
  }
  const overlayUnavailableOutput = path.join(
    repositoryRoot,
    "artifacts",
    "overlay",
    "gamehub-overlay-borderless-required.png"
  );
  await page.screenshot({ path: overlayUnavailableOutput, fullPage: true });

  console.log(
    JSON.stringify(
      {
        runtimePlatform: process.platform,
        dataSource: "synthetic overlay fixtures; controller inputs simulated",
        output,
        firstOpenOutput,
        secondOpenOutput,
        controllerFullHdOutput,
        controllerCompactOutput,
        firstOpenTransitions,
        secondOpenTransitions,
        contrastResults,
        overlayUnavailableOutput,
        toastResults,
        widgetToggles: widgetToggleCount,
        nativeIconBytes: nativeIconDataUrl.length,
        ...dimensions,
      },
      null,
      2
    )
  );
} finally {
  await electronApp.close();
}
