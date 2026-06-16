import axios from "axios";
import { logger } from "@main/services";

/**
 * EA "Juno" service-aggregation-layer GraphQL endpoint — the API the modern EA
 * app itself uses. The legacy `gateway.ea.com/proxy/identity|entitlements`
 * hosts are deprecated and now reject third-party tokens with
 * "Your request cannot be completed. Service limitations apply.", so we mirror
 * the EA app and the actively-maintained GOG Galaxy EA integration instead.
 *
 * Reference: BellezaEmporium/galaxy-integration-ead (EA Desktop integration).
 */
const JUNO_GRAPHQL_HOST = "https://service-aggregation-layer.juno.ea.com/graphql";

/** Owned games query — mirrors the EA app's getPreloadedOwnedGames. We keep the
 *  fields we need (offer id, name, slug, ownership methods). */
const OWNED_GAMES_QUERY = `query {
  me {
    ownedGameProducts(
      storefronts: [EA]
      locale: "DEFAULT"
      paging: { limit: 9999, next: null }
      productFound: true
      ownershipMethod: [PURCHASE, REDEMPTION, ENTITLEMENT_GRANT]
      entitlementEnabled: true
      platforms: [PC]
    ) {
      items {
        id: originOfferId
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
            entitlementId
          }
        }
      }
    }
  }
}`;

export interface EaOwnedGame {
  /** EA offer id (originOfferId) used to build the launch URI. */
  offerId: string;
  title: string;
  gameSlug: string | null;
  /** How the user owns it: PURCHASE / REDEMPTION / ENTITLEMENT_GRANT /
   *  XGP_VAULT (EA Play vault — excluded since the user doesn't truly own it). */
  ownershipMethods: string[];
}

interface JunoOwnedItem {
  id?: string;
  product?: {
    name?: string;
    gameSlug?: string;
    baseItem?: { title?: string; gameType?: string };
    gameProductUser?: { ownershipMethods?: string[]; entitlementId?: string };
  };
}

/**
 * Fetches the authenticated user's owned EA games from the Juno GraphQL
 * endpoint. Throws with a descriptive message (including HTTP status/body) on
 * failure so callers can surface a useful error.
 */
export const fetchEaOwnedGames = async (
  accessToken: string
): Promise<EaOwnedGame[]> => {
  let res;
  try {
    res = await axios.get(JUNO_GRAPHQL_HOST, {
      params: { query: OWNED_GAMES_QUERY },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      timeout: 25_000,
    });
  } catch (err: unknown) {
    const ae = err as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };
    const body =
      typeof ae?.response?.data === "string"
        ? ae.response.data.slice(0, 400)
        : JSON.stringify(ae?.response?.data ?? ae?.message ?? err).slice(0, 400);
    logger.error(
      `[EA] Juno ownedGameProducts failed: HTTP ${ae?.response?.status} ${body}`
    );
    throw new Error(`EA owned games request failed (HTTP ${ae?.response?.status}): ${body}`);
  }

  // GraphQL returns 200 with an `errors` array on query problems.
  if (res.data?.errors) {
    const msg = JSON.stringify(res.data.errors).slice(0, 400);
    logger.error(`[EA] Juno GraphQL errors: ${msg}`);
    throw new Error(`EA owned games GraphQL error: ${msg}`);
  }

  const items: JunoOwnedItem[] =
    res.data?.data?.me?.ownedGameProducts?.items ?? [];

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
