import { db } from "../level";

/** Stored Spotify OAuth tokens (Authorization Code + PKCE). The client ID is
 *  configured separately in user preferences; only the tokens live here. */
export interface SpotifyAuth {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms after which the access token must be refreshed. */
  expiresAt: number;
}

export const spotifyAuthSublevel = db.sublevel<string, SpotifyAuth>(
  "spotifyAuth",
  { valueEncoding: "json" }
);

/** Single-row key — one Spotify account per install. */
export const SPOTIFY_AUTH_KEY = "tokens";
