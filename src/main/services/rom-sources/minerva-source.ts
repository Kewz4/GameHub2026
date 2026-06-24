import axios from "axios";
import type { EmulatorSystem } from "@types";
import { parseRomFilename } from "@main/services/emulators/parse-rom-filename";
import {
  minervaCatalogueSublevel,
  MINERVA_CACHE_TTL_MS,
} from "@main/level/sublevels/minerva-catalogue";
import type { MinervaCatalogueEntry } from "@main/level/sublevels/minerva-catalogue";

export type { MinervaCatalogueEntry };

const MINERVA_PLATFORMS: Partial<Record<EmulatorSystem, string[]>> = {
  ps1: ["No-Intro/Sony - PlayStation", "Redump/Sony - PlayStation"],
  ps2: ["Redump/Sony - PlayStation 2"],
  psp: ["No-Intro/Sony - PlayStation Portable"],
  n64: ["No-Intro/Nintendo - Nintendo 64"],
  gb: ["No-Intro/Nintendo - Game Boy"],
  gbc: ["No-Intro/Nintendo - Game Boy Color"],
  gba: ["No-Intro/Nintendo - Game Boy Advance"],
  nds: ["No-Intro/Nintendo - Nintendo DS"],
  dsi: ["No-Intro/Nintendo - Nintendo DSi"],
  n3ds: ["No-Intro/Nintendo - Nintendo 3DS"],
  wii: ["Redump/Nintendo - Wii"],
  gc: ["Redump/Nintendo - GameCube"],
  wiiu: ["No-Intro/Nintendo - Wii U"],
};

const MINERVA_BASE = "https://minerva-archive.org";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

/**
 * Fetch a listing page via direct HTTPS and parse ROM paths.
 * Falls back to Playwright on 503 or connection errors.
 */
export async function scrapeListing(platformPath: string): Promise<string[]> {
  const url = `${MINERVA_BASE}/browse/${platformPath}/`;

  let html: string | null = null;

  try {
    const resp = await axios.get<string>(url, {
      headers: BROWSER_HEADERS,
      timeout: 20_000,
      validateStatus: (s) => s < 500,
    });

    if (resp.status === 503 || resp.status === 429) {
      html = null; // fall through to Playwright
    } else {
      html = resp.data;
    }
  } catch (_err) {
    html = null; // fall through to Playwright
  }

  if (html === null) {
    // Playwright fallback
    try {
      const playwright = await import(
        "/opt/node22/lib/node_modules/playwright/index.mjs"
      );
      const browser = await playwright.chromium.launch({
        executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
        args: [
          "--no-sandbox",
          "--disable-quic",
          "--disable-features=EncryptedClientHello,TLS13EarlyData",
          "--disable-web-security",
          "--ignore-certificate-errors",
          "--proxy-server=http://127.0.0.1:39899",
        ],
        headless: true,
      });
      try {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
        html = await page.content();
      } finally {
        await browser.close();
      }
    } catch (err) {
      console.warn("[minerva] Playwright fallback failed for listing:", err);
      return [];
    }
  }

  const paths: string[] = [];
  if (html) {
    const linkRegex = /href="(\/rom\?name=[^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(html)) !== null) {
      paths.push(match[1]);
    }
  }
  return paths;
}

/**
 * Load a ROM detail page (always via Playwright — page is JS-rendered).
 */
export async function scrapeRomPage(
  romPath: string
): Promise<{ magnet: string | null; torrentUrl: string | null }> {
  let playwright: typeof import("/opt/node22/lib/node_modules/playwright/index.mjs");
  try {
    playwright = await import(
      "/opt/node22/lib/node_modules/playwright/index.mjs"
    );
  } catch (err) {
    console.warn("[minerva] Playwright not available:", err);
    return { magnet: null, torrentUrl: null };
  }

  const url = `${MINERVA_BASE}${romPath}`;
  const browser = await playwright.chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: [
      "--no-sandbox",
      "--disable-quic",
      "--disable-features=EncryptedClientHello,TLS13EarlyData",
      "--disable-web-security",
      "--ignore-certificate-errors",
      "--proxy-server=http://127.0.0.1:39899",
    ],
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

    // Wait for a magnet or torrent link to appear
    await page
      .waitForSelector('a[href^="magnet:"], a[href$=".torrent"]', {
        timeout: 10_000,
      })
      .catch(() => {});

    const magnet = await page
      .$eval('a[href^="magnet:"]', (el: HTMLAnchorElement) => el.href)
      .catch(() => null);
    const torrentUrl = await page
      .$eval('a[href$=".torrent"]', (el: HTMLAnchorElement) => el.href)
      .catch(() => null);

    return { magnet, torrentUrl };
  } finally {
    await browser.close();
  }
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Scrape all listing pages for a system. Returns catalogue entries (without
 * magnet/torrent — those are fetched lazily in getCatalogueEntry).
 */
export async function catalogueForSystem(
  system: EmulatorSystem
): Promise<MinervaCatalogueEntry[]> {
  const platforms = MINERVA_PLATFORMS[system];
  if (!platforms) return [];

  const entries: MinervaCatalogueEntry[] = [];

  for (const platformPath of platforms) {
    const romPaths = await scrapeListing(platformPath);
    for (const romPath of romPaths) {
      // romPath looks like /rom?name=.%2FNo-Intro%2F...%2Ffilename.zip
      const nameParam = new URL(
        `${MINERVA_BASE}${romPath}`
      ).searchParams.get("name");
      if (!nameParam) continue;
      // Extract just the filename (last segment)
      const filename = decodeURIComponent(nameParam).split("/").pop() ?? "";
      const { title, region } = parseRomFilename(filename);
      entries.push({
        system,
        title,
        region,
        filename,
        romPath,
        magnet: null,
        torrentUrl: null,
      });
    }
  }

  return entries;
}

/**
 * Get a single catalogue entry for a system+title, using LevelDB cache.
 * If cached and fresh, returns from cache. Otherwise scrapes listing,
 * then fetches magnet from detail page.
 */
export async function getCatalogueEntry(
  system: EmulatorSystem,
  title: string
): Promise<MinervaCatalogueEntry | null> {
  const cacheKey = `${system}:${normalizeTitle(title)}`;

  try {
    const cached = await minervaCatalogueSublevel.get(cacheKey);
    if (cached) {
      const isStale = Date.now() - cached.cachedAt > MINERVA_CACHE_TTL_MS;
      if (!isStale) {
        return cached.entry;
      }
    }
  } catch (_err) {
    // Not found in cache — continue
  }

  // Scrape listing, find matching title
  const allEntries = await catalogueForSystem(system);
  const normalTarget = normalizeTitle(title);
  const match = allEntries.find(
    (e) => normalizeTitle(e.title) === normalTarget
  );

  if (!match) return null;

  // Fetch magnet/torrent from detail page
  const { magnet, torrentUrl } = await scrapeRomPage(match.romPath);
  const entry: MinervaCatalogueEntry = { ...match, magnet, torrentUrl };

  // Store in cache
  await minervaCatalogueSublevel.put(cacheKey, {
    entry,
    cachedAt: Date.now(),
  });

  return entry;
}
