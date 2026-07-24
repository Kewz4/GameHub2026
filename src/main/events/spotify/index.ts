import type { SpotifyControlAction } from "@types";
import { SpotifyService } from "@main/services/spotify-service";
import { registerEvent } from "../register-event";

registerEvent("spotifyGetStatus", () => SpotifyService.getStatus());
registerEvent("spotifyLogin", () => SpotifyService.login());
registerEvent("spotifyLogout", () => SpotifyService.logout());
registerEvent("spotifyGetNowPlaying", () => SpotifyService.getNowPlaying());
registerEvent("spotifyControl", (_event, action: SpotifyControlAction) =>
  SpotifyService.control(action)
);
