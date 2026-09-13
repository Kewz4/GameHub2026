import fs from "node:fs";

import { isProtocolExecutablePath } from "../helpers/game-executable-path";
import type { Game } from "@types";

type GameFolderTargetGame = Pick<
  Game,
  | "shop"
  | "executablePath"
  | "nativeExecutablePath"
  | "selectedDiscPath"
  | "discs"
>;

const isExistingFilesystemPath = (candidate: string | null | undefined) => {
  if (!candidate || isProtocolExecutablePath(candidate)) return false;
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
};

/** Select the real local item represented by a native, protocol, or ROM game. */
export const resolveGameFolderTarget = (
  game: GameFolderTargetGame,
  exists: (
    candidate: string | null | undefined
  ) => boolean = isExistingFilesystemPath
): string | null => {
  const romCandidates = [
    game.selectedDiscPath,
    ...(game.discs?.map((disc) => disc.path) ?? []),
  ];
  const executableCandidates = [game.executablePath, game.nativeExecutablePath];
  const candidates =
    game.shop === "launchbox"
      ? [...romCandidates, ...executableCandidates]
      : [...executableCandidates, ...romCandidates];

  return (
    candidates.find(
      (candidate): candidate is string =>
        Boolean(candidate) &&
        !isProtocolExecutablePath(candidate) &&
        exists(candidate)
    ) ?? null
  );
};
