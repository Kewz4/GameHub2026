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

export const launchboxShopDetails = async (
  _objectId: string
): Promise<null> => null;

export const fetchShopDetailsForSkus = async (
  _skus: string[]
): Promise<Map<string, LaunchboxShopDetailsEntry>> => new Map();

export const normalizeSku = (sku: string): string =>
  sku.toUpperCase().replace(/[\s\-_.]/g, "").trim();
