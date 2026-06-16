import axios from "axios";
import { logger } from "./logger";

export interface SteamOwnedGame {
  appid: number;
  name: string;
  img_icon_url: string;
  playtime_forever: number; // minutes
}

export interface SteamPlayerSummary {
  steamid: string;
  personaname: string;
  avatarfull: string;
}

// Simple tag extractor for Steam's predictable XML — strips CDATA wrappers
function extractXmlTag(xml: string, tag: string): string {
  // Use (?=[ >]) lookahead so <steamID> does NOT match <steamID64>
  const match = xml.match(
    new RegExp(`<${tag}(?=[ >])[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")
  );
  if (!match) return "";
  let value = match[1].trim();
  // Strip CDATA: <![CDATA[text]]> → text
  const cdataMatch = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdataMatch) value = cdataMatch[1].trim();
  return value;
}

function extractAllXmlBlocks(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
  return xml.match(regex) ?? [];
}

/**
 * Parses the Steam community games XML (`/games?xml=1`) into owned games.
 * Shared by the public-profile path and the authenticated in-app session path
 * (which returns the SAME XML shape even for private profiles).
 */
export function parseSteamGamesXml(xml: string): SteamOwnedGame[] {
  const gameBlocks = extractAllXmlBlocks(xml, "game");

  return gameBlocks
    .map((block): SteamOwnedGame => {
      const appid = parseInt(extractXmlTag(block, "appID"), 10);
      const name = extractXmlTag(block, "name");
      // hoursOnRecord is a formatted string like "1,234" — convert to minutes
      const hoursStr = extractXmlTag(block, "hoursOnRecord").replace(/,/g, "");
      const playtime_forever = hoursStr
        ? Math.round(parseFloat(hoursStr) * 60)
        : 0;
      return { appid, name, img_icon_url: "", playtime_forever };
    })
    .filter((g) => g.appid > 0 && g.name);
}

/** Reads the SteamID64 out of a community profile/games XML document. */
export function extractSteamId64FromXml(xml: string): string {
  return extractXmlTag(xml, "steamID64");
}

/**
 * Fetch owned games from the public Steam community XML endpoint.
 * Requires the profile's game list to be set to public.
 */
async function getSteamOwnedGamesPublic(
  steamId: string
): Promise<SteamOwnedGame[]> {
  const response = await axios.get<string>(
    `https://steamcommunity.com/profiles/${steamId}/games?xml=1`,
    { responseType: "text", timeout: 15_000 }
  );

  const xml = response.data;

  if (xml.includes("<error>")) {
    const err = extractXmlTag(xml, "error");
    throw new Error(`Steam profile error: ${err}`);
  }

  // When the game list is set to private, Steam returns the profile XML but
  // without a <games> element at all. Detect this so callers can surface a
  // meaningful error instead of silently adding 0 games.
  if (!xml.includes("<games>") && !xml.includes("<game>")) {
    throw new Error(
      "Steam game list is private. Set your Steam game details to Public, or sign in with Steam in-app."
    );
  }

  return parseSteamGamesXml(xml);
}

/**
 * Fetch owned games via the Steam Web API (requires API key, returns richer data).
 */
async function getSteamOwnedGamesWithKey(
  steamId: string,
  apiKey: string
): Promise<SteamOwnedGame[]> {
  const response = await axios.get(
    "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/",
    {
      params: {
        key: apiKey,
        steamid: steamId,
        include_appinfo: true,
        // Without this, played F2P games (CS2, Warframe, …) are missing from
        // the response, never get stamped libraryOrigin: "sync", and end up
        // misclassified as catalogue ("Retigga") games by the migration pass.
        include_played_free_games: true,
        format: "json",
      },
      timeout: 15_000,
    }
  );
  return response.data?.response?.games ?? [];
}

export const getSteamOwnedGames = async (
  steamId: string,
  apiKey?: string | null
): Promise<SteamOwnedGame[]> => {
  if (apiKey?.trim()) {
    try {
      const games = await getSteamOwnedGamesWithKey(steamId, apiKey.trim());
      logger.log(
        `Fetched ${games.length} owned Steam games via Web API for ${steamId}`
      );
      return games;
    } catch (err) {
      logger.warn("Steam Web API failed, falling back to community XML", err);
    }
  }

  try {
    const games = await getSteamOwnedGamesPublic(steamId);
    logger.log(
      `Fetched ${games.length} owned Steam games via community XML for ${steamId}`
    );
    return games;
  } catch (err) {
    logger.warn(`getSteamOwnedGamesPublic failed for ${steamId}:`, err);
    throw err; // Propagate so the caller can surface a proper error
  }
};

/**
 * Fetch player summary from the public Steam community XML endpoint.
 */
async function getSteamPlayerSummaryPublic(
  steamId: string
): Promise<SteamPlayerSummary | null> {
  const response = await axios.get<string>(
    `https://steamcommunity.com/profiles/${steamId}/?xml=1`,
    { responseType: "text", timeout: 10_000 }
  );

  const xml = response.data;
  if (xml.includes("<error>") || !xml.includes("<steamID64>")) return null;

  return {
    steamid: extractXmlTag(xml, "steamID64"),
    personaname: extractXmlTag(xml, "steamID"),
    avatarfull: extractXmlTag(xml, "avatarFull"),
  };
}

export const getSteamPlayerSummary = async (
  steamId: string,
  apiKey?: string | null
): Promise<SteamPlayerSummary | null> => {
  if (apiKey?.trim()) {
    try {
      const response = await axios.get(
        "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/",
        {
          params: { key: apiKey.trim(), steamids: steamId, format: "json" },
          timeout: 10_000,
        }
      );
      const players: SteamPlayerSummary[] =
        response.data?.response?.players ?? [];
      if (players[0]) return players[0];
    } catch (err) {
      logger.warn(
        "Steam Web API player summary failed, falling back to community XML",
        err
      );
    }
  }

  return getSteamPlayerSummaryPublic(steamId);
};
