import type { MusicTrack, MusicPlayerState, RepeatMode } from "@types";
import { overlayMusicPlayer } from "@main/services/overlay-music-player";
import { registerEvent } from "../register-event";

registerEvent(
  "musicSearch",
  (_event, query: string): Promise<MusicTrack[]> =>
    overlayMusicPlayer.search(query)
);

registerEvent(
  "musicGetState",
  (): MusicPlayerState => overlayMusicPlayer.getState()
);

registerEvent(
  "musicSetQueue",
  (_event, tracks: MusicTrack[], startIndex?: number): void =>
    overlayMusicPlayer.setQueue(tracks, startIndex)
);

registerEvent("musicAddToQueue", (_event, track: MusicTrack): void =>
  overlayMusicPlayer.addToQueue(track)
);

registerEvent("musicRemoveFromQueue", (_event, index: number): void =>
  overlayMusicPlayer.removeFromQueue(index)
);

registerEvent("musicClearQueue", (): void => overlayMusicPlayer.clearQueue());

registerEvent(
  "musicPlay",
  async (_event, index?: number): Promise<MusicTrack | null> =>
    overlayMusicPlayer.play(index)
);

registerEvent("musicPause", (): void => overlayMusicPlayer.pause());

registerEvent("musicResume", (): void => overlayMusicPlayer.resume());

registerEvent("musicStop", (): void => overlayMusicPlayer.stop());

registerEvent(
  "musicNext",
  async (): Promise<MusicTrack | null> => overlayMusicPlayer.next()
);

registerEvent(
  "musicPrevious",
  async (): Promise<MusicTrack | null> => overlayMusicPlayer.previous()
);

registerEvent("musicSetShuffle", (_event, enabled: boolean): void =>
  overlayMusicPlayer.setShuffle(enabled)
);

registerEvent("musicSetRepeat", (_event, mode: RepeatMode): void =>
  overlayMusicPlayer.setRepeat(mode)
);

registerEvent(
  "musicGetPlaylists",
  async (): Promise<import("@types").MusicPlaylist[]> =>
    overlayMusicPlayer.getPlaylists()
);

registerEvent(
  "musicCreatePlaylist",
  async (_event, name: string): Promise<import("@types").MusicPlaylist> =>
    overlayMusicPlayer.createPlaylist(name)
);

registerEvent(
  "musicDeletePlaylist",
  async (_event, id: string): Promise<void> =>
    overlayMusicPlayer.deletePlaylist(id)
);

registerEvent(
  "musicRenamePlaylist",
  async (_event, id: string, name: string): Promise<void> =>
    overlayMusicPlayer.renamePlaylist(id, name)
);

registerEvent(
  "musicAddToPlaylist",
  async (_event, playlistId: string, track: MusicTrack): Promise<void> =>
    overlayMusicPlayer.addToPlaylist(playlistId, track)
);

registerEvent(
  "musicRemoveFromPlaylist",
  async (_event, playlistId: string, trackIndex: number): Promise<void> =>
    overlayMusicPlayer.removeFromPlaylist(playlistId, trackIndex)
);

registerEvent(
  "musicPlayPlaylist",
  async (
    _event,
    playlistId: string,
    startIndex?: number
  ): Promise<MusicTrack | null> =>
    overlayMusicPlayer.playPlaylist(playlistId, startIndex)
);
