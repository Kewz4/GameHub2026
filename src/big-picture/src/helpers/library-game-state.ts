import type { GameShop, LibraryGame } from "@types";

export type LibraryGameState = {
  libraryGame: LibraryGame | null;
  isInLibrary: boolean;
  /** True when the game can actually be launched: it has an executable, is a
   * confirmed local install, or is an emulated (launchbox) game whose discs are
   * present. Drives the hero "Launch Game" vs "Download Game" button. */
  isPlayable: boolean;
};

export function getLibraryGameState(
  library: LibraryGame[],
  shop: GameShop,
  objectId: string
): LibraryGameState {
  const libraryGame =
    library.find((g) => g.shop === shop && g.objectId === objectId) ?? null;

  return {
    libraryGame,
    isInLibrary: libraryGame !== null,
    isPlayable:
      Boolean(libraryGame?.executablePath) ||
      libraryGame?.isInstalledLocally === true ||
      (libraryGame?.shop === "launchbox" &&
        (libraryGame.discs?.length ?? 0) > 0),
  };
}
