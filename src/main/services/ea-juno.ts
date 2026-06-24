import axios from "axios";
import { logger } from "@main/services";

/**
 * EA "Juno" service-aggregation-layer GraphQL endpoint — the API the modern EA
 * App uses. Accessed with a JUNO_PC_CLIENT access token (see ea-auth.ts), which
 * Juno accepts (an ORIGIN_JS_SDK web token is rejected with error 10007).
 *
 * Queries mirror the EA App / GOG Galaxy EA Desktop integration
 * (BellezaEmporium/galaxy-integration-ead).
 */
const JUNO_GRAPHQL_HOST =
  "https://service-aggregation-layer.juno.ea.com/graphql";

/** getPreloadedOwnedGames — the EA App's owned-games query (PC base games). */
const OWNED_GAMES_QUERY = `query {
  me {
    ownedGameProducts(
      storefronts: [EA]
      locale: "DEFAULT"
      paging: { limit: 9999, next: null }
      productFound: true
      ownershipMethod: [PURCHASE, REDEMPTION, ENTITLEMENT_GRANT]
      type: [DIGITAL_FULL_GAME, PACKAGED_FULL_GAME]
      entitlementEnabled: true
      platforms: [PC]
    ) {
      items {
        id: originOfferId
        status
        product {
          id
          name
          gameSlug
          baseItem(availabilities: [VISIBLE]) {
            title
            gameType
          }
          gameProductUser {
            ownershipMethods
          }
        }
      }
    }
  }
}`;

/** Identity query — confirms the token and returns the player ids/display name. */
const IDENTITY_QUERY = `query { me { player { pd psd displayName } } }`;

export interface EaOwnedGame {
  offerId: string;
  title: string;
  gameSlug: string | null;
  ownershipMethods: string[];
}

export interface EaIdentity {
  pid: string;
  personaId: string;
  displayName: string;
}

interface JunoOwnedItem {
  id?: string;
  product?: {
    name?: string;
    gameSlug?: string;
    baseItem?: { title?: string; gameType?: string };
    gameProductUser?: { ownershipMethods?: string[] };
  };
}

const junoGet = async <T>(accessToken: string, query: string): Promise<T> => {
  let res;
  // Retry once on timeout/network error (Juno is occasionally slow to respond).
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      res = await axios.get(JUNO_GRAPHQL_HOST, {
        params: { query },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          // Identify as the EA Desktop app so Juno doesn't reject or throttle us.
          "User-Agent":
            "EADesktop/13.304.0.5765 CEF/126.2.4 (Windows NT 10.0; Win64; x64)",
          "X-ClientPlatform": "pc",
        },
        timeout: 30_000,
      });
      break; // success
    } catch (err: unknown) {
      const ae = err as {
        response?: { status?: number; data?: unknown };
        message?: string;
        code?: string;
      };
      // On 401 there's no point retrying — the token is stale.
      if (ae?.response?.status === 401) {
        const body =
          typeof ae.response!.data === "string"
            ? ae.response!.data.slice(0, 400)
            : JSON.stringify(ae.response!.data ?? ae.message ?? err).slice(
                0,
                400
              );
        throw new Error(`HTTP 401: ${body}`);
      }
      // On the first attempt retry network/timeout errors.
      if (attempt === 1 && (ae.code === "ECONNABORTED" || !ae.response)) {
        logger.warn(`[EA] Juno attempt 1 failed (${ae.message}), retrying…`);
        await new Promise((r) => setTimeout(r, 3_000));
        continue;
      }
      const body =
        typeof ae?.response?.data === "string"
          ? ae.response.data.slice(0, 400)
          : JSON.stringify(ae?.response?.data ?? ae?.message ?? err).slice(
              0,
              400
            );
      logger.error(
        `[EA] Juno request failed: HTTP ${ae?.response?.status} ${body}`
      );
      throw new Error(
        `EA Juno request failed (HTTP ${ae?.response?.status}): ${body}`
      );
    }
  }

  if (!res)
    throw new Error("EA Juno request failed: no response after retries");

  if (res.data?.errors) {
    const msg = JSON.stringify(res.data.errors).slice(0, 400);
    logger.error(`[EA] Juno GraphQL errors: ${msg}`);
    throw new Error(`EA Juno GraphQL error: ${msg}`);
  }
  return res.data?.data as T;
};

/** Fetches the authenticated user's identity (player + persona ids). */
export const fetchEaIdentity = async (
  accessToken: string
): Promise<EaIdentity> => {
  const data = await junoGet<{
    me?: { player?: { pd?: string; psd?: string; displayName?: string } };
  }>(accessToken, IDENTITY_QUERY);
  const player = data?.me?.player ?? {};
  return {
    pid: String(player.pd ?? ""),
    personaId: String(player.psd ?? ""),
    displayName: String(player.displayName ?? "EA Account"),
  };
};

/** Fetches the authenticated user's owned EA games (PC base games only). */
export const fetchEaOwnedGames = async (
  accessToken: string
): Promise<EaOwnedGame[]> => {
  const data = await junoGet<{
    me?: { ownedGameProducts?: { items?: JunoOwnedItem[] } };
  }>(accessToken, OWNED_GAMES_QUERY);

  const items = data?.me?.ownedGameProducts?.items ?? [];
  logger.log(`[EA] Juno returned ${items.length} owned game products`);

  return items
    .map((it): EaOwnedGame | null => {
      const offerId = it.id ?? "";
      const product = it.product ?? {};
      const title = product.name ?? product.baseItem?.title ?? "";
      if (!offerId || !title) return null;
      return {
        offerId,
        title,
        gameSlug: product.gameSlug ?? null,
        ownershipMethods: product.gameProductUser?.ownershipMethods ?? [],
      };
    })
    .filter((g): g is EaOwnedGame => {
      if (!g) return false;
      // Exclude EA Play vault-only titles — the user doesn't truly own them.
      const methods = g.ownershipMethods;
      if (
        methods.length > 0 &&
        methods.every((m) => m === "XGP_VAULT" || m === "SUBSCRIPTION")
      ) {
        return false;
      }
      return true;
    });
};
