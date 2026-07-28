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
  const nativeIconDataUrl = await electronApp.evaluate(
    async ({ app }, executablePath) => {
      const image = await app.getFileIcon(executablePath, { size: "large" });
      return image.toDataURL();
    },
    electronExecutable
  );
  if (!nativeIconDataUrl.startsWith("data:image/")) {
    throw new Error("Electron did not resolve a native executable icon.");
  }

  const page = await electronApp.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
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
    const userPreferences = {
      language: "en",
      themeMode: "dark",
      musicProvider: "spotify",
    };

    const listeners = () => () => undefined;
    const api = {
      platform: "win32",
      isWayland: false,
      getVersion: async () => "1.1.20",
      isStaging: async () => false,
      updateUserPreferences: async (preferences) => {
        Object.assign(userPreferences, preferences);
        if (preferences.gameRecorderReplayDurationSeconds) {
          recorderState.configuration.replayDurationSeconds =
            preferences.gameRecorderReplayDurationSeconds;
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
      getOverlayContext: async () => context,
      overlayRendererReady: async () => undefined,
      getOverlayNote: async () =>
        "Boss phase two: dodge inward, then punish the overhead swing.",
      saveOverlayNote: async () => undefined,
      closeHydraOverlay: async () => undefined,
      setOverlayPerformancePinned: async () => undefined,
      onOverlayMode: listeners,
      onOverlayShown: listeners,
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
          queue: [spotifyEpisode, spotifyTrack],
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
  });

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
    .locator('[data-widget="friends"] .overlay-widget__drag')
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

  await page.getByRole("button", { name: "Reset widget layout" }).click();

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
    await page.getByRole("button", { name: "Reset widget layout" }).click();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
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
  }

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1920, 1080);
  });
  await page.waitForFunction(
    () => window.innerWidth === 1920 && window.innerHeight === 1080,
    undefined,
    { timeout: 5_000 }
  );
  await page.getByRole("button", { name: "Reset widget layout" }).click();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );

  const pinnedIconCount = await page
    .locator('[data-widget="quick-launch"] .overlay-pin-tile__icon')
    .count();
  if (pinnedIconCount !== 2) {
    throw new Error("Pinned apps did not render their resolved icons.");
  }

  const replayLength = page.locator(".overlay-capture__replay select");
  await replayLength.focus();
  await page.evaluate(() => window.__emitOverlayGamepad?.("accept"));
  await page.evaluate(() => window.__emitOverlayGamepad?.("right"));
  await page.evaluate(() => window.__emitOverlayGamepad?.("accept"));
  await page.waitForFunction(
    () =>
      document.querySelector(".overlay-capture__replay select")?.value === "45"
  );

  await page.waitForTimeout(500);
  await page.screenshot({ path: output, fullPage: true });

  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
    widgets: document.querySelectorAll("[data-widget]").length,
    replayLength: document.querySelector(".overlay-capture__replay select")
      ?.value,
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
  if (pageErrors.length) {
    throw new Error(`Renderer errors: ${pageErrors.join(" | ")}`);
  }

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(620, 190);
  });
  await page.goto(`${pathToFileURL(renderer).href}#/overlay-toast`);
  await page.reload();
  await page.waitForSelector(".overlay-toast");
  const toastFits = await page.evaluate(() => {
    const toast = document.querySelector(".overlay-toast");
    if (!(toast instanceof HTMLElement)) return false;
    const rect = toast.getBoundingClientRect();
    return (
      rect.left >= 0 &&
      rect.top >= 0 &&
      rect.right <= window.innerWidth &&
      rect.bottom <= window.innerHeight &&
      toast.scrollWidth <= toast.clientWidth &&
      toast.scrollHeight <= toast.clientHeight
    );
  });
  if (!toastFits) throw new Error("Overlay-ready toast content is clipped.");

  console.log(
    JSON.stringify(
      {
        output,
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
