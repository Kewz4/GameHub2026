/** One parser for cold starts, second instances, and operating-system links. */
export function parseLauncherLink(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const link = new URL(value);
    return link.protocol === "hydralauncher:" &&
      !link.username &&
      !link.password
      ? link
      : null;
  } catch {
    return null;
  }
}

export function getLauncherIntent(args: readonly string[]) {
  const deepLink = args.find((arg) => parseLauncherLink(arg) !== null);
  const link = parseLauncherLink(deepLink);
  const runGame = link?.host === "run";
  const bigPicture =
    !runGame && (link?.host === "bigpicture" || args.includes("--big-picture"));
  return { deepLink, runGame, bigPicture };
}
