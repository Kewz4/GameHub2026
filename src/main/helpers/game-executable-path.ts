import fs from "node:fs";

import type { Game } from "@types";

type ExecutablePathGame = Pick<Game, "executablePath" | "nativeExecutablePath">;

export const isProtocolExecutablePath = (value: string | null | undefined) =>
  Boolean(value && /^[a-z][a-z\d+.-]*:\/\//i.test(value));

export const executablePathExists = (
  value: string | null | undefined
): value is string => {
  if (!value || isProtocolExecutablePath(value)) return false;
  try {
    return fs.existsSync(value);
  } catch {
    return false;
  }
};

/**
 * Choose the executable used to identify an installed/running PC game.
 *
 * Platform imports keep a store URI in executablePath and the discovered
 * render process in nativeExecutablePath, so a valid native path is preferred
 * for URI launches. For local games, executablePath is the user-selected
 * launch target and therefore wins even when an obsolete extraction still
 * exists at nativeExecutablePath.
 */
export const selectGameExecutablePath = (
  game: ExecutablePathGame,
  exists: (
    value: string | null | undefined
  ) => value is string = executablePathExists
): string | null => {
  const launchPathIsProtocol = isProtocolExecutablePath(game.executablePath);

  if (!launchPathIsProtocol && exists(game.executablePath)) {
    return game.executablePath;
  }
  if (exists(game.nativeExecutablePath)) return game.nativeExecutablePath;

  if (launchPathIsProtocol) {
    return game.executablePath ?? null;
  }
  if (isProtocolExecutablePath(game.nativeExecutablePath)) {
    return game.nativeExecutablePath ?? null;
  }

  // executablePath is the user-visible launch command and is the most recent
  // choice for local games. Keep it as the diagnostic fallback when neither
  // candidate currently exists.
  return game.executablePath ?? game.nativeExecutablePath ?? null;
};
