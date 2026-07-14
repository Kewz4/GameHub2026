import axios from "axios";

// Embedded default IGDB (Twitch) app credentials so metadata works out of the
// box without per-user setup. Users may override these in settings if they want
// to use their own Twitch application (e.g. to avoid sharing rate limits).
export const DEFAULT_IGDB_CLIENT_ID = "lbccfxg1ie3739dubo4bvlj7bw0sue";
export const DEFAULT_IGDB_CLIENT_SECRET = "e88mbm5snb40ax0n37jpyhearwfikp";

const resolveCredentials = (
  clientId?: string,
  clientSecret?: string
): { clientId: string; clientSecret: string } => ({
  clientId: clientId?.trim() || DEFAULT_IGDB_CLIENT_ID,
  clientSecret: clientSecret?.trim() || DEFAULT_IGDB_CLIENT_SECRET,
});

export interface IgdbGame {
  id: number;
  name: string;
  summary?: string;
  first_release_date?: number; // Unix timestamp
  genres?: Array<{ name: string }>;
  involved_companies?: Array<{
    company: { name: string };
    developer: boolean;
    publisher: boolean;
  }>;
  cover?: { url: string }; // Replace t_thumb with t_cover_big
  screenshots?: Array<{ url: string }>;
  platforms?: Array<{ id: number; name: string }>;
}

/** IGDB platform IDs for emulator systems */
export const IGDB_PLATFORM_IDS: Partial<Record<string, number>> = {
  n64: 4,
  gb: 33,
  gbc: 22,
  gba: 24,
  nds: 20,
  dsi: 170,
  n3ds: 37,
  wii: 5,
  wiiu: 41,
  gc: 21,
  psp: 38,
  ps1: 7,
  ps2: 8,
  ps3: 9,
  switch: 130,
};

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

class IgdbService {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  async getToken(clientId?: string, clientSecret?: string): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }

    const creds = resolveCredentials(clientId, clientSecret);

    const resp = await axios.post<{
      access_token: string;
      expires_in: number;
    }>(
      "https://id.twitch.tv/oauth2/token",
      new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: "client_credentials",
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    this.token = resp.data.access_token;
    this.tokenExpiresAt = Date.now() + resp.data.expires_in * 1000;
    return this.token;
  }

  async searchGame(
    title: string,
    platformId?: number,
    clientId?: string,
    clientSecret?: string
  ): Promise<IgdbGame | null> {
    try {
      const creds = resolveCredentials(clientId, clientSecret);
      const token = await this.getToken(creds.clientId, creds.clientSecret);
      // Use IGDB's full-text `search` operator (accent- and token-aware) rather
      // than a `name ~ *"..."*` wildcard: the wildcard misses accented titles
      // like "Pokémon Dash" when queried as "Pokemon Dash", `search` matches
      // them. Platform stays as a `where` filter.
      const platformClause = platformId
        ? `\nwhere platforms = [${platformId}];`
        : "";
      const query = `search "${title.replace(/"/g, "")}";
fields name,summary,first_release_date,genres.name,cover.url,screenshots.url,platforms.id,involved_companies.company.name,involved_companies.developer,involved_companies.publisher;${platformClause}
limit 5;`;

      const resp = await axios.post<IgdbGame[]>(
        "https://api.igdb.com/v4/games",
        query,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Client-ID": creds.clientId,
            "Content-Type": "text/plain",
          },
          timeout: 10_000,
        }
      );

      if (!resp.data || resp.data.length === 0) return null;

      const normalTitle = title.toLowerCase();
      const best = resp.data.reduce((prev, cur) => {
        const prevDist = levenshtein(prev.name.toLowerCase(), normalTitle);
        const curDist = levenshtein(cur.name.toLowerCase(), normalTitle);
        return curDist < prevDist ? cur : prev;
      });

      return best;
    } catch (err) {
      console.warn("[igdb] searchGame failed:", err);
      return null;
    }
  }

  /**
   * Fetch selectable artwork variants for the picker. IGDB only carries
   * portrait covers and landscape artwork/screenshots — it has no logos or
   * icons, so those asset types return []. Images are upscaled from the default
   * t_thumb to a large size and normalized to absolute https URLs.
   */
  async getArtworkOptions(
    title: string,
    type: "cover" | "hero" | "logo" | "icon",
    platformId?: number,
    clientId?: string,
    clientSecret?: string
  ): Promise<Array<{ url: string; thumbnailUrl: string }>> {
    if (type === "logo" || type === "icon") return [];

    try {
      const creds = resolveCredentials(clientId, clientSecret);
      const token = await this.getToken(creds.clientId, creds.clientSecret);
      const platformClause = platformId
        ? `\nwhere platforms = [${platformId}];`
        : "";
      const query = `search "${title.replace(/"/g, "")}";
fields name,cover.image_id,artworks.image_id,screenshots.image_id;${platformClause}
limit 5;`;

      const resp = await axios.post<
        Array<{
          name: string;
          cover?: { image_id: string };
          artworks?: Array<{ image_id: string }>;
          screenshots?: Array<{ image_id: string }>;
        }>
      >("https://api.igdb.com/v4/games", query, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Client-ID": creds.clientId,
          "Content-Type": "text/plain",
        },
        timeout: 10_000,
      });

      const normalTitle = title.toLowerCase();
      const best = (resp.data ?? []).reduce<(typeof resp.data)[number] | null>(
        (prev, cur) => {
          if (!prev) return cur;
          return levenshtein(cur.name.toLowerCase(), normalTitle) <
            levenshtein(prev.name.toLowerCase(), normalTitle)
            ? cur
            : prev;
        },
        null
      );
      if (!best) return [];

      const img = (imageId: string, size: string) =>
        `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`;

      if (type === "cover") {
        return best.cover
          ? [
              {
                url: img(best.cover.image_id, "t_cover_big_2x"),
                thumbnailUrl: img(best.cover.image_id, "t_cover_big"),
              },
            ]
          : [];
      }

      // hero → landscape artworks + screenshots.
      const landscape = [...(best.artworks ?? []), ...(best.screenshots ?? [])];
      return landscape.map((a) => ({
        url: img(a.image_id, "t_1080p"),
        thumbnailUrl: img(a.image_id, "t_screenshot_med"),
      }));
    } catch (err) {
      console.warn("[igdb] getArtworkOptions failed:", err);
      return [];
    }
  }

  async getGameById(
    igdbId: number,
    clientId?: string,
    clientSecret?: string
  ): Promise<IgdbGame | null> {
    try {
      const creds = resolveCredentials(clientId, clientSecret);
      const token = await this.getToken(creds.clientId, creds.clientSecret);
      const query = `fields name,summary,first_release_date,genres.name,cover.url,screenshots.url,platforms.id,involved_companies.company.name,involved_companies.developer,involved_companies.publisher;
where id = ${igdbId};
limit 1;`;

      const resp = await axios.post<IgdbGame[]>(
        "https://api.igdb.com/v4/games",
        query,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Client-ID": creds.clientId,
            "Content-Type": "text/plain",
          },
          timeout: 10_000,
        }
      );

      return resp.data?.[0] ?? null;
    } catch (err) {
      console.warn("[igdb] getGameById failed:", err);
      return null;
    }
  }
}

export const igdb = new IgdbService();
