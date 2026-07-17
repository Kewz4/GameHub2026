import type { LibraryGame } from "@types";
import { useCallback } from "react";
import { IS_DESKTOP } from "../../../constants";

export function useLibraryLaunchGame(
  onMissingExecutable: (game: LibraryGame) => void
) {
  return useCallback(
    async (game: LibraryGame) => {
      if (!IS_DESKTOP) return;

      // Console/emulated games (shop "launchbox") launch through the emulator,
      // not an executable — they never have an executablePath, so route them to
      // openClassicsGame instead of mis-firing the "missing executable" flow.
      if (game.shop === "launchbox") {
        await globalThis.window.electron.openClassicsGame(
          game.shop,
          game.objectId
        );
        return;
      }

      if (!game.executablePath) {
        onMissingExecutable(game);
        return;
      }

      await globalThis.window.electron.openGame(
        game.shop,
        game.objectId,
        game.executablePath,
        game.launchOptions
      );
    },
    [onMissingExecutable]
  );
}
