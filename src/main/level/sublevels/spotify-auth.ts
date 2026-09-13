import { db } from "../level";

/** Legacy row from the original Spotify proof-of-concept. Read only so it can
 *  be migrated into Electron safeStorage on the next launch. */
export interface SpotifyLegacyAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** OAuth material is encrypted as one authenticated OS-protected payload.
 *  Neither access nor refresh tokens are left as LevelDB JSON fields. */
export interface SpotifyEncryptedAuth {
  version: 2;
  encryptedPayload: string;
  /** Non-secret timestamp used to show the six-month reconnect deadline. */
  authorizedAt: number;
}

export type SpotifyStoredAuth = SpotifyLegacyAuth | SpotifyEncryptedAuth;

export const spotifyAuthSublevel = db.sublevel<string, SpotifyStoredAuth>(
  "spotifyAuth",
  { valueEncoding: "json" }
);

/** Single-row key — one Spotify account per install. */
export const SPOTIFY_AUTH_KEY = "tokens";
