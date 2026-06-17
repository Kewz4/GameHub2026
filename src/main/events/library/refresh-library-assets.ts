import { registerEvent } from "../register-event";
import { mergeWithRemoteGames } from "@main/services";

const refreshLibraryAssets = async () => {
  // Update-only: this fires on every library-page mount (including right after
  // an Exophase achievement import). It must refresh data for games already in
  // the library WITHOUT silently pulling cloud games the user never added here.
  // The full create-capable sync still runs at sign-in (see hydra-api.ts).
  await mergeWithRemoteGames({ createMissing: false });
};

registerEvent("refreshLibraryAssets", refreshLibraryAssets);
