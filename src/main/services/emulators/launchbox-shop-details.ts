export interface LaunchboxShopDetailsAssets {
  title?: string | null;
  iconUrl?: string | null;
  libraryHeroImageUrl?: string | null;
  libraryImageUrl?: string | null;
  logoImageUrl?: string | null;
}

export interface LaunchboxShopDetailsEntry {
  objectId: string;
  platform?: string | null;
  skus?: string[];
  data?: {
    title?: string;
    description?: string;
    developers?: string[];
    publishers?: string[];
    genres?: string[];
    screenshots?: string[];
    releaseDate?: string;
    platform?: string;
    assets?: LaunchboxShopDetailsAssets | null;
  } | null;
}

import { HydraApi } from "@main/services/hydra-api";

export const launchboxShopDetails = async (
  objectId: string
): Promise<LaunchboxShopDetailsEntry | null> => {
  try {
    return await HydraApi.get<LaunchboxShopDetailsEntry>(
      `/games/launchbox/${objectId}`,
      undefined,
      { needsAuth: false }
    );
  } catch {
    return null;
  }
};

export const fetchShopDetailsForSkus = async (
  skus: string[]
): Promise<Map<string, LaunchboxShopDetailsEntry>> => {
  if (skus.length === 0) return new Map();
  try {
    const results = await HydraApi.get<
      Array<{ sku: string; entry: LaunchboxShopDetailsEntry }>
    >("/games/launchbox/by-skus", { skus: skus.join(",") }, { needsAuth: false });

    const map = new Map<string, LaunchboxShopDetailsEntry>();
    for (const { sku, entry } of results) {
      map.set(normalizeSku(sku), entry);
    }
    return map;
  } catch {
    return new Map();
  }
};

export const normalizeSku = (sku: string): string =>
  sku
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .trim();
