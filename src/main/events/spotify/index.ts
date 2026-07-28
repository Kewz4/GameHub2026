import { SpotifyService } from "@main/services/spotify-service";
import { OverlayManager } from "@main/services/overlay-manager";
import { WindowManager } from "@main/services/window-manager";
import { registerEvent } from "../register-event";

registerEvent("spotifyGetStatus", () => SpotifyService.getStatus());
registerEvent("spotifyLogin", () => SpotifyService.login());
registerEvent("spotifyLogout", () => SpotifyService.logout());
registerEvent("spotifyGetNowPlaying", () => SpotifyService.getNowPlaying());
registerEvent("spotifyGetPlayback", () => SpotifyService.getPlayback());
registerEvent("spotifyGetDevices", () => SpotifyService.getDevices());
registerEvent("spotifyGetQueue", () => SpotifyService.getQueue());
registerEvent("spotifyGetHome", () => SpotifyService.getHome());
registerEvent("spotifySearch", (_event, query: unknown) =>
  SpotifyService.search(query)
);
registerEvent(
  "spotifyGetPlaylistItems",
  (_event, playlistId: unknown, offset?: unknown) =>
    SpotifyService.getPlaylistItems(playlistId, offset)
);
registerEvent("spotifyPlaybackCommand", (_event, command: unknown) =>
  SpotifyService.playbackCommand(command)
);
registerEvent("spotifySetSaved", (_event, uri: unknown, saved: unknown) =>
  SpotifyService.setSaved(uri, saved)
);
registerEvent("spotifyLibraryContains", (_event, uris: unknown) =>
  SpotifyService.libraryContains(uris)
);
registerEvent("spotifyOpenSettings", () => {
  OverlayManager.hideOverlayForMainWindow();
  WindowManager.focusMainWindowAndNavigate("/settings?tab=integrations");
});
registerEvent("spotifyControl", (_event, action: unknown) =>
  SpotifyService.control(action)
);
