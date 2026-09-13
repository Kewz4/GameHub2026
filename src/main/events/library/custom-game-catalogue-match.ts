const MAX_STEAM_APP_ID = 4_294_967_295n;

/**
 * Validates an explicitly selected Steam catalogue identity. GameHub stores a
 * matched manual game under this canonical Steam key (with libraryOrigin
 * "custom") instead of creating a second custom identity that achievements
 * and cloud saves cannot resolve consistently.
 */
export function normalizeExplicitSteamAppId(
  objectId: string | null | undefined
): string | null {
  if (objectId === null || objectId === undefined) return null;

  const trimmed = objectId.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Invalid Steam catalogue match");
  }

  const numericId = BigInt(trimmed);
  if (numericId === 0n || numericId > MAX_STEAM_APP_ID) {
    throw new Error("Invalid Steam catalogue match");
  }

  return numericId.toString();
}

export function getCanonicalManualGameIdentity(
  fallbackCustomObjectId: string,
  explicitSteamObjectId: string | null
) {
  return explicitSteamObjectId
    ? {
        shop: "steam" as const,
        objectId: explicitSteamObjectId,
        libraryOrigin: "custom" as const,
      }
    : {
        shop: "custom" as const,
        objectId: fallbackCustomObjectId,
        libraryOrigin: "custom" as const,
      };
}
