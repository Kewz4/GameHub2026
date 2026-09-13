/** Keep fallback Wine in the same prefix used by launch preparation and Cloud
 * Saves. Falling back to ~/.wine makes the launcher silently lose progress. */
export const wineLaunchEnvironment = (
  inherited: NodeJS.ProcessEnv,
  launchEnvironment: Record<string, string>,
  prefix: string | null
): NodeJS.ProcessEnv => ({
  ...inherited,
  ...launchEnvironment,
  ...(prefix ? { WINEPREFIX: prefix } : {}),
});
