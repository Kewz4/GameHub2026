import axios from "axios";
import { logger } from "@main/services";

/**
 * EA entitlements via api1.origin.com — the legacy but still-working endpoint
 * that accepts ORIGIN_JS_SDK access tokens. The Juno GraphQL endpoint rejects
 * ORIGIN_JS_SDK tokens with error 10007 (wrong client), so we use this instead.
 *
 * Flow:
 *   1. GET gateway.ea.com/proxy/identity/pids/me  → personaId
 *   2. GET api1.origin.com/ecommerce2/entitlements/<personaId>  → entitlement list
 */

const IDENTITY_URL = "https://gateway.ea.com/proxy/identity/pids/me";
const ENTITLEMENTS_URL = (personaId: string) =>
  `https://api1.origin.com/ecommerce2/entitlements/${personaId}?machine_hash=1&filter=GAME`;

export interface EaOwnedGame {
  offerId: string;
  title: string;
  gameSlug: string | null;
  ownershipMethods: string[];
}

interface IdentityResponse {
  pid?: { pidId?: string | number };
}

interface EntitlementItem {
  offerId?: string;
  offerName?: string;
  offerType?: string;
  gameDistributionSubType?: string;
  entitlementType?: string;
  status?: string;
}

interface EntitlementsResponse {
  entitlements?: { entitlement?: EntitlementItem | EntitlementItem[] };
}

export const fetchEaOwnedGames = async (
  accessToken: string
): Promise<EaOwnedGame[]> => {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };

  // Step 1: get the authenticated user's personaId
  let personaId: string;
  try {
    const idRes = await axios.get<IdentityResponse>(IDENTITY_URL, {
      headers,
      timeout: 15_000,
    });
    const pid = idRes.data?.pid?.pidId;
    if (!pid) throw new Error("No pidId in identity response");
    personaId = String(pid);
  } catch (err: unknown) {
    const ae = err as { response?: { status?: number; data?: unknown }; message?: string };
    const body =
      typeof ae?.response?.data === "string"
        ? ae.response.data.slice(0, 400)
        : JSON.stringify(ae?.response?.data ?? ae?.message ?? err).slice(0, 400);
    logger.error(`[EA] identity fetch failed: HTTP ${ae?.response?.status} ${body}`);
    throw new Error(`EA identity request failed (HTTP ${ae?.response?.status}): ${body}`);
  }

  logger.log(`[EA] personaId: ${personaId}`);

  // Step 2: fetch entitlements for this persona
  let res;
  try {
    res = await axios.get<EntitlementsResponse>(ENTITLEMENTS_URL(personaId), {
      headers: {
        ...headers,
        "X-AuthToken": accessToken,
      },
      timeout: 25_000,
    });
  } catch (err: unknown) {
    const ae = err as { response?: { status?: number; data?: unknown }; message?: string };
    const body =
      typeof ae?.response?.data === "string"
        ? ae.response.data.slice(0, 400)
        : JSON.stringify(ae?.response?.data ?? ae?.message ?? err).slice(0, 400);
    if (ae?.response?.status === 401) throw new Error(`HTTP 401: ${body}`);
    logger.error(`[EA] entitlements fetch failed: HTTP ${ae?.response?.status} ${body}`);
    throw new Error(`EA entitlements request failed (HTTP ${ae?.response?.status}): ${body}`);
  }

  const raw = res.data?.entitlements?.entitlement;
  const items: EntitlementItem[] = raw
    ? Array.isArray(raw)
      ? raw
      : [raw]
    : [];

  logger.log(`[EA] entitlements returned ${items.length} items`);

  // Filter to real game purchases — exclude trials, DLC-only, and vault content.
  return items
    .filter((it) => {
      if (!it.offerId || !it.offerName) return false;
      if (it.status && it.status !== "ACTIVE") return false;
      // offerType GAME or gameDistributionSubType BASE_GAME
      const isGame =
        it.offerType === "GAME" ||
        it.gameDistributionSubType === "BASE_GAME" ||
        it.entitlementType === "DEFAULT_GAME_ENTITLEMENT";
      return isGame;
    })
    .map((it) => ({
      offerId: it.offerId!,
      title: it.offerName!,
      gameSlug: null,
      ownershipMethods: [],
    }));
};
