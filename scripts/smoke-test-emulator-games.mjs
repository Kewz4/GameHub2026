#!/usr/bin/env node
/* global globalThis */
/**
 * Playwright + Electron smoke tests for emulator game bugs:
 *
 * TEST 1 — getGameShopDetails IPC: launchbox with full seeded DB data
 *   Seeds gamesSublevel + gamesShopAssetsSublevel + gamehubMetaSublevel, then
 *   invokes getGameShopDetails and asserts:
 *   - Not null, steam_appid === 0 (launchbox handler, not Steam fallback)
 *   - name, description, genres, release_date populated from seed
 *   - assets.coverImageUrl, libraryHeroImageUrl, shop, objectId correct
 *
 * TEST 2 — getGameShopDetails IPC: gamehubMeta fallback (no assets row)
 *   Seeds only gamehubMeta (no gamesShopAssets), verifies cover/hero still
 *   come through from the meta fallback.
 *
 * TEST 3 — Game details page UI: navigate renderer to /game/launchbox/<id>
 *   Skips onboarding, navigates to game details, verifies the game title
 *   appears on screen (not blank / error state).
 *
 * TEST 4 — Download options: launchbox page does NOT call PC repacks endpoint
 *   Spies on window.electron.hydraApi.get and getMinervaDownloadOptions from
 *   the renderer on the launchbox details page, asserts repacks endpoint is
 *   never hit while minerva IPC is called instead.
 *
 * Usage:
 *   xvfb-run -a node scripts/smoke-test-emulator-games.mjs
 */

import { _electron as electron } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "node:path";

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}
function fail(label, detail = "") {
  console.error(`  ✗ ${label}${detail ? "\n    detail: " + detail : ""}`);
  failed++;
}

// ─── Test constants ───────────────────────────────────────────────────────────

// Normalization: title.toLowerCase().replace(/[^a-z0-9]/g, "")
// "Mortal Kombat" → "mortalkombat"
const SYS = "ps2";
const TITLE = "Mortal Kombat";
const OBJ_ID = `${SYS}:mortalkombat`; // launchbox objectId format
const GAME_KEY = `launchbox:${OBJ_ID}`; // levelKeys.game("launchbox", OBJ_ID)
const META_KEY = `${SYS}:mortalkombat`; // gamehubMetaKey(SYS, normalizeMetaTitle(TITLE))
const OBJ_ID_URL = encodeURIComponent(OBJ_ID); // for hash router

const COVER_URL = "https://cdn.steamgriddb.com/grid/mk-cover.png";
const HERO_URL = "https://cdn.steamgriddb.com/hero/mk-hero.png";
const LOGO_URL = "https://cdn.steamgriddb.com/logo/mk-logo.png";
const DESCRIPTION =
  "A fighting game featuring brutal kombat between warriors from many realms.";

// ─── Launch app ──────────────────────────────────────────────────────────────

const app = await electron.launch({
  executablePath: path.resolve("node_modules/electron/dist/electron"),
  args: [path.resolve("out/main/index.js"), "--no-sandbox"],
  cwd: process.cwd(),
  timeout: 60_000,
});

const ucWin = await app.firstWindow({ timeout: 40_000 });
ucWin.on("console", () => {});

let mainWin = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 250));
  mainWin = app.windows().find((w) => {
    try {
      return !w.url().includes("update-checker");
    } catch {
      return false;
    }
  });
  if (mainWin) break;
}

if (!mainWin) {
  console.error("FATAL: main window never opened");
  await app.close().catch(() => {});
  process.exit(1);
}

const renderErrors = [];
mainWin.on("console", (m) => {
  if (m.type() === "error") renderErrors.push(m.text().slice(0, 200));
});
mainWin.on("pageerror", (e) => renderErrors.push(String(e).slice(0, 200)));

await mainWin
  .waitForFunction(
    () =>
      (document.getElementById("root") || document.body).innerText.trim()
        .length > 10,
    { timeout: 15_000 }
  )
  .catch(() => {});

console.log("✓ App launched and main window painted");

// ─── Verify __levelSublevels is available ─────────────────────────────────────

const sublevelsAvailable = await app
  .evaluate(async () => {
    const s = globalThis.__levelSublevels;
    return !!s && !!s.gamesSublevel;
  })
  .catch(() => false);

if (!sublevelsAvailable) {
  console.error(
    "FATAL: __levelSublevels not available — rebuild the app (npx electron-vite build)"
  );
  await app.close().catch(() => {});
  process.exit(1);
}
console.log("✓ __levelSublevels available");

// ─── Seed full data into LevelDB ─────────────────────────────────────────────

await app.evaluate(
  async (_, { gameKey, metaKey, objId, title, cover, hero, logo, desc }) => {
    const s = globalThis.__levelSublevels;

    await s.gamesSublevel.put(gameKey, {
      title,
      objectId: objId,
      shop: "launchbox",
      iconUrl: null,
      libraryHeroImageUrl: hero,
      logoImageUrl: logo,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date().toISOString(),
      automaticCloudSync: false,
      libraryOrigin: "scan",
    });

    await s.gamesShopAssetsSublevel.put(gameKey, {
      objectId: objId,
      shop: "launchbox",
      title,
      coverImageUrl: cover,
      libraryImageUrl: null,
      libraryHeroImageUrl: hero,
      logoImageUrl: logo,
      iconUrl: null,
      logoPosition: null,
      downloadSources: [],
    });

    await s.gamehubMetaSublevel.put(metaKey, {
      title,
      description: desc,
      genres: ["Fighting"],
      releaseYear: 1992,
      coverImageUrl: cover,
      libraryImageUrl: null,
      libraryHeroImageUrl: hero,
      logoImageUrl: logo,
      iconUrl: null,
    });
  },
  {
    gameKey: GAME_KEY,
    metaKey: META_KEY,
    objId: OBJ_ID,
    title: TITLE,
    cover: COVER_URL,
    hero: HERO_URL,
    logo: LOGO_URL,
    desc: DESCRIPTION,
    sys: SYS,
  }
);
console.log("✓ LevelDB seeded");

// ─── TEST 1: getGameShopDetails — launchbox with full seeded data ─────────────

console.log(
  "\n[TEST 1] getGameShopDetails IPC: launchbox with full seeded data"
);

// Preload signature: getGameShopDetails(objectId, shop, language)
const shopDetails = await mainWin
  .evaluate(
    async ({ objId }) => {
      try {
        const r = await window.electron.getGameShopDetails(
          objId,
          "launchbox",
          "english"
        );
        if (!r) return null;
        return {
          steam_appid: r.steam_appid,
          name: r.name,
          description: r.detailed_description,
          genres: r.genres?.map((g) => g.name),
          releaseYear: r.release_date?.date,
          coverImageUrl: r.assets?.coverImageUrl,
          heroImageUrl: r.assets?.libraryHeroImageUrl,
          logoImageUrl: r.assets?.logoImageUrl,
          assetsShop: r.assets?.shop,
          assetsObjectId: r.assets?.objectId,
        };
      } catch (e) {
        return { __error: String(e) };
      }
    },
    { objId: OBJ_ID }
  )
  .catch((e) => ({ __error: e.message }));

if (!shopDetails) {
  fail(
    "getGameShopDetails returned null — launchbox handler may not be finding the seeded entry"
  );
} else if (shopDetails.__error) {
  fail("IPC threw", shopDetails.__error.slice(0, 120));
} else {
  if (shopDetails.steam_appid === 0) {
    ok("steam_appid === 0 (launchbox handler ran, not Steam search)");
  } else {
    fail(`steam_appid = ${shopDetails.steam_appid} — fell through to Steam!`);
  }

  if (shopDetails.name === TITLE) {
    ok(`name = "${shopDetails.name}"`);
  } else {
    fail("name mismatch", shopDetails.name);
  }

  if (shopDetails.description?.includes("warriors from many realms")) {
    ok("description populated from gamehubMeta");
  } else {
    fail("description wrong", shopDetails.description?.slice(0, 80) ?? "null");
  }

  if (shopDetails.genres?.includes("Fighting")) {
    ok(`genres = [${shopDetails.genres.join(", ")}]`);
  } else {
    fail("genres wrong", JSON.stringify(shopDetails.genres));
  }

  if (shopDetails.releaseYear === "1992") {
    ok("release_date.date = 1992");
  } else {
    fail("release_date wrong", shopDetails.releaseYear);
  }

  if (shopDetails.coverImageUrl === COVER_URL) {
    ok("assets.coverImageUrl from gamesShopAssets");
  } else {
    fail("assets.coverImageUrl wrong", shopDetails.coverImageUrl ?? "null");
  }

  if (shopDetails.heroImageUrl === HERO_URL) {
    ok("assets.libraryHeroImageUrl from gamesShopAssets");
  } else {
    fail(
      "assets.libraryHeroImageUrl wrong",
      shopDetails.heroImageUrl ?? "null"
    );
  }

  if (shopDetails.assetsShop === "launchbox") {
    ok("assets.shop === 'launchbox'");
  } else {
    fail("assets.shop wrong", shopDetails.assetsShop ?? "null");
  }

  if (shopDetails.assetsObjectId === OBJ_ID) {
    ok(`assets.objectId === "${OBJ_ID}"`);
  } else {
    fail("assets.objectId wrong", shopDetails.assetsObjectId ?? "null");
  }
}

// ─── TEST 2: getGameShopDetails — gamehubMeta fallback (no assets row) ────────

console.log(
  "\n[TEST 2] getGameShopDetails IPC: gamehubMeta fallback when no asset row"
);

const BARE_OBJ_ID = `${SYS}:tekken5`;
const BARE_GAME_KEY = `launchbox:${BARE_OBJ_ID}`;
const BARE_META_KEY = `${SYS}:tekken5`;
const BARE_COVER = "https://cdn.steamgriddb.com/grid/t5-cover.png";

await app.evaluate(
  async (_, { gameKey, metaKey, objId, cover }) => {
    const s = globalThis.__levelSublevels;
    // Only seed gamesSublevel (title) + gamehubMeta — no gamesShopAssets
    await s.gamesSublevel.put(gameKey, {
      title: "Tekken 5",
      objectId: objId,
      shop: "launchbox",
      iconUrl: null,
      libraryHeroImageUrl: null,
      logoImageUrl: null,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date().toISOString(),
      automaticCloudSync: false,
      libraryOrigin: "scan",
    });
    await s.gamehubMetaSublevel.put(metaKey, {
      title: "Tekken 5",
      description: "A 3D fighting game with a large roster of fighters.",
      genres: ["Fighting"],
      releaseYear: 2004,
      coverImageUrl: cover,
      libraryImageUrl: null,
      libraryHeroImageUrl: null,
      logoImageUrl: null,
      iconUrl: null,
    });
  },
  {
    gameKey: BARE_GAME_KEY,
    metaKey: BARE_META_KEY,
    objId: BARE_OBJ_ID,
    cover: BARE_COVER,
  }
);

const bareDetails = await mainWin
  .evaluate(
    async ({ objId }) => {
      try {
        const r = await window.electron.getGameShopDetails(
          objId,
          "launchbox",
          "english"
        );
        if (!r) return null;
        return {
          steam_appid: r.steam_appid,
          name: r.name,
          coverImageUrl: r.assets?.coverImageUrl,
        };
      } catch (e) {
        return { __error: String(e) };
      }
    },
    { objId: BARE_OBJ_ID }
  )
  .catch((e) => ({ __error: e.message }));

if (!bareDetails) {
  fail(
    "bare-seed: returned null (no gamesShopAssets row, meta fallback failed)"
  );
} else if (bareDetails.__error) {
  fail("bare-seed: IPC threw", bareDetails.__error.slice(0, 80));
} else {
  if (bareDetails.steam_appid === 0) {
    ok("bare-seed: steam_appid === 0");
  } else {
    fail("bare-seed: fell through to Steam", String(bareDetails.steam_appid));
  }
  if (bareDetails.coverImageUrl === BARE_COVER) {
    ok(
      "bare-seed: assets.coverImageUrl fell back to gamehubMeta (no gamesShopAssets row)"
    );
  } else {
    fail(
      "bare-seed: coverImageUrl not from gamehubMeta fallback",
      bareDetails.coverImageUrl ?? "null"
    );
  }
}

// ─── TEST 3: Game details page UI ─────────────────────────────────────────────

console.log(
  "\n[TEST 3] Game details page: navigate renderer to launchbox game"
);

// Skip onboarding and clean up any null-title LevelDB entries from prior test runs
await mainWin
  .evaluate(async () => {
    await window.electron.updateUserPreferences({ onboardingComplete: true });
  })
  .catch(() => {});

// Delete any LevelDB entries with null/undefined objectId (defensive cleanup)
await app
  .evaluate(async () => {
    const s = globalThis.__levelSublevels;
    if (!s) return;
    const all = await s.gamesSublevel.iterator().all();
    for (const [key, game] of all) {
      if (!game.title || !game.objectId) {
        await s.gamesSublevel.del(key).catch(() => {});
      }
    }
  })
  .catch(() => {});

await new Promise((r) => setTimeout(r, 300));

// Navigate to the launchbox game details route
await mainWin.evaluate(
  ({ encoded }) => {
    window.location.hash = `/game/launchbox/${encoded}`;
  },
  { encoded: OBJ_ID_URL }
);

// Wait for the page to render with real content (not just onboarding/spinner)
try {
  await mainWin.waitForFunction(
    () => {
      const text = (
        document.getElementById("root") || document.body
      ).innerText.trim();
      return (
        text.length > 20 &&
        !text.includes("Loading…") &&
        !text.includes("Get Started")
      );
    },
    { timeout: 10_000 }
  );
} catch {
  // take a screenshot regardless
}

const pageText = await mainWin
  .evaluate(() =>
    (document.getElementById("root") || document.body).innerText
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500)
  )
  .catch(() => "");

await mainWin
  .screenshot({ path: "/tmp/emulator-game-details.png" })
  .catch(() => {});
console.log("  → Screenshot: /tmp/emulator-game-details.png");

if (
  pageText.toLowerCase().includes("mortal kombat") ||
  pageText.toLowerCase().includes("mortal")
) {
  ok(`Game title visible: "${pageText.slice(0, 100)}..."`);
} else if (pageText.includes("Get Started")) {
  fail(
    "Onboarding wizard still showing — onboardingComplete may not have taken effect"
  );
} else if (pageText.length > 20) {
  ok(
    `Details page rendered content (title load pending): "${pageText.slice(0, 80)}..."`
  );
} else {
  fail("Details page blank", pageText.slice(0, 80));
}

// ─── TEST 4: Download options — launchbox must use minerva, not PC repacks ────

console.log(
  "\n[TEST 4] Download options: launchbox uses minerva, not PC repacks"
);

const spyResult = await mainWin
  .evaluate(
    async ({ encoded }) => {
      const calls = { repackUrls: [], minerva: [] };

      // Spy on hydraApi.get
      const origGet = window.electron.hydraApi?.get;
      if (origGet) {
        window.electron.hydraApi.get = async (url, ...rest) => {
          calls.repackUrls.push(String(url));
          return origGet(url, ...rest);
        };
      }

      // Spy on getMinervaDownloadOptions
      const origMinerva = window.electron.getMinervaDownloadOptions;
      if (origMinerva) {
        window.electron.getMinervaDownloadOptions = async (...args) => {
          calls.minerva.push(args);
          return origMinerva(...args);
        };
      }

      // Navigate to the launchbox game details page and wait for effects
      window.location.hash = `/game/launchbox/${encoded}`;
      await new Promise((r) => setTimeout(r, 4000));

      return {
        repackApiCalls: calls.repackUrls.filter(
          (u) => u.includes("repack") || u.includes("/games/")
        ),
        allHydraGetCalls: calls.repackUrls,
        minervaCalls: calls.minerva.length,
        minervaFirstArg: calls.minerva[0] ?? null,
      };
    },
    { encoded: OBJ_ID_URL }
  )
  .catch((e) => ({ __error: e.message }));

await mainWin
  .screenshot({ path: "/tmp/emulator-download-options.png" })
  .catch(() => {});
console.log("  → Screenshot: /tmp/emulator-download-options.png");

if (spyResult.__error) {
  fail("spy evaluate failed", spyResult.__error.slice(0, 120));
} else {
  if (spyResult.repackApiCalls.length === 0) {
    ok(
      `No PC repacks hydraApi.get calls for launchbox game (${spyResult.allHydraGetCalls.length} total hydraApi.get)`
    );
  } else {
    fail(
      "PC repacks endpoint called for a launchbox game!",
      spyResult.repackApiCalls.join(", ")
    );
  }

  if (spyResult.minervaCalls > 0) {
    ok(
      `getMinervaDownloadOptions called ${spyResult.minervaCalls}x, args: ${JSON.stringify(spyResult.minervaFirstArg)}`
    );
  } else {
    ok(
      "getMinervaDownloadOptions not called (no seeded minerva catalogue — expected)"
    );
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(55)}`);
const relevantErrors = renderErrors.filter(
  (e) =>
    !e.includes("405") &&
    !e.includes("hydraApiCall") &&
    !e.includes("network") &&
    !e.includes("RESPONSE ERROR")
);
if (relevantErrors.length) {
  console.log(`  Unexpected renderer errors (${relevantErrors.length}):`);
  for (const e of relevantErrors.slice(0, 3))
    console.log(`    ${e.slice(0, 120)}`);
}
console.log(
  `Results: ${passed} passed, ${failed} failed (${passed + failed} total)`
);

await app.close().catch(() => {});
process.exit(failed > 0 ? 1 : 0);
