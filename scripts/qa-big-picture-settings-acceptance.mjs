/* global globalThis */

/**
 * Proof-grade Big Picture and Settings acceptance runner.
 *
 * This script intentionally does not build GameHub. It must be run only after
 * the release owner has produced the final `out/` tree. The populated profile
 * is copied into a guarded temporary portable-data root before Electron starts;
 * every preference and emulator-config write therefore lands in that clone.
 *
 * Required environment:
 *   PLAYWRIGHT_PACKAGE  Directory containing Playwright's index.mjs
 *   GAMEHUB_LIVE_DATA  Populated GameHub data directory to clone read-only,
 *                      unless GAMEHUB_QA_SYNTHETIC_PROFILE=true
 *
 * Optional environment:
 *   GAMEHUB_R2_CREDENTIALS_URL
 *   GAMEHUB_API_URL
 *   GAMEHUB_QA_SYNTHETIC_PROFILE=true  Build an isolated deterministic profile
 *   GAMEHUB_QA_CAPTURE_ALL_VIEWPORTS=false  Capture HD only (assert all sizes)
 */

import fs from "node:fs";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE?.trim();
const sourceData = process.env.GAMEHUB_LIVE_DATA?.trim();
const USE_SYNTHETIC_PROFILE =
  process.env.GAMEHUB_QA_SYNTHETIC_PROFILE === "true";

if (!playwrightPackage) {
  throw new Error("Set PLAYWRIGHT_PACKAGE to Playwright's package directory.");
}
if (!sourceData && !USE_SYNTHETIC_PROFILE) {
  throw new Error(
    "Set GAMEHUB_LIVE_DATA or opt into GAMEHUB_QA_SYNTHETIC_PROFILE=true."
  );
}

const VIEWPORTS = [
  { id: "compact", width: 1024, height: 720 },
  { id: "hd", width: 1280, height: 720 },
  { id: "full-hd", width: 1920, height: 1080 },
  { id: "ultrawide", width: 2560, height: 1080 },
];

const EMULATOR_VIEWPORTS = [VIEWPORTS[0], VIEWPORTS[2]];
const CAPTURE_ALL_VIEWPORTS =
  process.env.GAMEHUB_QA_CAPTURE_ALL_VIEWPORTS !== "false";
const CASE_FILTER = process.env.GAMEHUB_QA_CASE_FILTER
  ? new RegExp(process.env.GAMEHUB_QA_CASE_FILTER)
  : null;

const BP_SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "downloads", label: "Downloads" },
  { id: "notifications", label: "Notifications" },
  { id: "content", label: "Content" },
  { id: "big-picture", label: "Big Picture" },
  { id: "emulation", label: "Emulation" },
  { id: "integrations", label: "Integrations" },
  { id: "compatibility", label: "Compatibility" },
  { id: "account-privacy", label: "Account and Privacy" },
];

const DESKTOP_SETTINGS_CATEGORIES = [
  "general",
  "downloads",
  "notifications",
  "content_gameplay",
  "integrations",
  "achievements",
  "compatibility",
  "big_picture",
  "emulation",
  "account_privacy",
];

const EMULATOR_SYSTEMS = [
  { id: "ps1", label: "PlayStation" },
  { id: "ps2", label: "PlayStation 2" },
  { id: "ps3", label: "PlayStation 3" },
  { id: "psp", label: "PSP" },
  { id: "n3ds", label: "Nintendo 3DS" },
  { id: "nds", label: "Nintendo DS" },
  { id: "dsi", label: "Nintendo DSi" },
  { id: "n64", label: "Nintendo 64" },
  { id: "gb", label: "Game Boy" },
  { id: "gbc", label: "Game Boy Color" },
  { id: "gba", label: "Game Boy Advance" },
  { id: "wiiu", label: "Wii U" },
  { id: "wii", label: "Wii" },
  { id: "gc", label: "GameCube" },
  { id: "switch", label: "Nintendo Switch" },
];

const OCARINA_ROUTE = "/big-picture/game/launchbox/local-n3ds-228e2f92cd0941e4";
const QA_LOCAL_PROFILE_ID = "qa-local-kewz";
const QA_REMOTE_PROFILE_ID = "qa-remote-raven";

function qaProfileGame(
  origin,
  objectId,
  title,
  {
    shop = "steam",
    playTimeInSeconds = 0,
    unlockedAchievementCount = 0,
    achievementCount = 0,
    lastTimePlayed = null,
    isPinned = false,
  } = {}
) {
  return {
    objectId,
    shop,
    title,
    iconUrl: `${origin}/__qa/assets/${objectId}-icon.svg`,
    libraryHeroImageUrl: `${origin}/__qa/assets/${objectId}-hero.svg`,
    libraryImageUrl: `${origin}/__qa/assets/${objectId}-cover.svg`,
    logoImageUrl: null,
    logoPosition: null,
    coverImageUrl: `${origin}/__qa/assets/${objectId}-cover.svg`,
    downloadSources: [],
    playTimeInSeconds,
    lastTimePlayed,
    unlockedAchievementCount,
    achievementCount,
    achievementsPointsEarnedSum: unlockedAchievementCount * 10,
    hasManuallyUpdatedPlaytime: false,
    isFavorite: false,
    isPinned,
  };
}

function qaAssetGame(
  origin,
  objectId,
  title,
  genres,
  { shop = "steam", description = null } = {}
) {
  const assetId = objectId.replaceAll(/[^a-z0-9-]/gi, "-");
  return {
    id: `${shop}:${objectId}`,
    objectId,
    shop,
    title,
    description:
      description ?? `${title} is part of the deterministic GameHub QA set.`,
    iconUrl: `${origin}/__qa/assets/${assetId}-icon.svg`,
    libraryHeroImageUrl: `${origin}/__qa/assets/${assetId}-hero.svg`,
    libraryImageUrl: `${origin}/__qa/assets/${assetId}-cover.svg`,
    logoImageUrl: null,
    logoPosition: null,
    coverImageUrl: `${origin}/__qa/assets/${assetId}-cover.svg`,
    downloadSources: ["GameHub QA"],
    genres,
    searchVector: "",
    uri: `qa://${shop}/${objectId}`,
  };
}

function qaCatalogueFixtures(origin) {
  const owned = [
    qaAssetGame(origin, "620", "Portal 2", ["Puzzle", "Adventure"]),
    qaAssetGame(origin, "1145350", "Hades II", [
      "Action",
      "Roguelike",
      "Adventure",
    ]),
  ];
  const candidates = [
    qaAssetGame(origin, "qa-cocoon", "Cocoon", ["Puzzle", "Adventure"]),
    qaAssetGame(origin, "qa-tunic", "Tunic", ["Action", "Adventure"]),
    qaAssetGame(origin, "qa-dead-cells", "Dead Cells", ["Action", "Roguelike"]),
    qaAssetGame(origin, "qa-hollow-knight", "Hollow Knight", [
      "Action",
      "Adventure",
    ]),
    qaAssetGame(origin, "qa-deaths-door", "Death's Door", [
      "Action",
      "Adventure",
    ]),
    qaAssetGame(origin, "qa-celeste", "Celeste", ["Action", "Adventure"]),
    qaAssetGame(origin, "qa-ori", "Ori and the Will of the Wisps", [
      "Action",
      "Adventure",
    ]),
    qaAssetGame(origin, "qa-obra-dinn", "Return of the Obra Dinn", [
      "Puzzle",
      "Adventure",
    ]),
    qaAssetGame(origin, "qa-animal-well", "Animal Well", [
      "Puzzle",
      "Adventure",
    ]),
    qaAssetGame(origin, "qa-prince", "Prince of Persia: The Lost Crown", [
      "Action",
      "Adventure",
    ]),
    qaAssetGame(origin, "qa-nine-sols", "Nine Sols", ["Action", "Adventure"]),
    qaAssetGame(origin, "qa-hyper-light", "Hyper Light Drifter", [
      "Action",
      "Adventure",
    ]),
    ...Array.from({ length: 36 }, (_, index) =>
      qaAssetGame(
        origin,
        `qa-discovery-${index + 1}`,
        `Discovery Game ${index + 1}`,
        index % 3 === 0 ? ["Puzzle", "Adventure"] : ["Action", "Adventure"]
      )
    ),
  ];
  return { owned, candidates, all: [...owned, ...candidates] };
}

function qaRemoteProfileFixtures(origin, profileId = QA_REMOTE_PROFILE_ID) {
  const isLocalProfile = profileId === QA_LOCAL_PROFILE_ID;
  const games = [
    qaProfileGame(origin, "qa-orbit", "Orbit Fall", {
      playTimeInSeconds: 1209 * 60 * 60,
      unlockedAchievementCount: 42,
      achievementCount: 50,
      lastTimePlayed: "2026-08-08T21:15:00.000Z",
      isPinned: true,
    }),
    qaProfileGame(origin, "qa-mono", "Monochrome Drift", {
      playTimeInSeconds: 36 * 60 * 60,
      unlockedAchievementCount: 18,
      achievementCount: 24,
      lastTimePlayed: "2026-08-07T17:30:00.000Z",
    }),
    qaProfileGame(origin, "qa-quiet", "The Quiet Archive", {
      shop: "gog",
      playTimeInSeconds: 8 * 60 * 60,
      unlockedAchievementCount: 5,
      achievementCount: 20,
      lastTimePlayed: "2026-07-30T12:00:00.000Z",
    }),
    qaProfileGame(origin, "qa-no-achievements", "Signal Garden", {
      shop: "epic",
      playTimeInSeconds: 90 * 60,
      lastTimePlayed: "2026-07-20T09:00:00.000Z",
    }),
  ];

  return {
    profile: {
      id: profileId,
      displayName:
        profileId === QA_REMOTE_PROFILE_ID
          ? "Raven QA"
          : isLocalProfile
            ? "Kewz QA"
            : "Fixture Friend",
      profileImageUrl: `${origin}/__qa/assets/${isLocalProfile ? "local" : "remote"}-avatar.svg`,
      email: null,
      backgroundImageUrl: `${origin}/__qa/assets/remote-banner.svg`,
      profileVisibility: isLocalProfile ? "PUBLIC" : "FRIENDS",
      libraryGames: [games[0], games[1]],
      recentGames: [games[1], games[2]],
      friends: [],
      totalFriends: isLocalProfile ? 3 : 37,
      relation: null,
      currentGame: null,
      bio: isLocalProfile
        ? "Synthetic populated profile · controller and responsive UI QA"
        : "Controller-first player · deterministic remote QA profile",
      hasActiveSubscription: false,
      karma: 120,
      quirks: { backupsPerGameLimit: 0 },
      badges: [],
      hasCompletedWrapped2025: false,
    },
    stats: {
      libraryCount: games.length,
      friendsCount: isLocalProfile ? 3 : 37,
      totalPlayTimeInSeconds: {
        value: 1209 * 60 * 60,
        topPercentile: 2,
      },
      achievementsPointsEarnedSum: { value: 650, topPercentile: 4 },
      unlockedAchievementSum: 65,
    },
    games,
  };
}

function qaFriendsFixture(origin) {
  return [
    {
      id: "qa-friend-ingame",
      displayName: "Nova In Game",
      profileImageUrl: `${origin}/__qa/assets/friend-ingame-avatar.svg`,
      backgroundImageUrl: null,
      isOnline: true,
      currentGame: {
        ...qaProfileGame(origin, "qa-friend-game", "Hades II"),
        sessionDurationInSeconds: 1820,
      },
    },
    {
      id: "qa-friend-online",
      displayName: "Echo Online",
      profileImageUrl: `${origin}/__qa/assets/friend-online-avatar.svg`,
      backgroundImageUrl: null,
      isOnline: true,
      currentGame: null,
    },
    {
      id: "qa-friend-offline",
      displayName: "Mira Offline",
      profileImageUrl: `${origin}/__qa/assets/friend-offline-avatar.svg`,
      backgroundImageUrl: null,
      isOnline: false,
      currentGame: null,
    },
  ];
}

function qaSvgAsset(assetName) {
  const isBanner = assetName.includes("banner") || assetName.includes("hero");
  const isCover = assetName.includes("cover");
  const width = isBanner ? 1600 : isCover ? 640 : 160;
  const height = isBanner ? 500 : isCover ? 360 : 160;
  const paletteIndex = [...assetName].reduce(
    (total, character) => (total + character.charCodeAt(0)) % 4,
    0
  );
  const palettes = [
    ["#09090b", "#27272a", "#b91c1c", "#fca5a5"],
    ["#07111f", "#172554", "#2563eb", "#93c5fd"],
    ["#0b1210", "#134e4a", "#0f766e", "#99f6e4"],
    ["#17120a", "#713f12", "#d97706", "#fde68a"],
  ];
  const [background, surface, accent, highlight] = palettes[paletteIndex];
  const orbX = Math.round(width * (0.66 + paletteIndex * 0.035));
  const orbY = Math.round(height * (0.3 + paletteIndex * 0.045));
  const orbRadius = Math.round(height * (isBanner || isCover ? 0.38 : 0.33));
  const lineWidth = Math.max(2, Math.round(height * 0.012));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="${background}"/>
        <stop offset="1" stop-color="${surface}"/>
      </linearGradient>
      <linearGradient id="orb" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="${highlight}" stop-opacity=".9"/>
        <stop offset="1" stop-color="${accent}" stop-opacity=".35"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#background)"/>
    <circle cx="${orbX}" cy="${orbY}" r="${orbRadius}" fill="url(#orb)" opacity=".78"/>
    <circle cx="${orbX}" cy="${orbY}" r="${Math.round(orbRadius * 0.58)}" fill="${background}" opacity=".72"/>
    <path d="M-${Math.round(width * 0.08)} ${Math.round(height * 0.9)} L${Math.round(width * 0.72)} ${Math.round(height * 0.18)} L${Math.round(width * 1.08)} ${Math.round(height * 0.54)} L${Math.round(width * 0.28)} ${Math.round(height * 1.12)}Z" fill="${accent}" opacity=".22"/>
    <path d="M${Math.round(width * 0.08)} ${Math.round(height * 0.78)} L${Math.round(width * 0.48)} ${Math.round(height * 0.42)} L${Math.round(width * 0.9)} ${Math.round(height * 0.78)}" fill="none" stroke="${highlight}" stroke-width="${lineWidth}" stroke-linecap="round" stroke-linejoin="round" opacity=".5"/>
  </svg>`;
}

function sendQaJson(response, value, statusCode = 200) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function startReadOnlyHydraApiProxy(upstreamApiUrl) {
  const state = {
    friendsPopulated: false,
    mutationRequests: [],
    fixtureRequests: 0,
    requestPaths: [],
    upstreamRequests: [],
  };
  const upstreamBase = new URL(upstreamApiUrl);

  const server = http.createServer(async (request, response) => {
    const localUrl = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "127.0.0.1"}`
    );
    const origin = localUrl.origin;
    state.requestPaths.push(
      `${request.method ?? "UNKNOWN"} ${localUrl.pathname}`
    );
    if (state.requestPaths.length > 200) state.requestPaths.shift();
    const catalogue = qaCatalogueFixtures(origin);

    if (localUrl.pathname.startsWith("/__qa/assets/")) {
      const svg = qaSvgAsset(path.basename(localUrl.pathname));
      response.writeHead(200, {
        "content-type": "image/svg+xml; charset=utf-8",
        "content-length": Buffer.byteLength(svg),
        "cache-control": "no-store",
      });
      response.end(svg);
      return;
    }

    const remoteProfileMatch = /^\/users\/([^/]+)$/.exec(localUrl.pathname);
    const remoteStatsMatch = /^\/users\/([^/]+)\/stats$/.exec(
      localUrl.pathname
    );
    const remoteLibraryMatch = /^\/users\/([^/]+)\/library$/.exec(
      localUrl.pathname
    );
    const remoteReviewsMatch = /^\/users\/([^/]+)\/reviews$/.exec(
      localUrl.pathname
    );
    const fixtureProfileIds = new Set([
      QA_LOCAL_PROFILE_ID,
      QA_REMOTE_PROFILE_ID,
      "qa-friend-ingame",
      "qa-friend-online",
      "qa-friend-offline",
    ]);
    const matchedProfileId =
      remoteProfileMatch?.[1] ??
      remoteStatsMatch?.[1] ??
      remoteLibraryMatch?.[1] ??
      remoteReviewsMatch?.[1] ??
      null;

    if (request.method === "GET" && matchedProfileId) {
      const decodedProfileId = decodeURIComponent(matchedProfileId);
      if (fixtureProfileIds.has(decodedProfileId)) {
        state.fixtureRequests += 1;
        const fixture = qaRemoteProfileFixtures(origin, decodedProfileId);
        if (remoteProfileMatch) sendQaJson(response, fixture.profile);
        if (remoteStatsMatch) sendQaJson(response, fixture.stats);
        if (remoteLibraryMatch) {
          const skip = Number(localUrl.searchParams.get("skip") ?? 0);
          const take = Number(localUrl.searchParams.get("take") ?? 100);
          sendQaJson(response, {
            totalCount: fixture.games.length,
            library: fixture.games.slice(skip, skip + take),
            pinnedGames: fixture.games.filter((game) => game.isPinned),
          });
        }
        if (remoteReviewsMatch) {
          sendQaJson(response, { totalCount: 0, reviews: [] });
        }
        return;
      }
    }

    if (
      request.method === "GET" &&
      [
        "/catalogue/featured",
        "/catalogue/hot",
        "/catalogue/weekly",
        "/catalogue/achievements",
      ].includes(localUrl.pathname)
    ) {
      state.fixtureRequests += 1;
      const responseGames =
        localUrl.pathname === "/catalogue/featured"
          ? [catalogue.candidates[1]]
          : localUrl.pathname === "/catalogue/achievements"
            ? catalogue.candidates.slice(0, 8)
            : catalogue.candidates;
      sendQaJson(response, responseGames);
      return;
    }

    if (
      request.method === "POST" &&
      localUrl.pathname === "/catalogue/search"
    ) {
      state.fixtureRequests += 1;
      sendQaJson(response, {
        count: catalogue.all.length,
        edges: catalogue.all,
      });
      return;
    }

    if (request.method === "GET" && localUrl.pathname === "/profile/friends") {
      state.fixtureRequests += 1;
      const friends = state.friendsPopulated ? qaFriendsFixture(origin) : [];
      sendQaJson(response, {
        totalFriends: friends.length,
        onlineFriends: friends.filter((friend) => friend.isOnline).length,
        friends,
      });
      return;
    }

    if (
      request.method === "GET" &&
      localUrl.pathname === "/profile/friend-requests"
    ) {
      state.fixtureRequests += 1;
      sendQaJson(response, []);
      return;
    }

    if (
      request.method === "GET" &&
      localUrl.pathname === "/profile/games/collections"
    ) {
      state.fixtureRequests += 1;
      sendQaJson(response, []);
      return;
    }

    if (
      request.method === "GET" &&
      localUrl.pathname === "/profile/notifications/count"
    ) {
      state.fixtureRequests += 1;
      sendQaJson(response, { count: 0 });
      return;
    }

    if (request.method === "GET" && localUrl.pathname === "/badges") {
      state.fixtureRequests += 1;
      sendQaJson(response, []);
      return;
    }

    const isAuthRefresh =
      request.method === "POST" && localUrl.pathname === "/auth/refresh";
    // Catalogue search is a query despite using POST for its structured filter
    // body. It is safe to proxy in a read-only acceptance run and must not be
    // reported as an account mutation.
    const isCatalogueSearch =
      request.method === "POST" && localUrl.pathname === "/catalogue/search";
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      !isAuthRefresh &&
      !isCatalogueSearch
    ) {
      state.mutationRequests.push({
        method: request.method ?? "UNKNOWN",
        path: localUrl.pathname,
      });
      sendQaJson(response, { message: "visual-qa-read-only" }, 403);
      return;
    }

    let requestBody;
    if (isAuthRefresh || isCatalogueSearch) {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      requestBody = Buffer.concat(chunks);
    }

    const target = new URL(upstreamBase);
    target.pathname = `${upstreamBase.pathname.replace(/\/$/, "")}${localUrl.pathname}`;
    target.search = localUrl.search;
    state.upstreamRequests.push(
      `${request.method ?? "UNKNOWN"} ${localUrl.pathname}`
    );
    if (state.upstreamRequests.length > 100) state.upstreamRequests.shift();
    const forwardedHeaders = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (
        ["host", "connection", "content-length"].includes(key.toLowerCase()) ||
        value === undefined
      ) {
        continue;
      }
      forwardedHeaders[key] = Array.isArray(value) ? value.join(", ") : value;
    }

    try {
      const upstreamResponse = await fetch(target, {
        method: request.method,
        headers: forwardedHeaders,
        body: requestBody,
        redirect: "manual",
      });
      const body = Buffer.from(await upstreamResponse.arrayBuffer());
      const responseHeaders = {};
      upstreamResponse.headers.forEach((value, key) => {
        if (
          !["content-encoding", "content-length", "transfer-encoding"].includes(
            key.toLowerCase()
          )
        ) {
          responseHeaders[key] = value;
        }
      });
      responseHeaders["content-length"] = String(body.length);
      response.writeHead(upstreamResponse.status, responseHeaders);
      response.end(body);
    } catch (error) {
      sendQaJson(
        response,
        {
          message: "visual-qa-upstream-unavailable",
          detail: sanitizeText(error),
        },
        502
      );
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  ensure(address && typeof address !== "string", "QA API proxy did not bind.");

  return {
    url: `http://127.0.0.1:${address.port}`,
    state,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve(undefined));
        server.closeAllConnections?.();
      }),
  };
}

const GAMEPAD_BUTTON = Object.freeze({
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  back: 8,
  start: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
});

const REQUIRED_SOURCE_DIRECTORIES = [
  "gamehub-db",
  "r2-image-cache",
  "Assets",
  "ludusavi",
];

const electronExecutable = path.join(
  repositoryRoot,
  "node_modules",
  "electron",
  "dist",
  "electron.exe"
);
const mainEntry = path.join(repositoryRoot, "out", "main", "index.js");
const runId = new Date().toISOString().replaceAll(/[-:.TZ]/g, "");
const artifactRoot = path.join(
  repositoryRoot,
  "artifacts",
  "qa-big-picture-settings",
  runId
);
const screenshotRoot = path.join(artifactRoot, "screenshots");
const isolatedPortableRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "gamehub-bp-settings-qa-")
);
const isolatedData = path.join(isolatedPortableRoot, "data");

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function sanitizeText(value) {
  let text = String(value ?? "");
  text = text.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]");
  text = text.replace(
    /([?&](?:access_?token|refresh_?token|api_?key|client_?secret|token|key|secret|password|code)=)[^&\s]+/gi,
    "$1[redacted]"
  );
  text = text.replace(
    /("(?:access_?token|refresh_?token|api_?key|client_?secret|token|key|secret|password|code)"\s*:\s*")[^"]+/gi,
    "$1[redacted]"
  );
  text = text.replace(/https?:\/\/[^\s"'`\\)]+/gi, "[url]");
  text = text.replace(
    /(?:file:\/\/\/)?C:[\\/]Users[\\/][^\\/\s]+/gi,
    "[user-home]"
  );
  text = text.replaceAll(isolatedPortableRoot, "[qa-clone]");
  text = text.replaceAll(
    isolatedPortableRoot.replaceAll("\\", "/"),
    "[qa-clone]"
  );
  if (sourceData) {
    text = text.replaceAll(sourceData, "[live-data]");
    text = text.replaceAll(sourceData.replaceAll("\\", "/"), "[live-data]");
  }
  return text.slice(0, 2_000);
}

function relativeArtifact(absolutePath) {
  return path.relative(artifactRoot, absolutePath).split(path.sep).join("/");
}

function shouldCapture(viewportId) {
  return CAPTURE_ALL_VIEWPORTS || viewportId === "hd";
}

async function discoverInstalledConfiguration() {
  let r2CredentialsUrl = process.env.GAMEHUB_R2_CREDENTIALS_URL?.trim();
  let hydraApiUrl = process.env.GAMEHUB_API_URL?.trim();
  if (USE_SYNTHETIC_PROFILE) {
    return {
      r2CredentialsUrl: r2CredentialsUrl ?? "http://127.0.0.1:9/r2-disabled",
      hydraApiUrl: hydraApiUrl ?? "http://127.0.0.1:9/api-disabled",
    };
  }
  if (r2CredentialsUrl && hydraApiUrl) {
    return { r2CredentialsUrl, hydraApiUrl };
  }

  const installedAsar = path.join(
    path.dirname(sourceData),
    "resources",
    "app.asar"
  );
  ensure(
    fs.existsSync(installedAsar),
    "The installed GameHub app.asar could not be found beside the data folder."
  );

  const { extractFile } = await import("@electron/asar");
  const installedMain = extractFile(
    installedAsar,
    "out\\main\\index.js"
  ).toString("utf8");

  if (!r2CredentialsUrl) {
    const marker = installedMain.indexOf(
      "r2_credentials_broker_not_configured"
    );
    const nearby = installedMain.slice(
      Math.max(0, marker - 12_000),
      marker + 1_000
    );
    r2CredentialsUrl = [...nearby.matchAll(/https:\/\/[^\s"'`\\)]+/g)]
      .map((match) => match[0])
      .find((candidate) => {
        try {
          return new URL(candidate).hostname.endsWith(".workers.dev");
        } catch {
          return false;
        }
      });
  }

  if (!hydraApiUrl) {
    const marker = installedMain.indexOf("/auth/refresh");
    const nearby = installedMain.slice(
      Math.max(0, marker - 4_000),
      marker + 4_000
    );
    hydraApiUrl = [...nearby.matchAll(/https:\/\/[^\s"'`\\)]+/g)]
      .map((match) => match[0])
      .find((candidate) => {
        try {
          const host = new URL(candidate).hostname;
          return (
            !host.endsWith(".workers.dev") &&
            !host.endsWith(".cloudflarestorage.com")
          );
        } catch {
          return false;
        }
      });
  }

  ensure(
    r2CredentialsUrl,
    "The installed build does not expose its R2 credential broker URL."
  );
  ensure(
    hydraApiUrl,
    "The installed build does not expose its account API URL."
  );
  return { r2CredentialsUrl, hydraApiUrl };
}

async function prepareIsolatedClone() {
  if (USE_SYNTHETIC_PROFILE) {
    for (const required of [electronExecutable, mainEntry]) {
      ensure(
        fs.existsSync(required),
        `Required final-build input is missing: ${path.basename(required)}.`
      );
    }
    await Promise.all(
      [...REQUIRED_SOURCE_DIRECTORIES, "session"].map((directory) =>
        fs.promises.mkdir(path.join(isolatedData, directory), {
          recursive: true,
        })
      )
    );
    await fs.promises.mkdir(screenshotRoot, { recursive: true });
    return;
  }

  for (const directory of REQUIRED_SOURCE_DIRECTORIES) {
    const source = path.join(sourceData, directory);
    ensure(
      fs.existsSync(source),
      `The populated data clone source is missing required directory ${directory}.`
    );
  }
  for (const required of [electronExecutable, mainEntry]) {
    ensure(
      fs.existsSync(required),
      `Required final-build input is missing: ${path.basename(required)}.`
    );
  }

  await fs.promises.mkdir(isolatedData, { recursive: true });
  await fs.promises.mkdir(path.join(isolatedData, "session"), {
    recursive: true,
  });
  await fs.promises.mkdir(screenshotRoot, { recursive: true });

  for (const directory of REQUIRED_SOURCE_DIRECTORIES) {
    await fs.promises.cp(
      path.join(sourceData, directory),
      path.join(isolatedData, directory),
      { recursive: true }
    );
  }

  // Preserve only the small persisted Exophase authentication partition, not
  // the multi-gigabyte browser caches. This lets the cloned app verify the
  // user's real saved account while every cookie/database write still lands
  // in the guarded temporary root.
  const exophasePartitionSource = path.join(
    sourceData,
    "session",
    "Partitions",
    "exophase"
  );
  const exophasePartitionTarget = path.join(
    isolatedData,
    "session",
    "Partitions",
    "exophase"
  );
  if (fs.existsSync(exophasePartitionSource)) {
    await fs.promises.mkdir(exophasePartitionTarget, { recursive: true });
    for (const entry of ["Network", "Preferences"]) {
      const source = path.join(exophasePartitionSource, entry);
      if (!fs.existsSync(source)) continue;
      await fs.promises.cp(source, path.join(exophasePartitionTarget, entry), {
        recursive: true,
      });
    }
  }
}

const qaNormalizeRomTitle = (title) =>
  title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/,\s*(the|an|a)\b/g, "")
    .replace(/^(the|an|a)\s+/, "")
    .replace(/[^a-z0-9]/g, "");

async function seedSyntheticProfile(database, origin) {
  const games = database.sublevel("games", { valueEncoding: "json" });
  const assets = database.sublevel("gameShopAssets", {
    valueEncoding: "json",
  });
  const achievements = database.sublevel("gameAchievements", {
    valueEncoding: "json",
  });
  const metadata = database.sublevel("gamehubMeta", {
    valueEncoding: "json",
  });
  const minerva = database.sublevel("minervaCatalogue", {
    valueEncoding: "json",
  });

  const profileUser = {
    id: QA_LOCAL_PROFILE_ID,
    displayName: "Kewz QA",
    profileImageUrl: `${origin}/__qa/assets/local-avatar.svg`,
    backgroundImageUrl: `${origin}/__qa/assets/local-banner.svg`,
    subscription: null,
  };
  await database.put("user", profileUser);
  await database.put("auth", {
    accessToken: "qa-read-only-access-token",
    refreshToken: "qa-read-only-refresh-token",
    tokenExpirationTimestamp: Date.now() + 24 * 60 * 60 * 1000,
    workwondersJwt: "qa-read-only-workwonders-token",
  });
  await database.put("language", "en-US");

  const localGames = [
    {
      shop: "launchbox",
      objectId: "local-n3ds-228e2f92cd0941e4",
      title: "The Legend of Zelda - Ocarina of Time 3D",
      platform: "Nintendo 3DS",
      genres: ["Puzzle", "Adventure"],
      playTimeInMilliseconds: 31 * 3_600_000,
      favorite: true,
      isPinned: true,
      achievementCount: 8,
      unlockedAchievementCount: 4,
    },
    {
      shop: "launchbox",
      objectId: "local-switch-botw-qa",
      title: "The Legend of Zelda: Breath of the Wild",
      platform: "Nintendo Switch",
      genres: ["Action", "Adventure"],
      playTimeInMilliseconds: 95 * 3_600_000,
      favorite: true,
      achievementCount: 0,
      unlockedAchievementCount: 0,
    },
    {
      shop: "steam",
      objectId: "620",
      title: "Portal 2",
      platform: "Windows",
      genres: ["Puzzle", "Adventure"],
      playTimeInMilliseconds: 48 * 3_600_000,
      favorite: true,
      achievementCount: 51,
      unlockedAchievementCount: 23,
    },
    {
      shop: "steam",
      objectId: "1145350",
      title: "Hades II",
      platform: "Windows",
      genres: ["Action", "Roguelike", "Adventure"],
      playTimeInMilliseconds: 82 * 3_600_000,
      favorite: false,
      achievementCount: 30,
      unlockedAchievementCount: 18,
    },
  ];

  for (const [index, fixtureGame] of localGames.entries()) {
    const key = `${fixtureGame.shop}:${fixtureGame.objectId}`;
    const art = qaAssetGame(
      origin,
      fixtureGame.objectId,
      fixtureGame.title,
      fixtureGame.genres,
      { shop: fixtureGame.shop }
    );
    await games.put(key, {
      ...fixtureGame,
      iconUrl: art.iconUrl,
      libraryHeroImageUrl: art.libraryHeroImageUrl,
      logoImageUrl: null,
      remoteId: `qa-remote-${index}`,
      isDeleted: false,
      isInstalledLocally: false,
      executablePath: null,
      lastTimePlayed: new Date(Date.now() - index * 86_400_000).toISOString(),
      addedToLibraryAt: new Date(
        Date.now() - (index + 10) * 86_400_000
      ).toISOString(),
      libraryOrigin: "sync",
      hasManuallyUpdatedPlaytime: false,
      automaticCloudSync: false,
    });
    await assets.put(key, art);
  }

  const achievementIcon = `${origin}/__qa/assets/achievement-clock-icon.svg`;
  const achievementDefinitions = Array.from({ length: 8 }, (_, index) => ({
    name: `QA_ACHIEVEMENT_${index + 1}`,
    displayName:
      index === 0 ? "Right on Time" : `Controller Milestone ${index + 1}`,
    description:
      index === 0
        ? "Complete the chamber before the countdown reaches zero."
        : "A deterministic achievement used for populated controller QA.",
    icon: achievementIcon,
    icongray: achievementIcon,
    hidden: false,
    points: 10,
  }));
  await achievements.put("launchbox:local-n3ds-228e2f92cd0941e4", {
    achievements: achievementDefinitions,
    unlockedAchievements: achievementDefinitions.slice(0, 4).map((item, i) => ({
      name: item.name,
      unlockTime: Date.now() - i * 60_000,
    })),
    updatedAt: Date.now(),
    language: "en",
  });
  await achievements.put("steam:620", {
    achievements: achievementDefinitions,
    unlockedAchievements: achievementDefinitions.slice(0, 6).map((item, i) => ({
      name: item.name,
      unlockTime: Date.now() - i * 60_000,
    })),
    updatedAt: Date.now(),
    language: "en",
  });

  const classics = [
    [
      "n3ds",
      "The Legend of Zelda: Ocarina of Time 3D",
      ["Puzzle", "Adventure"],
    ],
    ["n3ds", "The Legend of Zelda: Majora's Mask 3D", ["Puzzle", "Adventure"]],
    [
      "n3ds",
      "The Legend of Zelda: A Link Between Worlds",
      ["Action", "Adventure"],
    ],
    [
      "switch",
      "The Legend of Zelda: Link's Awakening",
      ["Puzzle", "Adventure"],
    ],
    ["wiiu", "The Legend of Zelda: The Wind Waker HD", ["Action", "Adventure"]],
    ["wii", "The Legend of Zelda: Twilight Princess", ["Action", "Adventure"]],
    ["gc", "Metroid Prime", ["Action", "Adventure"]],
    ["n64", "Super Mario 64", ["Platformer", "Adventure"]],
  ];
  for (const [index, [system, title, genres]] of classics.entries()) {
    const normalized = qaNormalizeRomTitle(title);
    const artId = `classic-${system}-${index}`;
    const meta = {
      title,
      description:
        index === 0
          ? "Link travels through time to stop Ganondorf and save Hyrule in this expanded Nintendo 3DS adventure."
          : `${title} is part of the deterministic classics recommendation fixture.`,
      genres,
      releaseYear: 2011 + index,
      coverImageUrl: `${origin}/__qa/assets/${artId}-cover.svg`,
      libraryImageUrl: `${origin}/__qa/assets/${artId}-cover.svg`,
      libraryHeroImageUrl: `${origin}/__qa/assets/${artId}-hero.svg`,
      logoImageUrl: null,
      iconUrl: `${origin}/__qa/assets/${artId}-icon.svg`,
      boxImageUrl: `${origin}/__qa/assets/${artId}-cover.svg`,
      screenshots: [
        `${origin}/__qa/assets/${artId}-hero.svg`,
        `${origin}/__qa/assets/${artId}-cover.svg`,
      ],
      developers: index === 0 ? ["Nintendo EAD", "Grezzo"] : ["Nintendo"],
      publishers: ["Nintendo"],
      ageRating: index === 0 ? { name: "RP", system: "CERO" } : null,
      ratingScore: index === 0 ? 95 : 88,
      series: index < 6 ? "The Legend of Zelda" : null,
      hltb: { main: 25, mainExtra: 32, completionist: 40 },
    };
    await metadata.put(`${system}:${normalized}`, meta);
    await minerva.put(`${system}:${normalized}:${index}`, {
      entry: {
        system,
        title,
        region: "World",
        filename: `${title}.zip`,
        romPath: `${title}.rom`,
        magnet: null,
        torrentUrl: null,
        downloadUrl: null,
        contentType: "game",
      },
      cachedAt: Date.now(),
    });
  }
}

async function patchIsolatedPreferences(assetOrigin) {
  const { ClassicLevel } = await import("classic-level");
  const sharp = (await import("sharp")).default;
  const databasePath = path.join(isolatedData, "gamehub-db");
  const database = new ClassicLevel(databasePath, { valueEncoding: "json" });

  try {
    await database.open();
    if (USE_SYNTHETIC_PROFILE) {
      await seedSyntheticProfile(database, assetOrigin);
    }
    const user = await database.get("user");
    ensure(
      user && typeof user === "object" && typeof user.id === "string",
      "The populated clone does not contain an authenticated user."
    );
    const current = await database.get("userPreferences").catch((error) => {
      if (error?.code === "LEVEL_NOT_FOUND") return {};
      throw error;
    });
    await database.put("userPreferences", {
      ...(current && typeof current === "object" ? current : {}),
      onboardingComplete: true,
      enableVirtualKeyboard: true,
      gameRecorderEnabled: true,
      achievementSouvenirCaptureEnabled: true,
      appendGlobalTrackers: true,
      globalTrackers: [
        "udp://tracker.example.test:6969/announce",
        "https://tracker.example.test/announce",
      ],
    });

    const achievementName = "QA_VISUAL_SOUVENIR";
    const ownerHash = crypto
      .createHash("sha256")
      .update(user.id, "utf8")
      .digest("hex");
    const achievementHash = crypto
      .createHash("sha256")
      .update(achievementName, "utf8")
      .digest("hex")
      .slice(0, 16);
    const gameHash = crypto
      .createHash("sha256")
      .update("steam\0" + "620", "utf8")
      .digest("hex")
      .slice(0, 12);
    const souvenirPath = path.join(
      isolatedData,
      "Screenshots",
      "Achievements",
      "accounts",
      `owner-${ownerHash}`,
      `Portal 2-${gameHash}`,
      `Right on Time-${achievementHash}.jpeg`
    );
    await fs.promises.mkdir(path.dirname(souvenirPath), { recursive: true });
    const souvenirArtwork = Buffer.from(`
      <svg width="1280" height="720" viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#080808"/>
            <stop offset="0.58" stop-color="#171717"/>
            <stop offset="1" stop-color="#050505"/>
          </linearGradient>
          <radialGradient id="halo" cx="50%" cy="45%" r="55%">
            <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
            <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="1280" height="720" fill="url(#bg)"/>
        <rect width="1280" height="720" fill="url(#halo)"/>
        <g fill="none" stroke="#ffffff" stroke-width="9" opacity="0.9">
          <circle cx="640" cy="286" r="108"/>
          <path d="M593 290l31 32 69-78" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
        <text x="640" y="465" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial" font-size="54" font-weight="700">RIGHT ON TIME</text>
        <text x="640" y="520" text-anchor="middle" fill="#b8b8b8" font-family="Segoe UI, Arial" font-size="26" letter-spacing="4">ACHIEVEMENT UNLOCKED · PORTAL 2</text>
        <rect x="80" y="74" width="1120" height="572" rx="30" fill="none" stroke="#ffffff" stroke-opacity="0.13" stroke-width="2"/>
        <text x="104" y="122" fill="#ffffff" font-family="Segoe UI, Arial" font-size="23" font-weight="700" letter-spacing="3">GAMEHUB SOUVENIR</text>
      </svg>
    `);
    await sharp(souvenirArtwork).jpeg({ quality: 88 }).toFile(souvenirPath);

    const souvenirs = database.sublevel("achievement-souvenirs", {
      valueEncoding: "json",
    });
    await souvenirs.put(
      JSON.stringify([user.id, "steam", "620", achievementName]),
      {
        schemaVersion: 1,
        ownerId: user.id,
        shop: "steam",
        objectId: "620",
        achievementName,
        achievementDisplayName: "Right on Time",
        achievementDescription:
          "Complete the chamber before the countdown reaches zero.",
        achievementIconUrl: `${assetOrigin}/__qa/assets/achievement-clock-icon.svg`,
        gameTitle: "Portal 2",
        gameIconUrl: `${assetOrigin}/__qa/assets/620-icon.svg`,
        unlockTime: Date.now() - 60_000,
        localPath: souvenirPath,
        r2Key: `users/${encodeURIComponent(user.id)}/achievement-souvenirs/steam/620/qa-visual.jpeg`,
        status: "synced",
        updatedAt: Date.now(),
      }
    );
  } finally {
    await database.close().catch(() => undefined);
  }
}

function assertGuardedClonePath() {
  const resolved = path.resolve(isolatedPortableRoot);
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`.toLowerCase();
  ensure(
    resolved.toLowerCase().startsWith(tempRoot),
    "Refusing cleanup because the clone is outside the OS temporary directory."
  );
  ensure(
    path.basename(resolved).startsWith("gamehub-bp-settings-qa-"),
    "Refusing cleanup because the clone does not have the QA prefix."
  );
}

function processIsAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function closeElectronTree(electronApp, launchedProcess) {
  if (electronApp) {
    await electronApp.close().catch(() => undefined);
  }
  const pid = launchedProcess?.pid;
  for (let attempt = 0; attempt < 20 && processIsAlive(pid); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (processIsAlive(pid) && process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  }
  ensure(!processIsAlive(pid), "The QA Electron process remained alive.");
}

async function findMainWindow(electronApp) {
  await electronApp.firstWindow({ timeout: 40_000 });
  let updateCheckerProceeded = false;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const mainWindow = electronApp.windows().find((candidate) => {
      try {
        const candidateUrl = new URL(candidate.url());
        return (
          candidateUrl.pathname.endsWith("/out/renderer/index.html") &&
          !candidateUrl.hash.includes("update-checker") &&
          !candidateUrl.hash.includes("achievement-notification") &&
          !candidateUrl.hash.includes("overlay") &&
          !candidateUrl.hash.includes("game-recorder-capture")
        );
      } catch {
        return false;
      }
    });
    if (mainWindow) return mainWindow;

    if (!updateCheckerProceeded && attempt > 8) {
      const checker = electronApp
        .windows()
        .find((candidate) => candidate.url().includes("update-checker"));
      if (checker) {
        updateCheckerProceeded = true;
        await checker
          .evaluate(() => globalThis.window.electron.updateCheckerProceed())
          .catch(() => undefined);
      }
    }
  }
  throw new Error("The isolated GameHub main window did not open.");
}

async function installMockXboxGamepad(page) {
  await page.evaluate(() => {
    const buttons = Array.from({ length: 17 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    const gamepad = {
      axes: [0, 0, 0, 0],
      buttons,
      connected: true,
      id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)",
      index: 0,
      mapping: "standard",
      timestamp: globalThis.performance.now(),
      vibrationActuator: null,
      hapticActuators: [],
    };

    Object.defineProperty(globalThis.navigator, "getGamepads", {
      configurable: true,
      value: () => [gamepad],
    });
    globalThis.__GAMEHUB_QA_GAMEPAD = gamepad;

    const connectedEvent = new Event("gamepadconnected");
    Object.defineProperty(connectedEvent, "gamepad", {
      configurable: true,
      value: gamepad,
    });
    globalThis.dispatchEvent(connectedEvent);
  });
  await page.waitForTimeout(180);
}

async function pressGamepadButton(page, buttonIndex) {
  await page.evaluate((index) => {
    const gamepad = globalThis.__GAMEHUB_QA_GAMEPAD;
    if (!gamepad) throw new Error("The QA gamepad is not connected.");
    const button = gamepad.buttons[index];
    if (!button) throw new Error("The requested QA gamepad button is absent.");
    button.pressed = true;
    button.touched = true;
    button.value = 1;
    gamepad.timestamp = globalThis.performance.now();
  }, buttonIndex);
  await page.waitForTimeout(90);
  await page.evaluate((index) => {
    const gamepad = globalThis.__GAMEHUB_QA_GAMEPAD;
    const button = gamepad?.buttons[index];
    if (!button) return;
    button.pressed = false;
    button.touched = false;
    button.value = 0;
    gamepad.timestamp = globalThis.performance.now();
  }, buttonIndex);
  await page.waitForTimeout(260);
}

async function navigateHash(page, target, rootSelector, options = {}) {
  if (options.bounce) {
    await page.evaluate(() => {
      globalThis.location.hash = "/big-picture";
    });
    await page.locator(".home-page").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.waitForTimeout(120);
  }

  await page.evaluate((nextTarget) => {
    globalThis.location.hash = nextTarget;
  }, target);
  await page.locator(rootSelector).first().waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page.waitForTimeout(420);
}

async function waitForCatalogueReadiness(page) {
  const catalogue = page.locator(".catalogue-results-page");

  await page.waitForFunction(
    () => {
      const root = globalThis.document.querySelector(".catalogue-results-page");
      if (!root) return false;

      const genres = root.querySelector('[data-catalogue-filter="genres"]');
      const tags = root.querySelector('[data-catalogue-filter="tags"]');
      const isFullyReady =
        root.getAttribute("data-catalogue-search-state") === "ready" &&
        root.getAttribute("data-catalogue-metadata-state") === "ready" &&
        root.querySelectorAll(".catalogue-card").length > 0 &&
        genres?.getAttribute("data-catalogue-filter-state") === "ready" &&
        Number(genres.getAttribute("data-catalogue-filter-count") ?? 0) > 0 &&
        tags?.getAttribute("data-catalogue-filter-state") === "ready" &&
        Number(tags.getAttribute("data-catalogue-filter-count") ?? 0) > 0;

      if (!isFullyReady) {
        globalThis.__GAMEHUB_QA_CATALOGUE_READY_SINCE = undefined;
        return false;
      }

      const now = globalThis.performance.now();
      globalThis.__GAMEHUB_QA_CATALOGUE_READY_SINCE ??= now;

      return now - globalThis.__GAMEHUB_QA_CATALOGUE_READY_SINCE >= 1_500;
    },
    undefined,
    { timeout: 60_000 }
  );

  const readiness = await catalogue.evaluate((root) => ({
    search: root.getAttribute("data-catalogue-search-state"),
    metadata: root.getAttribute("data-catalogue-metadata-state"),
    cards: root.querySelectorAll(".catalogue-card").length,
    genres: Number(
      root
        .querySelector('[data-catalogue-filter="genres"]')
        ?.getAttribute("data-catalogue-filter-count") ?? 0
    ),
    genreState: root
      .querySelector('[data-catalogue-filter="genres"]')
      ?.getAttribute("data-catalogue-filter-state"),
    tags: Number(
      root
        .querySelector('[data-catalogue-filter="tags"]')
        ?.getAttribute("data-catalogue-filter-count") ?? 0
    ),
    tagState: root
      .querySelector('[data-catalogue-filter="tags"]')
      ?.getAttribute("data-catalogue-filter-state"),
  }));

  ensure(
    readiness.search === "ready" && readiness.cards > 0,
    `Catalogue did not settle with real search results: ${JSON.stringify(
      readiness
    )}`
  );
  ensure(
    readiness.metadata === "ready" &&
      readiness.genreState === "ready" &&
      readiness.tagState === "ready" &&
      readiness.genres > 0 &&
      readiness.tags > 0,
    `Catalogue facets did not settle with real metadata: ${JSON.stringify(
      readiness
    )}`
  );
}

async function waitForHomeRecommendationReadiness(page) {
  await page
    .waitForFunction(
      () => {
        const text =
          globalThis.document.querySelector(".home-page")?.textContent;
        return Boolean(
          text?.includes("Recommended for you") &&
            text.includes("Because you played") &&
            text.includes("Recommended classics")
        );
      },
      undefined,
      { timeout: 45_000 }
    )
    .catch(() => undefined);
  const rows = await page
    .locator(".home-page .focus-carousel")
    .evaluateAll((carousels) =>
      carousels.map((carousel) => ({
        title: carousel.querySelector("h2")?.textContent?.trim() ?? "",
        horizontalCards: carousel.querySelectorAll(
          ".game-card--horizontal, [data-card-variant='horizontal']"
        ).length,
        cards: carousel.querySelectorAll(".focus-carousel__slide").length,
      }))
    );
  ensure(
    rows.some((row) => row.title === "Recommended for you" && row.cards > 0),
    `The ML recommendation row did not populate: ${JSON.stringify(rows)}`
  );
  ensure(
    rows.some((row) => row.title.startsWith("Because you played")),
    `The because-you-played row did not populate: ${JSON.stringify(rows)}`
  );
  ensure(
    rows.some((row) => row.title === "Recommended classics" && row.cards > 0),
    `The classics recommendation row did not populate: ${JSON.stringify(rows)}`
  );
}

async function waitForProfileReadiness(page) {
  await page
    .locator('.bp-profile[data-profile-ready="true"]')
    .waitFor({ state: "visible", timeout: 45_000 });
  await page.locator(".bp-profile__hero").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page.locator(".bp-profile__stats").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  const alerts = await page
    .locator(".bp-profile__status[role='alert']")
    .allInnerTexts();
  ensure(
    alerts.length === 0,
    `The profile settled into a partial or failed state: ${alerts.join(" | ")}; recent API: ${JSON.stringify(qaApiProxy?.state.requestPaths.slice(-12) ?? [])}`
  );
}

async function assertProfileDatasetDedupe(page) {
  const cards = await page.locator(".bp-profile__game").evaluateAll((items) =>
    items.map((item) => {
      const title = item.querySelector(".bp-profile__game__title")?.textContent;
      return String(title ?? "")
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]/g, "");
    })
  );
  ensure(
    cards.length === new Set(cards).size,
    `The profile rendered duplicate game cards: ${JSON.stringify(cards)}`
  );
}

async function assertRemoteProfileFixture(page) {
  const profile = page.locator('.bp-profile[data-profile-owner="remote"]');
  await profile.waitFor({ state: "visible", timeout: 20_000 });
  const profileText = await profile.innerText();
  const remoteDisplayName = await profile
    .locator(".bp-profile__hero__name")
    .innerText();
  ensure(
    remoteDisplayName.trim() === "Raven QA",
    "The profile-id route did not render the distinct remote identity."
  );
  ensure(
    profileText.includes("Friends-only profile") &&
      profileText.includes("Controller-first player"),
    "The remote profile fixture did not prove privacy and profile copy."
  );

  const banner = page.locator(".bp-profile__hero__banner");
  await banner.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(
    () => {
      const image = globalThis.document.querySelector(
        ".bp-profile__hero__banner"
      );
      return (
        image instanceof HTMLImageElement &&
        image.complete &&
        image.naturalWidth > 0
      );
    },
    undefined,
    { timeout: 20_000 }
  );

  ensure(
    (await page.locator(".bp-profile__game").count()) === 4,
    "The remote profile did not expose its complete deduplicated library."
  );
  await assertProfileDatasetDedupe(page);

  const playtimeCard = page
    .locator(".bp-profile__stat-card")
    .filter({ hasText: "Play time" });
  const playtimeGeometry = await playtimeCard.evaluate((card) => {
    const value = card.querySelector(".bp-profile__stat-card__value");
    if (!(value instanceof HTMLElement)) return null;
    return {
      text: value.innerText,
      clientHeight: value.clientHeight,
      scrollHeight: value.scrollHeight,
      whiteSpace: globalThis.getComputedStyle(value).whiteSpace,
    };
  });
  ensure(
    playtimeGeometry &&
      playtimeGeometry.text.includes("1,209") &&
      playtimeGeometry.whiteSpace === "nowrap" &&
      playtimeGeometry.scrollHeight <= playtimeGeometry.clientHeight + 1,
    `The 1,209-hour profile stat wrapped or clipped: ${JSON.stringify(
      playtimeGeometry
    )}`
  );
}

async function waitForGamePresentationReadiness(page) {
  await page
    .locator('.game-page[data-game-ready="true"]')
    .waitFor({ state: "visible", timeout: 45_000 });
  await page
    .locator('.game-page__hero-shell[data-hero-ready="true"]')
    .waitFor({ state: "visible", timeout: 20_000 });
  ensure(
    (await page.locator(".game-page__hero-loading").count()) === 0,
    "The game route retained its visual-readiness fallback after settling."
  );

  const cloudButton = page.locator("#game-hero-open-cloud-save");
  if ((await cloudButton.count()) > 0) {
    await page.waitForFunction(
      () =>
        globalThis.document
          .getElementById("game-hero-open-cloud-save")
          ?.getAttribute("data-cloud-save-ready") === "true",
      undefined,
      { timeout: 45_000 }
    );
  }
}

async function waitForExophaseAuthReadiness(page) {
  const authCard = page.locator("[data-exophase-auth-state]");
  await authCard.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(
    () =>
      globalThis.document
        .querySelector("[data-exophase-auth-state]")
        ?.getAttribute("data-exophase-auth-state") !== "validating",
    undefined,
    { timeout: 45_000 }
  );

  const state = await authCard.getAttribute("data-exophase-auth-state");
  const username = await authCard.getAttribute("data-exophase-auth-username");
  const copy = await authCard.innerText();
  ensure(
    (state === "verified" || state === "cached") &&
      Boolean(username) &&
      copy.includes(`Authenticated as ${username}`),
    `The saved Exophase account was not presented consistently (${state ?? "missing"}).`
  );
}

async function focusNavigationItem(page, locator, expectedId = null) {
  const item = locator.first();
  await item.waitFor({ state: "visible", timeout: 20_000 });
  await item.scrollIntoViewIfNeeded();
  let focusedId = null;
  const attempts = expectedId ? 4 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await page.evaluate(() => {
        if (globalThis.document.activeElement instanceof HTMLElement) {
          globalThis.document.activeElement.blur();
        }
      });
    }
    await item.focus();
    await item.evaluate((element) => {
      element.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    await page.waitForTimeout(100);
    focusedId = await page.evaluate(() => {
      return (
        globalThis.document.querySelector("[data-focus-visible='true']")?.id ??
        null
      );
    });
    if (!expectedId || focusedId === expectedId) break;
  }
  if (expectedId) {
    const domFocus = await page.evaluate(() => {
      const active = globalThis.document.activeElement;
      return active instanceof HTMLElement
        ? {
            id: active.id || null,
            navigationState: active.getAttribute("data-navigation-state"),
            disabled:
              active instanceof HTMLButtonElement ? active.disabled : null,
          }
        : null;
    });
    ensure(
      focusedId === expectedId,
      `Controller focus did not settle on the expected item (${expectedId}); actual focus: ${focusedId ?? "none"}; DOM focus: ${JSON.stringify(domFocus)}.`
    );
  } else {
    ensure(focusedId, "Controller focus did not settle on a navigation item.");
  }
  return focusedId;
}

async function selectedBigPictureSettingsLabel(page) {
  return page
    .getByRole("tab", { selected: true })
    .first()
    .innerText({ timeout: 10_000 });
}

async function moveGamepadFocusTo(
  page,
  expectedId,
  buttonIndex,
  maximumSteps = 20
) {
  for (let step = 0; step <= maximumSteps; step += 1) {
    const focusedId = await page.evaluate(
      () =>
        globalThis.document.querySelector("[data-focus-visible='true']")?.id ??
        null
    );
    if (focusedId === expectedId) return;
    if (step < maximumSteps) {
      await pressGamepadButton(page, buttonIndex);
    }
  }
  const actual = await page.evaluate(
    () =>
      globalThis.document.querySelector("[data-focus-visible='true']")?.id ??
      null
  );
  throw new Error(
    `Gamepad navigation did not reach ${expectedId}; actual focus: ${actual ?? "none"}.`
  );
}

async function captureViewport(page, caseId, viewport) {
  if (!shouldCapture(viewport.id)) return null;
  const safeCaseId = caseId.replaceAll(/[^a-z0-9-]+/gi, "-").toLowerCase();
  const absolute = path.join(
    screenshotRoot,
    `${safeCaseId}--${viewport.id}.png`
  );
  const size = page.viewportSize();
  if (size) {
    await page.mouse.move(size.width - 2, size.height - 2);
  }
  await page.screenshot({ path: absolute, fullPage: false });
  return relativeArtifact(absolute);
}

async function assertResponsiveSurface(page, rootSelector) {
  const result = await page
    .locator(rootSelector)
    .first()
    .evaluate((root) => {
      const viewportWidth = globalThis.innerWidth;
      const viewportHeight = globalThis.innerHeight;
      const rootRect = root.getBoundingClientRect();
      const rootStyle = globalThis.getComputedStyle(root);
      const rootVisible =
        rootRect.width > 2 &&
        rootRect.height > 2 &&
        rootStyle.display !== "none" &&
        rootStyle.visibility !== "hidden";
      const hasContent =
        (root.textContent?.trim().length ?? 0) > 0 ||
        root.querySelector("img, svg, canvas, video") !== null;

      const hasManagedOverflowAncestor = (element) => {
        let current = element.parentElement;
        while (current && current !== root.parentElement) {
          const style = globalThis.getComputedStyle(current);
          if (current.matches(".focus-carousel__viewport")) {
            return true;
          }
          if (current.matches(".game-page__media-carousel-viewport")) {
            return true;
          }
          if (
            (style.overflowX === "auto" || style.overflowX === "scroll") &&
            current.scrollWidth > current.clientWidth + 1
          ) {
            return true;
          }
          current = current.parentElement;
        }
        return false;
      };

      const isVisuallyHidden = (element) => {
        let current = element;
        while (current && current !== root.parentElement) {
          const style = globalThis.getComputedStyle(current);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            Number(style.opacity) === 0 ||
            current.hidden ||
            current.getAttribute("aria-hidden") === "true"
          ) {
            return true;
          }
          current = current.parentElement;
        }
        return false;
      };

      const focusableSelector = [
        "button",
        "a[href]",
        "input:not([type='hidden'])",
        "select",
        "textarea",
        "[tabindex]",
        "[role='button']",
        "[role='tab']",
        "[role='option']",
        "[data-focus-visible]",
      ].join(",");

      const clippedControls = Array.from(
        root.querySelectorAll(focusableSelector)
      )
        .filter((element) => {
          if (
            isVisuallyHidden(element) ||
            hasManagedOverflowAncestor(element)
          ) {
            return false;
          }
          const rect = element.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) return false;
          if (rect.bottom <= 0 || rect.top >= viewportHeight) return false;
          return rect.left < -1 || rect.right > viewportWidth + 1;
        })
        .map((element) => {
          const classes = Array.from(element.classList).slice(0, 2);
          const label =
            element.getAttribute("aria-label") ??
            element.textContent?.trim().replaceAll(/\s+/g, " ").slice(0, 36) ??
            "";
          const rect = element.getBoundingClientRect();
          return `${element.tagName.toLowerCase()}${
            classes.length ? `.${classes.join(".")}` : ""
          }[${label}]@${Math.round(rect.left)}..${Math.round(rect.right)}`;
        })
        .slice(0, 10);

      const settingsTabs = globalThis.document.querySelector(
        ".settings-page__tabs-wrap"
      );
      const headerProfile = globalThis.document.querySelector(
        ".header__profile .user-profile-container"
      );
      let settingsRailClear = true;
      let settingsRailGeometry = null;
      let settingsShellGeometry = null;
      let settingsFirstSectionGeometry = null;
      let settingsContentObstructions = [];
      if (root.matches(".settings-page") && settingsTabs && headerProfile) {
        const tabsRect = settingsTabs.getBoundingClientRect();
        const profileRect = headerProfile.getBoundingClientRect();
        const sidebar = globalThis.document.querySelector(".sidebar-container");
        const header = globalThis.document.querySelector(".header__container");
        const selectedTab = settingsTabs.querySelector(
          '[role="tab"][aria-selected="true"]'
        );
        const tabViewport = settingsTabs.querySelector(".tabs__list");
        const sidebarRect = sidebar?.getBoundingClientRect() ?? null;
        const headerRect = header?.getBoundingClientRect() ?? null;
        const selectedTabRect = selectedTab?.getBoundingClientRect() ?? null;
        const tabViewportRect = tabViewport?.getBoundingClientRect() ?? null;
        settingsRailClear =
          tabsRect.top >= profileRect.bottom - 1 &&
          tabsRect.bottom > profileRect.bottom &&
          tabsRect.top < viewportHeight;
        settingsRailGeometry = {
          tabsTop: Math.round(tabsRect.top),
          tabsBottom: Math.round(tabsRect.bottom),
          profileBottom: Math.round(profileRect.bottom),
        };
        settingsShellGeometry = {
          pageScrollLeft: Math.round(root.scrollLeft),
          sidebarLeft: sidebarRect ? Math.round(sidebarRect.left) : null,
          sidebarRight: sidebarRect ? Math.round(sidebarRect.right) : null,
          headerLeft: headerRect ? Math.round(headerRect.left) : null,
          headerRight: headerRect ? Math.round(headerRect.right) : null,
          profileLeft: Math.round(profileRect.left),
          profileRight: Math.round(profileRect.right),
          selectedTabLeft: selectedTabRect
            ? Math.round(selectedTabRect.left)
            : null,
          selectedTabRight: selectedTabRect
            ? Math.round(selectedTabRect.right)
            : null,
          tabViewportLeft: tabViewportRect
            ? Math.round(tabViewportRect.left)
            : null,
          tabViewportRight: tabViewportRect
            ? Math.round(tabViewportRect.right)
            : null,
        };
        const visibleSettingsSections = Array.from(
          root.querySelectorAll(
            ".settings-page__content .settings-section__header, .settings-page__content .emulation-settings__header, .settings-page__content .emulator-detail__hero"
          )
        ).filter((element) => !isVisuallyHidden(element));
        const firstSettingsSection = visibleSettingsSections
          .map((element) => ({
            element,
            rect: element.getBoundingClientRect(),
          }))
          .sort((left, right) => left.rect.top - right.rect.top)[0];
        settingsFirstSectionGeometry = firstSettingsSection
          ? {
              railBottom: Math.round(tabsRect.bottom),
              firstSectionTop: Math.round(firstSettingsSection.rect.top),
              pageScrollTop: Math.round(root.scrollTop),
            }
          : null;
        settingsContentObstructions = visibleSettingsSections
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.bottom > tabsRect.top && rect.top < tabsRect.bottom;
          })
          .map((element) =>
            element.textContent?.trim().replaceAll(/\s+/g, " ").slice(0, 56)
          )
          .filter(Boolean);
      }

      return {
        rootVisible,
        hasContent,
        rootLeft: Math.round(rootRect.left),
        rootRight: Math.round(rootRect.right),
        viewportWidth,
        documentScrollWidth: globalThis.document.documentElement.scrollWidth,
        clippedControls,
        settingsRailClear,
        settingsRailGeometry,
        settingsShellGeometry,
        settingsFirstSectionGeometry,
        settingsContentObstructions,
      };
    });

  ensure(result.rootVisible, `${rootSelector} is not visibly rendered.`);
  ensure(result.hasContent, `${rootSelector} rendered no visible content.`);
  ensure(
    result.rootLeft >= -1 && result.rootRight <= result.viewportWidth + 1,
    `${rootSelector} extends beyond the horizontal viewport.`
  );
  ensure(
    result.documentScrollWidth <= result.viewportWidth + 1,
    `${rootSelector} creates page-level horizontal overflow.`
  );
  ensure(
    result.clippedControls.length === 0,
    `${rootSelector} clips controls: ${result.clippedControls.join(", ")}`
  );
  ensure(
    result.settingsRailClear,
    `${rootSelector} places its tab rail under the profile header: ${JSON.stringify(
      result.settingsRailGeometry
    )}`
  );
  if (result.settingsShellGeometry) {
    const geometry = result.settingsShellGeometry;
    ensure(
      geometry.pageScrollLeft === 0 &&
        geometry.sidebarLeft === 0 &&
        geometry.sidebarRight === 72 &&
        geometry.headerLeft >= 72 &&
        geometry.headerRight <= result.viewportWidth + 1 &&
        geometry.profileLeft >= 0 &&
        geometry.profileRight <= result.viewportWidth + 1,
      `${rootSelector} displaced the app shell: ${JSON.stringify(geometry)}`
    );
    ensure(
      geometry.selectedTabLeft >= geometry.tabViewportLeft - 1 &&
        geometry.selectedTabRight <= geometry.tabViewportRight + 1,
      `${rootSelector} did not reveal its selected tab inside the rail: ${JSON.stringify(
        geometry
      )}`
    );
  }
  ensure(
    result.settingsContentObstructions.length === 0,
    `${rootSelector} places Settings content under the sticky rail: ${result.settingsContentObstructions.join(
      ", "
    )}`
  );
  if (result.settingsFirstSectionGeometry) {
    const geometry = result.settingsFirstSectionGeometry;
    ensure(
      geometry.railBottom <= geometry.firstSectionTop,
      `${rootSelector} does not reserve the sticky rail footprint after reset: ${JSON.stringify(
        geometry
      )}`
    );
  }
}

async function assertModalOwnsSettingsRail(page, dialog) {
  await page.waitForFunction(() => {
    const openDialog = globalThis.document.querySelector(
      '[role="dialog"][aria-modal="true"]'
    );
    const focused = globalThis.document.querySelector(
      "[data-focus-visible='true']"
    );
    return Boolean(openDialog && focused && openDialog.contains(focused));
  });

  const result = await dialog.evaluate((openDialog) => {
    const backdrop = openDialog.closest(".backdrop");
    const rail = globalThis.document.querySelector("[data-settings-tab-rail]");
    const focused = globalThis.document.querySelector(
      "[data-focus-visible='true']"
    );
    if (!backdrop || !rail) return null;

    const backdropRect = backdrop.getBoundingClientRect();
    const railRect = rail.getBoundingClientRect();
    const backdropStyle = globalThis.getComputedStyle(backdrop);
    const railStyle = globalThis.getComputedStyle(rail);
    const railCenter = globalThis.document.elementFromPoint(
      railRect.left + railRect.width / 2,
      railRect.top + railRect.height / 2
    );

    return {
      backdropZ: Number.parseInt(backdropStyle.zIndex, 10) || 0,
      railZ: Number.parseInt(railStyle.zIndex, 10) || 0,
      coversRail:
        backdropRect.left <= railRect.left &&
        backdropRect.top <= railRect.top &&
        backdropRect.right >= railRect.right &&
        backdropRect.bottom >= railRect.bottom,
      interceptsRail: Boolean(railCenter?.closest(".backdrop")),
      pointerEvents: backdropStyle.pointerEvents,
      focusedInside: Boolean(focused && openDialog.contains(focused)),
    };
  });

  ensure(result, "The open modal has no Settings backdrop or rail.");
  ensure(
    result.backdropZ > result.railZ &&
      result.coversRail &&
      result.interceptsRail &&
      result.pointerEvents !== "none" &&
      result.focusedInside,
    `The modal did not visually and interactively own the Settings rail: ${JSON.stringify(
      result
    )}`
  );
}

async function assertOcarinaMetadata(page) {
  const heroDescription = page.locator(".game-page__hero-description");
  const heroDescriptionToggle = page.locator("#game-hero-description-toggle");
  const playtime = page.locator(".game-page__playtime-bar");
  const emulatorDetails = page.getByRole("region", {
    name: "Emulator details",
  });
  const gameInfo = page.getByRole("region", { name: "Game info" });
  const howLongToBeat = page.locator(".game-page__how-long-to-beat");
  const heroArtwork = page
    .locator(".game-page__hero .animated-hero-image__main")
    .first();

  await Promise.all([
    heroDescription.waitFor({ state: "visible", timeout: 30_000 }),
    heroDescriptionToggle.waitFor({ state: "visible", timeout: 30_000 }),
    playtime.waitFor({ state: "visible", timeout: 30_000 }),
    emulatorDetails.waitFor({ state: "visible", timeout: 30_000 }),
    gameInfo.waitFor({ state: "attached", timeout: 30_000 }),
    howLongToBeat.waitFor({ state: "attached", timeout: 30_000 }),
    heroArtwork.waitFor({ state: "visible", timeout: 30_000 }),
  ]);
  await heroArtwork.evaluate(
    (image) =>
      new Promise((resolve, reject) => {
        if (!(image instanceof HTMLImageElement)) {
          reject(new Error("Ocarina hero artwork is not an image."));
          return;
        }
        if (image.complete && image.naturalWidth > 0) {
          resolve(undefined);
          return;
        }
        const timeoutId = globalThis.setTimeout(
          () => reject(new Error("Ocarina hero artwork did not load.")),
          30_000
        );
        image.addEventListener(
          "load",
          () => {
            globalThis.clearTimeout(timeoutId);
            resolve(undefined);
          },
          { once: true }
        );
        image.addEventListener(
          "error",
          () => {
            globalThis.clearTimeout(timeoutId);
            reject(new Error("Ocarina hero artwork failed to load."));
          },
          { once: true }
        );
      })
  );

  const descriptionText = (await heroDescription.innerText()).trim();
  const playtimeText = (await playtime.innerText()).trim();
  const emulatorDetailsText = (await emulatorDetails.innerText()).trim();
  const metadataText = (await gameInfo.innerText()).trim();
  const heroDescriptionGeometry = await heroDescription.evaluate(
    (description) => {
      const style = globalThis.getComputedStyle(description);
      const lineHeight = Number.parseFloat(style.lineHeight);
      const viewportWidth = globalThis.innerWidth;
      const viewportHeight = globalThis.innerHeight;
      const expectedLineLimit =
        viewportWidth <= 1100 || viewportHeight <= 760
          ? 3
          : viewportWidth <= 1440
            ? 4
            : 5;

      return {
        childElementCount: description.childElementCount,
        clientHeight: description.clientHeight,
        scrollHeight: description.scrollHeight,
        renderedLines:
          Number.isFinite(lineHeight) && lineHeight > 0
            ? description.clientHeight / lineHeight
            : null,
        expectedLineLimit,
        expanded: description.getAttribute("data-expanded"),
      };
    }
  );

  ensure(
    descriptionText.length >= 24,
    "Ocarina did not expose a real game description."
  );
  ensure(
    heroDescriptionGeometry.childElementCount === 0 &&
      !/[<>]|javascript:|onerror=/i.test(descriptionText),
    "Ocarina hero description rendered raw or unsafe markup instead of inert text."
  );
  ensure(
    heroDescriptionGeometry.expanded === "false" &&
      heroDescriptionGeometry.scrollHeight >
        heroDescriptionGeometry.clientHeight + 1 &&
      heroDescriptionGeometry.renderedLines !== null &&
      heroDescriptionGeometry.renderedLines <=
        heroDescriptionGeometry.expectedLineLimit + 0.25,
    `Ocarina hero description is not collapsed to its responsive line budget: ${JSON.stringify(
      heroDescriptionGeometry
    )}`
  );
  ensure(
    (await heroDescriptionToggle.getAttribute("aria-expanded")) === "false" &&
      (await heroDescriptionToggle.innerText()).includes("Read more"),
    "Ocarina hero description does not expose the collapsed Read more control."
  );
  ensure(
    playtimeText.includes("Played for"),
    "Ocarina did not expose its real playtime bar."
  );
  for (const expected of ["Emulator Game", "Nintendo 3DS", "Azahar"]) {
    ensure(
      emulatorDetailsText.includes(expected),
      `Ocarina emulator details are missing ${expected}.`
    );
  }
  for (const expected of [
    "Puzzle",
    "Adventure",
    "Nintendo EAD",
    "Grezzo",
    "Nintendo",
    "2011",
    "CERO RP",
    "Critics 95",
  ]) {
    ensure(
      metadataText.includes(expected),
      `Ocarina metadata is missing ${expected}.`
    );
  }
  ensure(
    !(
      emulatorDetailsText.includes("Downloads") ||
      emulatorDetailsText.includes("Playing now")
    ),
    "Ocarina still exposes fabricated Hydra activity statistics."
  );
  ensure(
    (await page.locator(".game-page__comments").count()) === 0,
    "Ocarina still renders Hydra community reviews."
  );
  ensure(
    (await page.locator(".game-page__achievements").count()) === 0,
    "Ocarina renders an empty achievements card despite lacking definitions."
  );
}

async function applyViewport(page, viewport) {
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  // Chromium briefly paints a compositor-only dimensions badge after a live
  // resize. Waiting here keeps proof screenshots free of that transient UI.
  await page.waitForTimeout(900);
}

async function putQaEmulatorState(electronApp, config, configured) {
  await electronApp.evaluate(
    async (_electron, fixture) => {
      const sublevel = globalThis.__levelSublevels?.emulatorsSublevel;
      if (!sublevel) {
        throw new Error("The emulator QA clone sublevel is unavailable.");
      }
      const next = {
        ...fixture.config,
        executablePath: fixture.configured
          ? `${process.env.WINDIR ?? "C:\\Windows"}\\System32\\where.exe`
          : null,
        detectedVersion: fixture.configured ? "QA" : null,
        detectedAt: fixture.configured ? Date.now() : null,
      };
      await sublevel.put(fixture.config.system, next);
    },
    { config, configured }
  );
}

const report = {
  schemaVersion: 1,
  suite: "big-picture-settings-acceptance",
  executionMode: CASE_FILTER ? "targeted" : "full",
  startedAt: new Date().toISOString(),
  source: USE_SYNTHETIC_PROFILE
    ? "isolated-synthetic-populated-profile-with-read-only-route-fixtures"
    : "isolated-populated-profile-clone-with-read-only-route-fixtures",
  expectedCoverage: {
    bigPictureRoutes: 12,
    bigPictureSettingsTabs: BP_SETTINGS_TABS.length,
    desktopSettingsCategories: DESKTOP_SETTINGS_CATEGORIES.length,
    emulatorSystems: EMULATOR_SYSTEMS.length,
    emulatorPathsPerSystem: 2,
    ocarinaMetadataCases: 2,
    profileControllerCases: 2,
    populatedFriendsCases: 1,
    responsiveViewports: VIEWPORTS.length,
  },
  cases: [],
  pageErrors: [],
  processDiagnostics: {
    stderrChunkCount: 0,
  },
  cleanup: {
    electronStopped: false,
    qaApiProxyStopped: false,
    cloneRemoved: false,
  },
};

async function runCase(id, metadata, action) {
  if (CASE_FILTER && !CASE_FILTER.test(id)) return null;
  const started = Date.now();
  try {
    const detail = (await action()) ?? {};
    report.cases.push({
      id,
      status: "passed",
      durationMs: Date.now() - started,
      ...metadata,
      ...detail,
    });
    console.log(`PASS ${id}`);
    return true;
  } catch (error) {
    report.cases.push({
      id,
      status: "failed",
      durationMs: Date.now() - started,
      ...metadata,
      error: sanitizeText(error instanceof Error ? error.message : error),
    });
    console.error(`FAIL ${id}: ${sanitizeText(error)}`);
    return false;
  }
}

let electronApp = null;
let launchedProcess = null;
let qaApiProxy = null;
let fatalError = null;

try {
  await prepareIsolatedClone();
  const { r2CredentialsUrl, hydraApiUrl } =
    await discoverInstalledConfiguration();
  qaApiProxy = await startReadOnlyHydraApiProxy(hydraApiUrl);
  // Patch the clone directly before Electron starts. Calling the production
  // updateUserPreferences IPC would also schedule an R2 settings backup; a
  // visual acceptance runner must never write remote account state.
  await patchIsolatedPreferences(qaApiProxy.url);
  const { _electron: electron } = await import(
    pathToFileURL(path.join(playwrightPackage, "index.mjs")).href
  );

  electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [
      mainEntry,
      "--no-sandbox",
      "--force-device-scale-factor=1",
      "--high-dpi-support=1",
    ],
    cwd: repositoryRoot,
    timeout: 60_000,
    env: {
      ...process.env,
      APPDATA: isolatedPortableRoot,
      LOCALAPPDATA: isolatedPortableRoot,
      PORTABLE_EXECUTABLE_DIR: isolatedPortableRoot,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      GAMEHUB_READ_ONLY_VISUAL_QA: "true",
      GAMEHUB_R2_CREDENTIALS_URL: r2CredentialsUrl,
      GAMEHUB_API_URL: qaApiProxy.url,
    },
  });
  launchedProcess = electronApp.process();
  launchedProcess.stderr?.on("data", () => {
    report.processDiagnostics.stderrChunkCount += 1;
  });

  const page = await findMainWindow(electronApp);
  page.on("pageerror", (error) => {
    const recentRequests = qaApiProxy?.state.requestPaths.slice(-12) ?? [];
    const upstreamRequests =
      qaApiProxy?.state.upstreamRequests.slice(-12) ?? [];
    report.pageErrors.push(
      `${sanitizeText(error?.stack || error?.message || String(error))}; upstream API: ${JSON.stringify(upstreamRequests)}; recent API: ${JSON.stringify(recentRequests)}`
    );
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(
    () =>
      (globalThis.document.getElementById("root")?.childElementCount ?? 0) > 0,
    undefined,
    { timeout: 30_000 }
  );
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
      }
    `,
  });

  await page.evaluate(() => {
    globalThis.localStorage.setItem(
      "hydra-classics-onboarding-dismissed",
      "true"
    );
  });

  const fixture = await page.evaluate(async () => {
    const [user, library, emulatorConfigs] = await Promise.all([
      globalThis.window.electron.getMe(),
      globalThis.window.electron.getLibrary(),
      globalThis.window.electron.getEmulatorConfigs(),
    ]);
    const game = library.find(
      (candidate) =>
        !candidate.isDeleted && candidate.shop && candidate.objectId
    );
    return {
      userId: user?.id ?? null,
      game: game
        ? { shop: String(game.shop), objectId: String(game.objectId) }
        : null,
      emulatorConfigs,
    };
  });

  ensure(fixture.userId, "The cloned populated profile is not signed in.");
  ensure(fixture.game, "The cloned populated library has no routable game.");
  ensure(
    EMULATOR_SYSTEMS.every((system) => fixture.emulatorConfigs[system.id]),
    "The emulator configuration map is not exhaustive."
  );

  // Mount Big Picture before dispatching `gamepadconnected`; its singleton
  // installs the browser listener lazily when the BP hooks first synchronize.
  await navigateHash(page, "/big-picture", ".home-page");
  await installMockXboxGamepad(page);

  await runCase(
    "bp-home-populated-controller-full-hd",
    {
      area: "big-picture-home",
      fixture: "deterministic-populated-read-only",
      input: "dpad",
      viewport: VIEWPORTS[2].id,
    },
    async () => {
      await applyViewport(page, VIEWPORTS[2]);
      await navigateHash(page, "/big-picture", ".home-page", { bounce: true });
      await waitForHomeRecommendationReadiness(page);
      const horizontalRows = await page
        .locator('.home-page .focus-carousel[data-card-variant="horizontal"]')
        .count();
      ensure(
        horizontalRows >= 3,
        `The populated home did not render the requested horizontal rows (${horizontalRows}).`
      );
      const firstRecommendation = page
        .locator('[id^="home-recommended-game-"]')
        .first();
      const firstId = await focusNavigationItem(page, firstRecommendation);
      await pressGamepadButton(page, GAMEPAD_BUTTON.right);
      const focusedAfterRight = await page.evaluate(
        () =>
          globalThis.document.querySelector("[data-focus-visible='true']")
            ?.id ?? null
      );
      ensure(
        focusedAfterRight?.startsWith("home-recommended-game-") &&
          focusedAfterRight !== firstId,
        `Controller Right did not advance the ML recommendation row (${focusedAfterRight}).`
      );
      const screenshot = await captureViewport(
        page,
        "bp-home-populated-controller",
        VIEWPORTS[2]
      );
      await assertResponsiveSurface(page, ".home-page");
      return screenshot ? { screenshot } : {};
    }
  );

  await runCase(
    "bp-library-nested-console-filters-controller-full-hd",
    {
      area: "big-picture-library",
      fixture: "deterministic-populated-read-only",
      input: "dpad-a-lb-rb",
      viewport: VIEWPORTS[2].id,
    },
    async () => {
      await applyViewport(page, VIEWPORTS[2]);
      await navigateHash(page, "/big-picture/library", ".library-page", {
        bounce: true,
      });
      const heroFallback = page.locator(".hero__logo__fallback");
      await heroFallback.waitFor({ state: "visible", timeout: 20_000 });
      const heroTitleGeometry = await heroFallback.evaluate((title) => {
        const titleRect = title.getBoundingClientRect();
        const logoRect = title.parentElement?.getBoundingClientRect() ?? null;
        return {
          titleTop: titleRect.top,
          titleRight: titleRect.right,
          titleBottom: titleRect.bottom,
          titleLeft: titleRect.left,
          logoTop: logoRect?.top ?? null,
          logoRight: logoRect?.right ?? null,
          logoBottom: logoRect?.bottom ?? null,
          logoLeft: logoRect?.left ?? null,
          fontSize: Number.parseFloat(
            globalThis.getComputedStyle(title).fontSize
          ),
        };
      });
      ensure(
        heroTitleGeometry.logoTop !== null &&
          heroTitleGeometry.titleTop >= heroTitleGeometry.logoTop - 1 &&
          heroTitleGeometry.titleRight <= heroTitleGeometry.logoRight + 1 &&
          heroTitleGeometry.titleBottom <= heroTitleGeometry.logoBottom + 1 &&
          heroTitleGeometry.titleLeft >= heroTitleGeometry.logoLeft - 1 &&
          heroTitleGeometry.fontSize <= 40.5,
        `The long Library hero fallback title is clipped or oversized: ${JSON.stringify(heroTitleGeometry)}`
      );

      await focusNavigationItem(
        page,
        page.locator("#library-hero-launch-button"),
        "library-hero-launch-button"
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.a);
      const downloadDialog = page.getByRole("dialog", {
        name: "The Legend of Zelda - Ocarina of Time 3D",
      });
      await downloadDialog.waitFor({ state: "visible", timeout: 20_000 });
      ensure(
        (await downloadDialog
          .getByText("Pick a repack from your download sources", {
            exact: true,
          })
          .count()) === 1,
        "Controller A on the Library hero Download Game action did not open the real download flow."
      );
      const downloadModalScreenshot = await captureViewport(
        page,
        "bp-library-hero-download-modal-controller",
        VIEWPORTS[2]
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.b);
      await downloadDialog.waitFor({ state: "hidden", timeout: 10_000 });
      ensure(
        (await page.evaluate(
          () =>
            globalThis.document.querySelector("[data-focus-visible='true']")
              ?.id ?? null
        )) === "library-hero-launch-button",
        "Closing the Library hero download modal did not restore controller focus."
      );

      const consoleParentId = "library-filters-platform-pill-console";
      await pressGamepadButton(page, GAMEPAD_BUTTON.down);
      await moveGamepadFocusTo(page, consoleParentId, GAMEPAD_BUTTON.right, 20);
      await pressGamepadButton(page, GAMEPAD_BUTTON.a);
      const consoleRow = page.locator(
        '[data-focus-region-id="library-filters-consoles"]'
      );
      await consoleRow.waitFor({ state: "visible", timeout: 10_000 });
      await focusNavigationItem(
        page,
        page.locator("#library-filters-console-pill-all"),
        "library-filters-console-pill-all"
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.right);
      ensure(
        (await page.evaluate(
          () =>
            globalThis.document.querySelector("[data-focus-visible='true']")
              ?.id ?? null
        )) === "library-filters-console-pill-n3ds",
        "Controller Right did not enter the nested Nintendo 3DS console filter."
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.a);
      ensure(
        (await page
          .locator("#library-filters-console-pill-n3ds")
          .getAttribute("aria-pressed")) === "true",
        "Controller A did not select the Nintendo 3DS filter."
      );
      const libraryText = await page.locator(".library-page").innerText();
      ensure(
        libraryText.includes("Ocarina of Time 3D") &&
          !libraryText.includes("Breath of the Wild"),
        "The selected 3DS filter did not isolate the nested console library."
      );
      await page.locator(".library-page").evaluate((libraryPage) => {
        libraryPage.scrollTop = 0;
      });
      await page.waitForTimeout(220);
      const screenshot = await captureViewport(
        page,
        "bp-library-nested-console-filters-controller",
        VIEWPORTS[2]
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.rb);
      ensure(
        (await page
          .locator("#library-filters-tab-favorites")
          .getAttribute("aria-selected")) === "true",
        "R1/RB did not switch the Library tab to Favorites."
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.lb);
      ensure(
        (await page
          .locator("#library-filters-tab-all")
          .getAttribute("aria-selected")) === "true",
        "L1/LB did not switch the Library tab back to All."
      );

      const libraryCard = page
        .locator('[id^="library-focus-grid-item-"]')
        .first();
      const libraryCardId = await focusNavigationItem(page, libraryCard);
      await pressGamepadButton(page, GAMEPAD_BUTTON.y);
      const gameContextMenu = page.getByRole("menu", {
        name: "Game context menu",
      });
      await gameContextMenu.waitFor({ state: "visible", timeout: 10_000 });
      const removeFromLibrary = gameContextMenu.getByRole("menuitem", {
        name: "Remove from Library",
      });
      const removeFocusId = await removeFromLibrary.getAttribute("id");
      ensure(removeFocusId, "The Remove from Library action has no focus id.");
      await focusNavigationItem(page, removeFromLibrary, removeFocusId);
      await pressGamepadButton(page, GAMEPAD_BUTTON.a);
      const removeDialog = page.getByRole("dialog", {
        name: "Remove from library?",
      });
      await removeDialog.waitFor({ state: "visible", timeout: 10_000 });
      const removeConfirmationScreenshot = await captureViewport(
        page,
        "bp-library-remove-confirmation-controller",
        VIEWPORTS[2]
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.b);
      await removeDialog.waitFor({ state: "hidden", timeout: 10_000 });
      ensure(
        (await page.evaluate(
          () =>
            globalThis.document.querySelector("[data-focus-visible='true']")
              ?.id ?? null
        )) === libraryCardId,
        "Closing the Remove from Library confirmation did not restore card focus."
      );
      ensure(
        qaApiProxy.state.mutationRequests.length === 0,
        "Inspecting the Remove from Library confirmation attempted a write."
      );
      await assertResponsiveSurface(page, ".library-page");
      return {
        ...(screenshot ? { screenshot } : {}),
        ...(downloadModalScreenshot ? { downloadModalScreenshot } : {}),
        ...(removeConfirmationScreenshot
          ? { removeConfirmationScreenshot }
          : {}),
      };
    }
  );

  await runCase(
    "bp-profile-sidebar-avatar-achievements-stat-controller-full-hd",
    {
      area: "big-picture-profile",
      fixture: "deterministic-populated-read-only",
      input: "a",
      viewport: VIEWPORTS[2].id,
    },
    async () => {
      await applyViewport(page, VIEWPORTS[2]);
      await navigateHash(page, "/big-picture/profile", ".bp-profile", {
        bounce: true,
      });
      await waitForProfileReadiness(page);
      const profileAvatar = page.locator("#big-picture-sidebar-profile img");
      await profileAvatar.waitFor({ state: "visible", timeout: 20_000 });
      ensure(
        await profileAvatar.evaluate(
          (image) =>
            image.complete && image.naturalWidth > 0 && image.alt === "Profile"
        ),
        "The sidebar Profile route did not render the signed-in profile picture."
      );
      await focusNavigationItem(
        page,
        page.locator("#profile-achievements-stat"),
        "profile-achievements-stat"
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.a);
      const profileState = await page
        .locator(".bp-profile")
        .evaluate((root) => ({
          view: root.getAttribute("data-profile-view"),
          focus:
            globalThis.document.querySelector("[data-focus-visible='true']")
              ?.id ?? null,
        }));
      ensure(
        profileState.view === "achievements" &&
          profileState.focus === "profile-tab-achievements",
        `The profile achievement statistic did not route to the tab: ${JSON.stringify(profileState)}`
      );
      const screenshot = await captureViewport(
        page,
        "bp-profile-sidebar-avatar-achievements-stat-controller",
        VIEWPORTS[2]
      );
      await assertResponsiveSurface(page, ".bp-profile");
      return screenshot ? { screenshot } : {};
    }
  );

  const encodedGameRoute = `${encodeURIComponent(
    fixture.game.shop
  )}/${encodeURIComponent(fixture.game.objectId)}`;
  const encodedProfileId = encodeURIComponent(QA_REMOTE_PROFILE_ID);
  const bigPictureRoutes = [
    { id: "home", path: "/big-picture", selector: ".home-page" },
    {
      id: "catalogue",
      path: "/big-picture/catalogue",
      selector: ".catalogue-results-page",
    },
    {
      id: "component-lab",
      path: "/big-picture/component-lab",
      selector: ".catalogue-page",
    },
    {
      id: "downloads",
      path: "/big-picture/downloads",
      selector: ".downloads-page",
    },
    {
      id: "settings",
      path: "/big-picture/settings",
      selector: ".settings-page",
    },
    {
      id: "cloud-saves",
      path: "/big-picture/cloud-saves",
      selector: ".cloud-saves-page",
    },
    {
      id: "library",
      path: "/big-picture/library",
      selector: ".library-page",
    },
    {
      id: "profile-own",
      path: "/big-picture/profile",
      selector: ".bp-profile",
    },
    {
      id: "profile-id",
      path: `/big-picture/profile/${encodedProfileId}`,
      selector: ".bp-profile",
    },
    {
      id: "friends",
      path: "/big-picture/friends",
      selector: ".bp-friends",
    },
    {
      id: "game",
      path: `/big-picture/game/${encodedGameRoute}`,
      selector: ".game-page",
    },
    {
      id: "game-achievements",
      path: `/big-picture/game/${encodedGameRoute}/achievements`,
      selector: ".game-achievements-page",
    },
  ];

  for (const route of bigPictureRoutes) {
    for (const viewport of VIEWPORTS) {
      await runCase(
        `bp-route-${route.id}-${viewport.id}`,
        { area: "big-picture-route", route: route.id, viewport: viewport.id },
        async () => {
          await applyViewport(page, viewport);
          await navigateHash(page, route.path, route.selector);
          let screenshot = null;
          if (route.id === "home") {
            await waitForHomeRecommendationReadiness(page);
            await page.locator(".home-page").evaluate((homePage) => {
              homePage.scrollTop = 0;
            });
            await page.waitForTimeout(220);
            screenshot = await captureViewport(
              page,
              `bp-route-${route.id}`,
              viewport
            );
            const firstRecommendation = page
              .locator('[id^="home-recommended-game-"]')
              .first();
            const firstId = await focusNavigationItem(
              page,
              firstRecommendation
            );
            await pressGamepadButton(page, GAMEPAD_BUTTON.right);
            const focusedAfterRight = await page.evaluate(
              () =>
                globalThis.document.querySelector("[data-focus-visible='true']")
                  ?.id ?? null
            );
            ensure(
              focusedAfterRight?.startsWith("home-recommended-game-") &&
                focusedAfterRight !== firstId,
              `Controller Right did not traverse the ${viewport.id} Home recommendation row (${focusedAfterRight}).`
            );
          }
          if (route.id === "library") {
            await page
              .locator(".hero__logo__fallback")
              .waitFor({ state: "visible", timeout: 20_000 });
            await page.locator(".library-page").evaluate((libraryPage) => {
              libraryPage.scrollTop = 0;
            });
            await page.waitForTimeout(220);
            screenshot = await captureViewport(
              page,
              `bp-route-${route.id}`,
              viewport
            );
            await focusNavigationItem(
              page,
              page.locator("#library-filters-tab-all"),
              "library-filters-tab-all"
            );
            await pressGamepadButton(page, GAMEPAD_BUTTON.right);
            ensure(
              (await page.evaluate(
                () =>
                  globalThis.document.querySelector(
                    "[data-focus-visible='true']"
                  )?.id ?? null
              )) === "library-filters-tab-favorites",
              `Controller Right did not traverse the ${viewport.id} Library tabs.`
            );
          }
          if (route.id === "cloud-saves") {
            await page
              .locator(".cloud-saves-page__status")
              .waitFor({ state: "hidden", timeout: 60_000 });
            ensure(
              (await page
                .locator(
                  ".cloud-saves-page__count, .cloud-saves-page__empty, .cloud-saves-page__error"
                )
                .count()) > 0,
              "Cloud Saves did not settle into a count, empty, or error state."
            );
          }
          if (route.id === "catalogue") {
            await waitForCatalogueReadiness(page);
          }
          if (route.id === "profile-own" || route.id === "profile-id") {
            await waitForProfileReadiness(page);
            await assertProfileDatasetDedupe(page);
            if (route.id === "profile-id") {
              await assertRemoteProfileFixture(page);
            }
            if (route.id === "profile-own") {
              await page.locator(".bp-profile").evaluate((profilePage) => {
                profilePage.scrollTop = 0;
              });
              await page.waitForTimeout(220);
              screenshot = await captureViewport(
                page,
                `bp-route-${route.id}`,
                viewport
              );
              await focusNavigationItem(
                page,
                page.locator("#profile-tab-games"),
                "profile-tab-games"
              );
              await pressGamepadButton(page, GAMEPAD_BUTTON.right);
              ensure(
                (await page.evaluate(
                  () =>
                    globalThis.document.querySelector(
                      "[data-focus-visible='true']"
                    )?.id ?? null
                )) === "profile-tab-achievements",
                `Controller Right did not traverse the ${viewport.id} Profile tabs.`
              );
            }
          }
          if (route.id === "game") {
            await waitForGamePresentationReadiness(page);
          }
          if (route.id === "game-achievements") {
            ensure(
              (await page.locator(".empty-state").count()) === 0,
              "The no-achievements route still uses the error-X empty state."
            );
            if ((await page.locator(".game-achievements-row").count()) === 0) {
              ensure(
                (await page
                  .locator(".game-achievements-page__empty")
                  .count()) === 1,
                "The no-achievements route did not render its neutral trophy state."
              );
            }
          }
          if (route.id === "downloads") {
            ensure(
              (await page
                .locator(".sidebar-container")
                .getByText("Downloads", { exact: true })
                .count()) === 1,
              "The Big Picture side drawer does not use the Downloads label."
            );
          }
          if (route.id === "friends") {
            await page.waitForFunction(
              () =>
                !globalThis.document
                  .querySelector(".bp-friends")
                  ?.textContent?.includes("Loading friends"),
              undefined,
              { timeout: 30_000 }
            );
            ensure(
              (await page.locator('[id^="friend:"]').count()) === 0 &&
                (await page.locator(".bp-friends").innerText()).includes(
                  "haven't added any friends"
                ),
              "The real cloned Kewz Friends case no longer reflects its truthful empty state."
            );
          }
          screenshot ??= await captureViewport(
            page,
            `bp-route-${route.id}`,
            viewport
          );
          await assertResponsiveSurface(page, route.selector);
          return screenshot ? { screenshot } : {};
        }
      );
    }
  }

  for (const profileCase of [
    { id: "own", path: "/big-picture/profile" },
    {
      id: "remote",
      path: `/big-picture/profile/${encodeURIComponent(QA_REMOTE_PROFILE_ID)}`,
    },
  ]) {
    await runCase(
      `bp-profile-${profileCase.id}-controller-tabs-full-hd`,
      {
        area: "big-picture-profile",
        profile: profileCase.id,
        input: "dpad",
        viewport: VIEWPORTS[2].id,
      },
      async () => {
        await applyViewport(page, VIEWPORTS[2]);
        await navigateHash(page, profileCase.path, ".bp-profile", {
          bounce: true,
        });
        await waitForProfileReadiness(page);
        if (profileCase.id === "remote") {
          await assertRemoteProfileFixture(page);
        }

        await focusNavigationItem(
          page,
          page.locator("#profile-tab-games"),
          "profile-tab-games"
        );
        await pressGamepadButton(page, GAMEPAD_BUTTON.right);
        ensure(
          (await page.evaluate(
            () =>
              globalThis.document.querySelector("[data-focus-visible='true']")
                ?.id ?? null
          )) === "profile-tab-achievements",
          "Controller Right did not move from Games to Achievements."
        );
        await page.waitForFunction(
          () =>
            globalThis.document
              .querySelector(".bp-profile")
              ?.getAttribute("data-profile-view") === "achievements"
        );

        await focusNavigationItem(
          page,
          page.locator("#profile-sort\\:playedRecently"),
          "profile-sort:playedRecently"
        );
        for (const expected of [
          ["profile-sort:playtime", "playtime"],
          ["profile-sort:achievementCount", "achievementCount"],
          ["profile-sort:title", "title"],
        ]) {
          await pressGamepadButton(page, GAMEPAD_BUTTON.right);
          const state = await page.evaluate(() => ({
            focus:
              globalThis.document.querySelector("[data-focus-visible='true']")
                ?.id ?? null,
            sort:
              globalThis.document
                .querySelector(".bp-profile")
                ?.getAttribute("data-profile-sort") ?? null,
          }));
          ensure(
            state.focus === expected[0] && state.sort === expected[1],
            `Controller sort navigation did not settle on ${expected[1]}: ${JSON.stringify(
              state
            )}`
          );
        }

        await assertProfileDatasetDedupe(page);
        const screenshot = await captureViewport(
          page,
          `bp-profile-${profileCase.id}-achievements-controller`,
          VIEWPORTS[2]
        );
        await assertResponsiveSurface(page, ".bp-profile");
        return screenshot ? { screenshot } : {};
      }
    );
  }

  await runCase(
    "bp-profile-own-souvenirs-controller-full-hd",
    {
      area: "big-picture-profile",
      profile: "own",
      view: "souvenirs",
      fixture: "account-scoped-local-only",
      input: "dpad-and-primary-back",
      viewport: VIEWPORTS[2].id,
    },
    async () => {
      await applyViewport(page, VIEWPORTS[2]);
      await navigateHash(page, "/big-picture/profile", ".bp-profile", {
        bounce: true,
      });
      await waitForProfileReadiness(page);

      await focusNavigationItem(
        page,
        page.locator("#profile-tab-souvenirs"),
        "profile-tab-souvenirs"
      );
      await page.waitForFunction(
        () =>
          globalThis.document
            .querySelector(".bp-profile")
            ?.getAttribute("data-profile-view") === "souvenirs"
      );

      const souvenir = page.locator(
        "#profile-souvenir\\:steam\\:620\\:QA_VISUAL_SOUVENIR"
      );
      await souvenir.waitFor({ state: "visible", timeout: 30_000 });
      const souvenirImage = souvenir.locator(".bp-profile__souvenir__image");
      await souvenirImage.waitFor({ state: "visible" });
      ensure(
        await souvenirImage.evaluate(
          (image) => image.complete && image.naturalWidth > 0
        ),
        "The account-scoped souvenir image did not finish decoding."
      );
      const souvenirText = await souvenir.innerText();
      ensure(
        souvenirText.includes("Right on Time") &&
          souvenirText.includes(
            "Complete the chamber before the countdown reaches zero."
          ) &&
          (await souvenir
            .locator(".bp-profile__souvenir__achievement-icon")
            .count()) === 1,
        "The Big Picture souvenir does not show its achievement icon, title, and description."
      );
      await focusNavigationItem(
        page,
        souvenir,
        "profile-souvenir:steam:620:QA_VISUAL_SOUVENIR"
      );
      const galleryScreenshot = await captureViewport(
        page,
        "bp-profile-own-souvenirs-controller",
        VIEWPORTS[2]
      );

      await pressGamepadButton(page, GAMEPAD_BUTTON.a);
      const lightbox = page.locator(".image-lightbox__surface");
      await lightbox.waitFor({ state: "visible", timeout: 10_000 });
      const lightboxScreenshot = await captureViewport(
        page,
        "bp-profile-own-souvenir-lightbox-controller",
        VIEWPORTS[2]
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.b);
      await lightbox.waitFor({ state: "hidden", timeout: 10_000 });
      ensure(
        (await page.evaluate(
          () =>
            globalThis.document.querySelector("[data-focus-visible='true']")
              ?.id ?? null
        )) === "profile-souvenir:steam:620:QA_VISUAL_SOUVENIR",
        "Closing the souvenir lightbox did not preserve controller focus."
      );
      await assertResponsiveSurface(page, ".bp-profile");
      return {
        ...(galleryScreenshot ? { screenshot: galleryScreenshot } : {}),
        ...(lightboxScreenshot
          ? { lightboxScreenshot: lightboxScreenshot }
          : {}),
      };
    }
  );

  await runCase(
    "desktop-profile-own-souvenirs-full-hd",
    {
      area: "desktop-profile",
      profile: "own",
      view: "souvenirs",
      fixture: "account-scoped-local-only",
      viewport: VIEWPORTS[2].id,
    },
    async () => {
      await applyViewport(page, VIEWPORTS[2]);
      await navigateHash(
        page,
        `/profile/${encodeURIComponent(fixture.userId)}`,
        ".profile__wrapper",
        { bounce: true }
      );

      const souvenirsTab = page.getByRole("button", { name: /Souvenirs/i });
      await souvenirsTab.waitFor({ state: "visible", timeout: 30_000 });
      await souvenirsTab.click();
      const souvenirs = page.locator(".profile-souvenirs");
      await souvenirs.waitFor({ state: "visible", timeout: 20_000 });
      const preview = page.getByRole("button", {
        name: "View Right on Time souvenir",
      });
      await preview.waitFor({ state: "visible", timeout: 20_000 });
      const previewImage = preview.locator(":scope > img");
      await previewImage.waitFor({ state: "visible" });
      ensure(
        await previewImage.evaluate(
          (image) => image.complete && image.naturalWidth > 0
        ),
        "The desktop souvenir preview did not decode."
      );
      ensure(
        (await page
          .getByRole("button", {
            name: "Delete Right on Time souvenir",
          })
          .count()) === 1,
        "The desktop souvenir delete action is missing."
      );
      const galleryScreenshot = await captureViewport(
        page,
        "desktop-profile-own-souvenirs",
        VIEWPORTS[2]
      );

      await preview.click();
      const lightbox = page.locator(".fullscreen-media-modal");
      await lightbox.waitFor({ state: "visible", timeout: 10_000 });
      const lightboxScreenshot = await captureViewport(
        page,
        "desktop-profile-own-souvenir-lightbox",
        VIEWPORTS[2]
      );
      await page.keyboard.press("Escape");
      await lightbox.waitFor({ state: "hidden", timeout: 10_000 });

      await page
        .getByRole("button", { name: "Delete Right on Time souvenir" })
        .click();
      const deleteDialog = page.locator(".modal:has(.confirmation-modal)");
      await deleteDialog.waitFor({ state: "visible", timeout: 10_000 });
      ensure(
        (await deleteDialog.locator("h3").innerText()) ===
          "Delete achievement souvenir?",
        "The desktop delete confirmation title is incorrect."
      );
      await deleteDialog.getByRole("button", { name: "Cancel" }).click();
      await deleteDialog.waitFor({ state: "hidden", timeout: 10_000 });
      ensure(
        qaApiProxy.state.mutationRequests.length === 0,
        `Desktop souvenir inspection attempted a network write: ${JSON.stringify(
          qaApiProxy.state.mutationRequests
        )}`
      );
      await assertResponsiveSurface(page, ".profile__wrapper");
      return {
        ...(galleryScreenshot ? { screenshot: galleryScreenshot } : {}),
        ...(lightboxScreenshot
          ? { lightboxScreenshot: lightboxScreenshot }
          : {}),
      };
    }
  );

  await runCase(
    "bp-friends-populated-controller-full-hd",
    {
      area: "big-picture-friends",
      fixture: "deterministic-populated-read-only",
      input: "dpad-and-primary",
      viewport: VIEWPORTS[2].id,
    },
    async () => {
      qaApiProxy.state.friendsPopulated = true;
      await applyViewport(page, VIEWPORTS[2]);
      await navigateHash(page, "/big-picture/friends", ".bp-friends", {
        bounce: true,
      });
      await page
        .locator("#friend\\:qa-friend-ingame")
        .waitFor({ state: "visible", timeout: 20_000 });

      const friendsText = await page.locator(".bp-friends").innerText();
      for (const expected of [
        "Nova In Game",
        "Hades II",
        "Echo Online",
        "Online",
        "Mira Offline",
        "Offline",
      ]) {
        ensure(
          friendsText.includes(expected),
          `The populated Friends fixture is missing ${expected}.`
        );
      }

      await focusNavigationItem(
        page,
        page.locator("#friend\\:qa-friend-ingame"),
        "friend:qa-friend-ingame"
      );
      const focusedScreenshot = await captureViewport(
        page,
        "bp-friends-populated-controller",
        VIEWPORTS[2]
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.down);
      ensure(
        (await page.evaluate(
          () =>
            globalThis.document.querySelector("[data-focus-visible='true']")
              ?.id ?? null
        )) === "friend:qa-friend-online",
        "Controller Down did not move from the in-game friend to the online friend."
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.a);
      await page.waitForFunction(
        () => globalThis.location.hash.includes("profile/qa-friend-online"),
        undefined,
        { timeout: 10_000 }
      );
      await waitForProfileReadiness(page);
      ensure(
        (await page
          .locator('.bp-profile[data-profile-owner="remote"]')
          .count()) === 1,
        "The Friends primary action did not open the selected remote profile."
      );
      ensure(
        qaApiProxy.state.mutationRequests.length === 0,
        `The populated Friends case attempted a network write: ${JSON.stringify(
          qaApiProxy.state.mutationRequests
        )}`
      );
      await assertResponsiveSurface(page, ".bp-profile");
      return focusedScreenshot ? { screenshot: focusedScreenshot } : {};
    }
  );
  qaApiProxy.state.friendsPopulated = false;

  await runCase(
    "bp-ocarina-metadata-full-hd",
    {
      area: "big-picture-emulator-game",
      game: "ocarina-of-time-3d",
      viewport: VIEWPORTS[2].id,
    },
    async () => {
      await applyViewport(page, VIEWPORTS[2]);
      await navigateHash(page, OCARINA_ROUTE, ".game-page", { bounce: true });
      await waitForGamePresentationReadiness(page);
      await page
        .locator(".game-page__hero-shell")
        .waitFor({ state: "visible", timeout: 30_000 });
      await assertOcarinaMetadata(page);
      const collapsedScreenshot = await captureViewport(
        page,
        "bp-ocarina-description-collapsed",
        VIEWPORTS[2]
      );
      await assertResponsiveSurface(page, ".game-page");

      await focusNavigationItem(
        page,
        page.locator("#game-hero-primary-action"),
        "game-hero-primary-action"
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.up);
      ensure(
        (await page.evaluate(
          () =>
            globalThis.document.querySelector("[data-focus-visible='true']")
              ?.id ?? null
        )) === "game-hero-description-toggle",
        "Controller Up from the hero action row did not reach Read more."
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.a);
      await page.waitForFunction(
        () =>
          globalThis.document
            .getElementById("game-hero-description-toggle")
            ?.getAttribute("aria-expanded") === "true"
      );
      const expandedGeometry = await page
        .locator(".game-page__hero-description")
        .evaluate((description) => ({
          expanded: description.getAttribute("data-expanded"),
          clientHeight: description.clientHeight,
          scrollHeight: description.scrollHeight,
          childElementCount: description.childElementCount,
        }));
      ensure(
        expandedGeometry.expanded === "true" &&
          expandedGeometry.clientHeight >= expandedGeometry.scrollHeight - 1 &&
          expandedGeometry.childElementCount === 0 &&
          (
            await page.locator("#game-hero-description-toggle").innerText()
          ).includes("Show less"),
        `Expanded hero description did not expose its complete inert text: ${JSON.stringify(
          expandedGeometry
        )}`
      );
      const expandedScreenshot = await captureViewport(
        page,
        "bp-ocarina-description-expanded",
        VIEWPORTS[2]
      );
      await assertResponsiveSurface(page, ".game-page");

      await pressGamepadButton(page, GAMEPAD_BUTTON.a);
      await page.waitForFunction(
        () =>
          globalThis.document
            .getElementById("game-hero-description-toggle")
            ?.getAttribute("aria-expanded") === "false"
      );
      ensure(
        (await page.evaluate(
          () =>
            globalThis.document.querySelector("[data-focus-visible='true']")
              ?.id ?? null
        )) === "game-hero-description-toggle",
        "Show less did not restore controller focus to the description toggle."
      );

      return {
        screenshots: [collapsedScreenshot, expandedScreenshot].filter(Boolean),
      };
    }
  );

  await runCase(
    "bp-ocarina-sidebar-controller-hd",
    {
      area: "big-picture-emulator-game",
      game: "ocarina-of-time-3d",
      input: "dpad",
      viewport: VIEWPORTS[1].id,
    },
    async () => {
      await applyViewport(page, VIEWPORTS[1]);
      await navigateHash(page, OCARINA_ROUTE, ".game-page", { bounce: true });
      await waitForGamePresentationReadiness(page);
      await page
        .locator("#game-sidebar-stats")
        .waitFor({ state: "visible", timeout: 30_000 });
      await assertOcarinaMetadata(page);
      const initialScreenshot = await captureViewport(
        page,
        "bp-ocarina-controller-start",
        VIEWPORTS[1]
      );

      await focusNavigationItem(
        page,
        page.locator("#game-sidebar-stats"),
        "game-sidebar-stats"
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.down);
      ensure(
        (await page.evaluate(
          () =>
            globalThis.document.querySelector("[data-focus-visible='true']")
              ?.id ?? null
        )) === "game-sidebar-hltb",
        "Ocarina controller focus did not move from Emulator Game to HLTB."
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.down);
      ensure(
        (await page.evaluate(
          () =>
            globalThis.document.querySelector("[data-focus-visible='true']")
              ?.id ?? null
        )) === "game-sidebar-metadata",
        "Ocarina controller focus did not move from HLTB to metadata."
      );

      const scrolledScreenshot = await captureViewport(
        page,
        "bp-ocarina-sidebar-metadata",
        VIEWPORTS[1]
      );
      await assertResponsiveSurface(page, ".game-page");
      return {
        screenshots: [initialScreenshot, scrolledScreenshot].filter(Boolean),
      };
    }
  );

  for (const tab of BP_SETTINGS_TABS) {
    for (const viewport of VIEWPORTS) {
      await runCase(
        `bp-settings-${tab.id}-${viewport.id}`,
        {
          area: "big-picture-settings",
          tab: tab.id,
          viewport: viewport.id,
        },
        async () => {
          await applyViewport(page, viewport);
          await navigateHash(
            page,
            `/big-picture/settings?tab=${tab.id}`,
            ".settings-page"
          );
          await page
            .getByRole("tab", { name: tab.label, selected: true })
            .waitFor({ state: "visible", timeout: 20_000 });
          const screenshot = await captureViewport(
            page,
            `bp-settings-${tab.id}`,
            viewport
          );
          await assertResponsiveSurface(page, ".settings-page");
          if (tab.id === "content") {
            await page
              .locator(".content-settings-section__capture-status")
              .waitFor({ state: "visible", timeout: 20_000 });
            await page
              .getByRole("checkbox", { name: "Enable gameplay capture" })
              .waitFor({ state: "visible", timeout: 20_000 });
            await page
              .locator("#content-game-recorder-resolution")
              .waitFor({ state: "visible", timeout: 20_000 });
          }
          if (tab.id === "account-privacy") {
            const copy = await page
              .locator(".account-privacy-settings-section")
              .innerText();
            ensure(
              copy.includes("Cloud Saves V2") &&
                copy.includes("R2") &&
                copy.includes("No subscription") &&
                !/Hydra Cloud|Become Hydra|Renew Hydra|subscription plan/i.test(
                  copy
                ),
              "Account and Privacy does not describe the no-subscription R2 Cloud Saves service truthfully."
            );
          }
          return screenshot ? { screenshot } : {};
        }
      );
    }
  }

  for (const category of DESKTOP_SETTINGS_CATEGORIES) {
    for (const viewport of VIEWPORTS) {
      await runCase(
        `desktop-settings-${category}-${viewport.id}`,
        {
          area: "desktop-settings",
          category,
          viewport: viewport.id,
        },
        async () => {
          await applyViewport(page, viewport);
          await navigateHash(
            page,
            `/settings?tab=${category}`,
            ".settings__container"
          );
          const categoryTab = page.locator(
            `[data-settings-category="${category}"]`
          );
          const panel = page.locator(`[data-settings-panel="${category}"]`);
          await categoryTab.waitFor({ state: "visible", timeout: 20_000 });
          await panel.waitFor({ state: "visible", timeout: 20_000 });
          if (category === "achievements") {
            await waitForExophaseAuthReadiness(page);
          }
          ensure(
            (await categoryTab.getAttribute("aria-selected")) === "true",
            `Desktop Settings did not select ${category}.`
          );
          const screenshot = await captureViewport(
            page,
            `desktop-settings-${category}`,
            viewport
          );
          await assertResponsiveSurface(page, ".settings__container");
          return screenshot ? { screenshot } : {};
        }
      );
    }
  }

  await runCase(
    "desktop-settings-global-trackers-full-hd",
    {
      area: "desktop-settings",
      category: "downloads",
      feature: "global-trackers",
      fixture: "local-preferences-only",
      viewport: VIEWPORTS[2].id,
    },
    async () => {
      await applyViewport(page, VIEWPORTS[2]);
      await navigateHash(
        page,
        "/settings?tab=downloads",
        ".settings__container"
      );
      const trackers = page.locator(".settings-global-trackers");
      await trackers.waitFor({ state: "visible", timeout: 20_000 });
      await trackers.scrollIntoViewIfNeeded();
      const trackerInput = page.locator("#settings-global-trackers-input");
      const trackerText = await trackerInput.inputValue();
      ensure(
        trackerText.includes("udp://tracker.example.test:6969/announce") &&
          trackerText.includes("https://tracker.example.test/announce"),
        "The global tracker settings did not load the isolated local fixture."
      );
      ensure(
        await page.locator("#settings-append-global-trackers").isChecked(),
        "The append-global-trackers preference did not render as enabled."
      );
      const screenshot = await captureViewport(
        page,
        "desktop-settings-global-trackers",
        VIEWPORTS[2]
      );
      await assertResponsiveSurface(page, ".settings__container");
      return screenshot ? { screenshot } : {};
    }
  );

  await runCase(
    "controller-dpad-focus-polling",
    { area: "controller", input: "dpad" },
    async () => {
      await applyViewport(page, VIEWPORTS[1]);
      await navigateHash(page, "/big-picture", ".home-page");
      await focusNavigationItem(
        page,
        page.locator("#big-picture-sidebar-home"),
        "big-picture-sidebar-home"
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.down);
      const focusedAfterDown = await page.evaluate(
        () =>
          globalThis.document.querySelector("[data-focus-visible='true']")
            ?.id ?? null
      );
      ensure(
        focusedAfterDown && focusedAfterDown !== "big-picture-sidebar-home",
        "A mocked Xbox D-pad press did not move controller focus."
      );
      const screenshot = await captureViewport(
        page,
        "controller-dpad-focus-polling",
        VIEWPORTS[1]
      );
      return screenshot ? { screenshot } : {};
    }
  );

  await runCase(
    "controller-modal-a-b-layer-restoration",
    { area: "controller", input: "a-b", layer: "modal" },
    async () => {
      await applyViewport(page, VIEWPORTS[1]);
      await navigateHash(page, "/big-picture/component-lab", ".catalogue-page");
      const openButton = page.getByRole("button", { name: "Open Modal" });
      const openerId = await focusNavigationItem(page, openButton);
      await pressGamepadButton(page, GAMEPAD_BUTTON.a);
      const dialog = page.getByRole("dialog", {
        name: "Component Lab Example",
      });
      await dialog.waitFor({ state: "visible", timeout: 10_000 });
      const hashWhileOpen = await page.evaluate(() => globalThis.location.hash);
      const screenshot = await captureViewport(
        page,
        "controller-modal-open",
        VIEWPORTS[1]
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.b);
      await dialog.waitFor({ state: "hidden", timeout: 10_000 });
      ensure(
        (await page.evaluate(() => globalThis.location.hash)) === hashWhileOpen,
        "B escaped the page instead of closing only the active modal layer."
      );
      const restoredId = await page.evaluate(
        () =>
          globalThis.document.querySelector("[data-focus-visible='true']")
            ?.id ?? null
      );
      ensure(
        restoredId === openerId,
        "Closing the modal did not restore controller focus to its opener."
      );
      return screenshot ? { screenshot } : {};
    }
  );

  await runCase(
    "controller-virtual-keyboard-b-layer-restoration",
    { area: "controller", input: "a-b", layer: "virtual-keyboard" },
    async () => {
      await applyViewport(page, VIEWPORTS[1]);
      await navigateHash(
        page,
        "/big-picture/component-lab",
        ".catalogue-page",
        { bounce: true }
      );
      const inputContainer = page
        .locator(".input-container")
        .filter({ hasText: "Default" })
        .first();
      const inputFocusWrapper = inputContainer.locator(
        "[data-focus-wrapper='true']"
      );
      const openerId = await focusNavigationItem(page, inputFocusWrapper);
      const hashBeforeOpen = await page.evaluate(
        () => globalThis.location.hash
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.a);
      const keyboard = page.locator(".virtual-keyboard");
      await keyboard.waitFor({ state: "visible", timeout: 10_000 });
      const screenshot = await captureViewport(
        page,
        "controller-virtual-keyboard-open",
        VIEWPORTS[1]
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.b);
      await keyboard.waitFor({ state: "hidden", timeout: 10_000 });
      ensure(
        (await page.evaluate(() => globalThis.location.hash)) ===
          hashBeforeOpen,
        "B escaped the page instead of closing only the virtual keyboard."
      );
      const restoredId = await page.evaluate(
        () =>
          globalThis.document.querySelector("[data-focus-visible='true']")
            ?.id ?? null
      );
      ensure(
        restoredId === openerId,
        "Closing the virtual keyboard did not restore its input focus item."
      );
      return screenshot ? { screenshot } : {};
    }
  );

  await runCase(
    "controller-dropdown-b-layer-and-bumpers",
    { area: "controller", input: "a-b-lb-rb", layer: "dropdown" },
    async () => {
      await applyViewport(page, VIEWPORTS[1]);
      await navigateHash(
        page,
        "/big-picture/settings?tab=content",
        ".settings-page",
        { bounce: true }
      );
      await page
        .getByRole("tab", { name: "Content", selected: true })
        .waitFor({ state: "visible", timeout: 10_000 });
      const trigger = page.locator("#content-game-recorder-resolution");
      await trigger.waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForFunction(
        () => {
          const element = globalThis.document.getElementById(
            "content-game-recorder-resolution"
          );
          return element instanceof HTMLButtonElement && !element.disabled;
        },
        undefined,
        { timeout: 10_000 }
      );
      await moveGamepadFocusTo(
        page,
        "content-game-recorder-resolution",
        GAMEPAD_BUTTON.down,
        12
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.a);
      const dropdown = page.locator(".dropdown-select__menu");
      await dropdown.waitFor({ state: "visible", timeout: 10_000 });
      ensure(
        (await selectedBigPictureSettingsLabel(page)).trim() === "Content",
        "The expected Content tab was not selected before bumper isolation."
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.rb);
      ensure(
        (await selectedBigPictureSettingsLabel(page)).trim() === "Content",
        "RB changed the background tab while a dropdown layer was active."
      );
      const screenshot = await captureViewport(
        page,
        "controller-dropdown-open",
        VIEWPORTS[1]
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.b);
      await dropdown.waitFor({ state: "hidden", timeout: 10_000 });
      ensure(
        (await trigger.getAttribute("aria-expanded")) === "false",
        "B did not close the active dropdown."
      );
      ensure(
        (await page.evaluate(
          () =>
            globalThis.document.querySelector("[data-focus-visible='true']")
              ?.id ?? null
        )) === "content-game-recorder-resolution",
        "Dropdown close did not restore its trigger focus."
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.rb);
      const selectedAfterRightBumper = (
        await selectedBigPictureSettingsLabel(page)
      ).trim();
      ensure(
        selectedAfterRightBumper === "Big Picture",
        `RB did not move to the next Settings tab after the layer closed (selected: ${selectedAfterRightBumper}).`
      );
      await pressGamepadButton(page, GAMEPAD_BUTTON.lb);
      ensure(
        (await selectedBigPictureSettingsLabel(page)).trim() === "Content",
        "LB did not return to the previous Settings tab."
      );
      return screenshot ? { screenshot } : {};
    }
  );

  await runCase(
    "desktop-settings-keyboard-tab-loop",
    { area: "desktop-settings", input: "keyboard" },
    async () => {
      await applyViewport(page, VIEWPORTS[1]);
      await navigateHash(page, "/settings?tab=general", ".settings__container");
      const general = page.locator('[data-settings-category="general"]');
      await general.focus();
      await page.keyboard.press("End");
      await page
        .locator('[data-settings-panel="account_privacy"]')
        .waitFor({ state: "visible", timeout: 10_000 });
      await page.keyboard.press("ArrowRight");
      await page
        .locator('[data-settings-panel="general"]')
        .waitFor({ state: "visible", timeout: 10_000 });
      ensure(
        (await general.getAttribute("aria-selected")) === "true",
        "Desktop Settings keyboard navigation did not wrap to General."
      );
    }
  );

  for (const system of EMULATOR_SYSTEMS) {
    const baseConfig = fixture.emulatorConfigs[system.id];
    await putQaEmulatorState(electronApp, baseConfig, false);

    for (const viewport of EMULATOR_VIEWPORTS) {
      await runCase(
        `emulator-${system.id}-setup-${viewport.id}`,
        {
          area: "emulator-setup",
          system: system.id,
          viewport: viewport.id,
        },
        async () => {
          await applyViewport(page, viewport);
          await navigateHash(
            page,
            "/big-picture/settings?tab=emulation",
            ".settings-page",
            { bounce: true }
          );
          await page
            .getByRole("tab", { name: "Emulation", selected: true })
            .waitFor({ state: "visible", timeout: 20_000 });
          const cardId = `emulation-overview-${system.id}-card`;
          await focusNavigationItem(page, page.locator(`#${cardId}`), cardId);
          await pressGamepadButton(page, GAMEPAD_BUTTON.a);
          const dialog = page.getByRole("dialog", {
            name: `Set up ${system.label}`,
          });
          await dialog.waitFor({ state: "visible", timeout: 20_000 });
          await assertModalOwnsSettingsRail(page, dialog);
          const screenshot = await captureViewport(
            page,
            `emulator-${system.id}-setup`,
            viewport
          );
          await assertResponsiveSurface(page, ".emulator-setup-modal");
          const routeBeforeClose = await page.evaluate(
            () => globalThis.location.hash
          );
          await pressGamepadButton(page, GAMEPAD_BUTTON.b);
          await dialog.waitFor({ state: "hidden", timeout: 20_000 });
          ensure(
            (await page.evaluate(() => globalThis.location.hash)) ===
              routeBeforeClose,
            `B escaped Settings while closing ${system.id} setup.`
          );
          ensure(
            (await page.evaluate(
              (expectedCardId) =>
                globalThis.document.querySelector("[data-focus-visible='true']")
                  ?.id === expectedCardId,
              cardId
            )) === true,
            `Closing ${system.id} setup did not restore its card focus.`
          );
          return screenshot ? { screenshot } : {};
        }
      );
    }

    await putQaEmulatorState(electronApp, baseConfig, true);

    for (const viewport of EMULATOR_VIEWPORTS) {
      await runCase(
        `emulator-${system.id}-manage-${viewport.id}`,
        {
          area: "emulator-manage",
          system: system.id,
          viewport: viewport.id,
        },
        async () => {
          await applyViewport(page, viewport);
          await navigateHash(
            page,
            "/big-picture/settings?tab=emulation",
            ".settings-page",
            { bounce: true }
          );
          const cardId = `emulation-overview-${system.id}-card`;
          await focusNavigationItem(page, page.locator(`#${cardId}`), cardId);
          await pressGamepadButton(page, GAMEPAD_BUTTON.a);
          const detail = page.locator(".emulator-detail");
          await detail.waitFor({ state: "visible", timeout: 20_000 });
          const title = await detail
            .locator(".emulator-detail__hero-title")
            .innerText();
          ensure(
            title.trim() === system.label,
            `The ${system.id} Manage path opened the wrong system.`
          );
          const screenshot = await captureViewport(
            page,
            `emulator-${system.id}-manage`,
            viewport
          );
          await assertResponsiveSurface(page, ".emulator-detail");
          const routeBeforeBack = await page.evaluate(
            () => globalThis.location.hash
          );
          await pressGamepadButton(page, GAMEPAD_BUTTON.b);
          await detail.waitFor({ state: "hidden", timeout: 20_000 });
          await page
            .locator(".settings-emulation__cards")
            .waitFor({ state: "visible", timeout: 20_000 });
          ensure(
            (await page.evaluate(() => globalThis.location.hash)) ===
              routeBeforeBack,
            `B escaped Settings instead of leaving ${system.id} Manage.`
          );
          return screenshot ? { screenshot } : {};
        }
      );
    }
  }

  await runCase(
    "read-only-hydra-fixture-boundary",
    { area: "diagnostics" },
    async () => {
      ensure(
        qaApiProxy.state.fixtureRequests >= (CASE_FILTER ? 1 : 8),
        "The deterministic remote/Friends fixtures were not exercised."
      );
      ensure(
        qaApiProxy.state.mutationRequests.length === 0,
        `Visual QA attempted Hydra API writes: ${JSON.stringify(
          qaApiProxy.state.mutationRequests
        )}`
      );
      return { fixtureRequests: qaApiProxy.state.fixtureRequests };
    }
  );

  await runCase("renderer-page-errors", { area: "diagnostics" }, async () => {
    ensure(
      report.pageErrors.length === 0,
      `Renderer emitted ${report.pageErrors.length} unhandled page error(s).`
    );
  });
} catch (error) {
  fatalError = sanitizeText(error instanceof Error ? error.stack : error);
  report.fatalError = fatalError;
  console.error(`FATAL ${fatalError}`);
} finally {
  try {
    await closeElectronTree(electronApp, launchedProcess);
    report.cleanup.electronStopped = true;
  } catch (error) {
    report.cleanup.electronError = sanitizeText(error);
    fatalError ??= report.cleanup.electronError;
  }

  try {
    if (qaApiProxy) {
      await qaApiProxy.close();
    }
    report.cleanup.qaApiProxyStopped = true;
  } catch (error) {
    report.cleanup.qaApiProxyError = sanitizeText(error);
    fatalError ??= report.cleanup.qaApiProxyError;
  }

  try {
    assertGuardedClonePath();
    fs.rmSync(isolatedPortableRoot, { recursive: true, force: true });
    report.cleanup.cloneRemoved = !fs.existsSync(isolatedPortableRoot);
    ensure(
      report.cleanup.cloneRemoved,
      "The guarded QA clone remained on disk."
    );
  } catch (error) {
    report.cleanup.cloneError = sanitizeText(error);
    fatalError ??= report.cleanup.cloneError;
  }

  const passed = report.cases.filter((item) => item.status === "passed").length;
  const failed = report.cases.filter((item) => item.status === "failed").length;
  const byArea = report.cases.reduce((counts, item) => {
    const area = item.area ?? "uncategorized";
    const current = counts[area] ?? { total: 0, passed: 0, failed: 0 };
    current.total += 1;
    current[item.status] += 1;
    counts[area] = current;
    return counts;
  }, {});
  report.finishedAt = new Date().toISOString();
  report.summary = {
    total: report.cases.length,
    passed,
    failed,
    fatal: Boolean(fatalError),
    byArea,
  };

  await fs.promises.mkdir(artifactRoot, { recursive: true });
  const reportPath = path.join(artifactRoot, "report.json");
  await fs.promises.writeFile(
    reportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );

  console.log(
    `Acceptance summary: ${passed}/${report.cases.length} passed; ${failed} failed.`
  );
  console.log(`Report: ${relativeArtifact(reportPath)}`);

  if (
    fatalError ||
    failed > 0 ||
    !report.cleanup.electronStopped ||
    !report.cleanup.qaApiProxyStopped ||
    !report.cleanup.cloneRemoved
  ) {
    process.exitCode = 1;
  }
}
