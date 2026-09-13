export const DEFAULT_EXTERNAL_RESOURCES_URL = "https://assets.hydralauncher.gg";

/**
 * Release builds normally inject the external-resources origin through Vite.
 * Keep the public production origin as a defensive fallback so a locally built
 * GameHub does not silently turn `/steam-*.json` requests into invalid file
 * URLs when the optional build variable is absent.
 */
export function resolveExternalResourcesUrl(configuredUrl?: string | null) {
  const normalized = configuredUrl?.trim().replace(/\/+$/, "");

  return normalized || DEFAULT_EXTERNAL_RESOURCES_URL;
}

export function buildExternalResourceUrl(
  resourcePath: string,
  configuredUrl?: string | null
) {
  const normalizedPath = resourcePath.startsWith("/")
    ? resourcePath
    : `/${resourcePath}`;

  return `${resolveExternalResourcesUrl(configuredUrl)}${normalizedPath}`;
}
