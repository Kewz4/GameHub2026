export interface ResolvedProfileImages {
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
}

/**
 * Merge a late local/R2 image lookup without ever clearing a valid API/local
 * fallback or applying a response that belongs to a previous profile route.
 */
export function mergeResolvedProfileImages<
  T extends {
    id: string;
    profileImageUrl?: string | null;
    backgroundImageUrl?: string | null;
  },
>(
  current: T | null,
  expectedUserId: string,
  images: ResolvedProfileImages | null
): T | null {
  if (!current || current.id !== expectedUserId || !images) return current;
  if (!images.profileImageUrl && !images.backgroundImageUrl) return current;

  return {
    ...current,
    profileImageUrl: images.profileImageUrl ?? current.profileImageUrl,
    backgroundImageUrl: images.backgroundImageUrl ?? current.backgroundImageUrl,
  };
}
