import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { normalizeGameTitle } from "@main/helpers/normalize-game-title";
import cp from "node:child_process";
import path from "node:path";
import type { CatalogueSearchResult, GameShop, ShopAssets } from "@types";

export interface CustomGameInfo {
  title: string;
  objectId: string | null;
  shop: GameShop | null;
  iconUrl: string | null;
  coverImageUrl: string | null;
  libraryHeroImageUrl: string | null;
  logoImageUrl: string | null;
  libraryImageUrl: string | null;
}

// ─── Step 1: Windows exe version info ────────────────────────────────────────

function getExeVersionField(exePath: string, field: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(null);
    const script = `(Get-Item "${exePath.replace(/"/g, '\\"')}").VersionInfo.${field}`;
    cp.execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 5_000 },
      (err, stdout) => {
        if (err) return resolve(null);
        const val = stdout.trim();
        resolve(val && val.toLowerCase() !== "n/a" && val.length > 1 ? val : null);
      }
    );
  });
}

function looksLikeExeFilename(name: string): boolean {
  return /\.exe$/i.test(name) || /^[a-z0-9_\-]+$/i.test(name.replace(/\s/g, ""));
}

async function getExeDescription(exePath: string): Promise<string | null> {
  const filename = path.basename(exePath, path.extname(exePath));

  for (const field of ["FileDescription", "ProductName"]) {
    const val = await getExeVersionField(exePath, field);
    if (!val) continue;
    if (/\.exe$/i.test(val)) continue; // skip if it's literally "GameName.exe"
    if (val.toLowerCase() === filename.toLowerCase()) continue; // same as filename, no gain
    if (val.toLowerCase() === "application") continue;
    return val;
  }
  return null;
}

// ─── Step 2: extract from path ───────────────────────────────────────────────

function cleanFolderName(name: string): string {
  return name
    .replace(/[_]/g, " ")
    .replace(/\s*v?\d+\.\d+[\d.]*\s*$/i, "") // strip trailing version like v1.2.3
    .replace(/\s+/g, " ")
    .trim();
}

function extractNameFromPath(exePath: string): string {
  const parts = exePath.replace(/\\/g, "/").split("/");

  // If inside steamapps/common, the folder right after "common" is the game name
  const commonIdx = parts.findIndex((p) => p.toLowerCase() === "common");
  if (commonIdx !== -1 && commonIdx + 1 < parts.length - 1) {
    return cleanFolderName(parts[commonIdx + 1]);
  }

  // Use the immediate parent folder, but skip generic ones
  const generic = new Set(["bin", "binaries", "win64", "win32", "x64", "x86", "game", "games"]);
  for (let i = parts.length - 2; i >= 0; i--) {
    const folder = parts[i];
    if (!folder || generic.has(folder.toLowerCase())) continue;
    // Skip drive roots and Program Files
    if (/^[a-z]:$/i.test(folder)) continue;
    if (/^(program files|users|documents|downloads|desktop)$/i.test(folder)) continue;
    return cleanFolderName(folder);
  }

  return cleanFolderName(path.basename(exePath, path.extname(exePath)));
}

// ─── Step 3: catalogue search ────────────────────────────────────────────────

async function searchCatalogue(title: string): Promise<CatalogueSearchResult | null> {
  try {
    const resp = await HydraApi.post<{ edges: CatalogueSearchResult[]; count: number }>(
      "/catalogue/search",
      {
        title,
        sortBy: "popularity",
        sortOrder: "desc",
        downloadSourceFingerprints: [],
        tags: [],
        publishers: [],
        genres: [],
        developers: [],
        protondbSupportBadges: [],
        deckCompatibility: [],
        take: 5,
        skip: 0,
      },
      { needsAuth: false }
    );

    const titleNorm = normalizeGameTitle(title);
    // Exact normalised match first
    let match = resp?.edges?.find((r) => normalizeGameTitle(r.title) === titleNorm);
    // Loose: our candidate is contained in the result title (handles "GoW" → "God of War …")
    if (!match) {
      match = resp?.edges?.find((r) =>
        normalizeGameTitle(r.title).includes(titleNorm) ||
        titleNorm.includes(normalizeGameTitle(r.title))
      );
    }
    return match ?? null;
  } catch {
    return null;
  }
}

async function fetchShopAssets(
  shop: GameShop,
  objectId: string
): Promise<Partial<ShopAssets> | null> {
  try {
    return await HydraApi.get<ShopAssets>(`/games/${shop}/${objectId}/assets`);
  } catch {
    return null;
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

const resolveCustomGameInfo = async (
  _event: Electron.IpcMainInvokeEvent,
  exePath: string
): Promise<CustomGameInfo> => {
  const fallbackTitle =
    (await getExeDescription(exePath)) ?? extractNameFromPath(exePath);

  const catalogueMatch = await searchCatalogue(fallbackTitle);

  if (catalogueMatch) {
    const assets = await fetchShopAssets(catalogueMatch.shop, catalogueMatch.objectId);
    return {
      title: catalogueMatch.title,
      objectId: catalogueMatch.objectId,
      shop: catalogueMatch.shop,
      iconUrl: assets?.iconUrl ?? null,
      coverImageUrl: assets?.coverImageUrl ?? null,
      libraryHeroImageUrl: assets?.libraryHeroImageUrl ?? null,
      logoImageUrl: assets?.logoImageUrl ?? null,
      libraryImageUrl: assets?.libraryImageUrl ?? null,
    };
  }

  return {
    title: fallbackTitle,
    objectId: null,
    shop: null,
    iconUrl: null,
    coverImageUrl: null,
    libraryHeroImageUrl: null,
    logoImageUrl: null,
    libraryImageUrl: null,
  };
};

registerEvent("resolveCustomGameInfo", resolveCustomGameInfo);
