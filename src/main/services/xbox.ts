import axios from "axios";
import { logger } from "./logger";

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

export interface XboxGame {
  productId: string;
  title: string;
  packageFamilyName: string;
  coverUrl: string | null;
  description: string | null;
  titleId?: string | null;
}

export interface XboxTokenSet {
  accessToken: string; // MSA token
  userHash: string; // XBL uhs claim
  xstsToken: string; // XSTS token
  expiry: Date;
}

export interface XboxUserInfo {
  gamertag: string;
  xuid: string;
  hasGamePass: boolean;
}

// ──────────────────────────────────────────────────────────
// OAuth URL (popup shown to user)
// ──────────────────────────────────────────────────────────

export const XBOX_OAUTH_URL =
  "https://login.live.com/oauth20_authorize.srf?" +
  new URLSearchParams({
    client_id: "000000004C12AE6F",
    redirect_uri: "https://login.live.com/oauth20_desktop.srf",
    response_type: "token",
    scope: "service::user.auth.xboxlive.com::MBI_SSL",
    display: "touch",
    locale: "en",
  }).toString();

const REDIRECT_HOST = "login.live.com";
const REDIRECT_PATH = "/oauth20_desktop.srf";

// ──────────────────────────────────────────────────────────
// Token exchange helpers
// ──────────────────────────────────────────────────────────

/** Extract MSA access_token from the redirect URL fragment */
export function extractMsaToken(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== REDIRECT_HOST || !u.pathname.startsWith(REDIRECT_PATH)) {
      return null;
    }
    // token is in the hash
    const hash = u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
    const params = new URLSearchParams(hash);
    return params.get("access_token");
  } catch {
    return null;
  }
}

/** Exchange MSA token for Xbox Live (XBL) token */
async function getXblToken(
  msaToken: string
): Promise<{ token: string; uhs: string }> {
  const res = await axios.post(
    "https://user.auth.xboxlive.com/user/authenticate",
    {
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        // MBI_SSL implicit flow token goes without "d=" prefix
        RpsTicket: msaToken,
      },
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
    },
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );
  const uhs = res.data.DisplayClaims.xui[0].uhs as string;
  return { token: res.data.Token as string, uhs };
}

/** Exchange XBL token for XSTS token */
async function getXstsToken(
  xblToken: string
): Promise<{ token: string; gamertag: string; xuid: string }> {
  const res = await axios.post(
    "https://xsts.auth.xboxlive.com/xsts/authorize",
    {
      Properties: {
        SandboxId: "RETAIL",
        UserTokens: [xblToken],
      },
      RelyingParty: "http://xboxlive.com",
      TokenType: "JWT",
    },
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );
  const claims = res.data.DisplayClaims?.xui?.[0] ?? {};
  return {
    token: res.data.Token as string,
    gamertag: (claims.gtg as string) ?? "Xbox User",
    xuid: (claims.xid as string) ?? "",
  };
}

// ──────────────────────────────────────────────────────────
// Public: full sign-in flow
// ──────────────────────────────────────────────────────────

export async function exchangeMsaForXboxTokens(
  msaAccessToken: string
): Promise<{ tokens: XboxTokenSet; user: XboxUserInfo }> {
  const { token: xblToken, uhs } = await getXblToken(msaAccessToken);
  const xsts = await getXstsToken(xblToken);

  const expiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

  // Don't try to detect Game Pass via API — it requires Microsoft partner access
  // and public endpoints are unreliable. User sets the toggle manually in settings.
  return {
    tokens: {
      accessToken: msaAccessToken,
      userHash: uhs,
      xstsToken: xsts.token,
      expiry,
    },
    user: { gamertag: xsts.gamertag, xuid: xsts.xuid, hasGamePass: false },
  };
}

// ──────────────────────────────────────────────────────────
// Game Pass catalog
// ──────────────────────────────────────────────────────────

// PC Game Pass catalog sigl IDs — fetching both PC and console ensures the
// broadest coverage regardless of which Game Pass tier the user has.
const GAMEPASS_SIGL_IDS = [
  "fdd9e2a7-0fee-49f6-ad69-4354098401ff", // PC Game Pass
  "29a81209-df6f-41fd-a528-2ae6b91f719c", // Xbox Game Pass Ultimate (console)
];
const GAMEPASS_CATALOG_BASE = "https://catalog.gamepass.com/sigls/v2";
const DISPLAY_CATALOG_URL =
  "https://displaycatalog.mp.microsoft.com/v7.0/products";

function pickImageUrl(images: any[]): string | null {
  if (!Array.isArray(images)) return null;
  const priority = ["Poster", "BoxArt", "SuperHeroArt", "Logo"];
  for (const purpose of priority) {
    const img = images.find((i: any) => i.ImagePurpose === purpose);
    if (img?.Uri) {
      const uri: string = img.Uri;
      return uri.startsWith("//") ? `https:${uri}` : uri;
    }
  }
  const first = images[0];
  if (!first?.Uri) return null;
  const uri: string = first.Uri;
  return uri.startsWith("//") ? `https:${uri}` : uri;
}

export async function getGamePassCatalog(
  uhs?: string,
  xstsToken?: string
): Promise<XboxGame[]> {
  const authHeader =
    uhs && xstsToken ? { Authorization: `XBL3.0 x=${uhs};${xstsToken}` } : {};

  // Fetch all sigl catalogs and deduplicate product IDs
  const allProductIds = new Set<string>();
  for (const siglId of GAMEPASS_SIGL_IDS) {
    try {
      const catalogRes = await axios.get<any[]>(
        `${GAMEPASS_CATALOG_BASE}?id=${siglId}&language=en-us&market=US`,
        { headers: authHeader, timeout: 15000 }
      );
      const data = Array.isArray(catalogRes.data) ? catalogRes.data : [];
      for (const entry of data) {
        if (entry?.id) allProductIds.add(entry.id as string);
      }
    } catch (err) {
      logger.warn(`Xbox Game Pass: failed to fetch sigl ${siglId}`, err);
    }
  }

  const productIds = Array.from(allProductIds);

  const games: XboxGame[] = [];
  const BATCH = 20;

  for (let i = 0; i < productIds.length; i += BATCH) {
    const batch = productIds.slice(i, i + BATCH);
    try {
      const detailRes = await axios.get(DISPLAY_CATALOG_URL, {
        params: {
          bigIds: batch.join(","),
          market: "US",
          languages: "en-us",
          "MS-CV": "F.1",
        },
        headers: authHeader,
        timeout: 15000,
      });

      const products: any[] = detailRes.data?.Products ?? [];
      for (const product of products) {
        if (product.ProductBSchema === "ProductAddOn;3") continue;
        const pfn: string = product.Properties?.PackageFamilyName ?? "";
        if (!pfn) continue;

        const id: string = product.ProductId;
        const title: string =
          product.LocalizedProperties?.[0]?.ProductTitle ?? id;
        const description: string | null =
          product.LocalizedProperties?.[0]?.ShortDescription ?? null;
        const images: any[] = product.LocalizedProperties?.[0]?.Images ?? [];
        const coverUrl = pickImageUrl(images);

        const altIds: any[] = product.AlternateIds ?? [];
        const titleIdEntry = altIds.find(
          (a: any) => a.IdType === "XboxTitleId"
        );
        const titleId: string | null = titleIdEntry?.Value ?? null;

        games.push({
          productId: id,
          title,
          packageFamilyName: pfn,
          coverUrl,
          description,
          titleId,
        });
      }
    } catch {
      // skip failed batch
    }
  }

  logger.log(`Xbox Game Pass catalog: ${games.length} games fetched`);
  return games;
}
