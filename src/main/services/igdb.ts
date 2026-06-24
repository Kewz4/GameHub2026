import axios from "axios";

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

  async getToken(clientId: string, clientSecret: string): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }

    const resp = await axios.post<{
      access_token: string;
      expires_in: number;
    }>(
      "https://id.twitch.tv/oauth2/token",
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
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
    platformId: number | undefined,
    clientId: string,
    clientSecret: string
  ): Promise<IgdbGame | null> {
    try {
      const token = await this.getToken(clientId, clientSecret);
      const platformClause = platformId ? ` & platforms = [${platformId}]` : "";
      const query = `fields name,summary,first_release_date,genres.name,cover.url,screenshots.url,platforms.id,involved_companies.company.name,involved_companies.developer,involved_companies.publisher;
where name ~ *"${title.replace(/"/g, "")}"*${platformClause};
limit 5;`;

      const resp = await axios.post<IgdbGame[]>(
        "https://api.igdb.com/v4/games",
        query,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Client-ID": clientId,
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

  async getGameById(
    igdbId: number,
    clientId: string,
    clientSecret: string
  ): Promise<IgdbGame | null> {
    try {
      const token = await this.getToken(clientId, clientSecret);
      const query = `fields name,summary,first_release_date,genres.name,cover.url,screenshots.url,platforms.id,involved_companies.company.name,involved_companies.developer,involved_companies.publisher;
where id = ${igdbId};
limit 1;`;

      const resp = await axios.post<IgdbGame[]>(
        "https://api.igdb.com/v4/games",
        query,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Client-ID": clientId,
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
