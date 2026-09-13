export * from "./color";
export * from "./date";
export * from "./download-options";
export * from "./downloaders";
export * from "./focus-auto-scroll";
export * from "./game";
export * from "./gamepad-layout";
export * from "./gamepad-repeat";
export * from "./image";
export * from "./library-game-state";
export * from "./library-toast";
export * from "./language";
export * from "./navigation";
export * from "./strings";

interface PreferredGameAssetSource {
  iconUrl?: string | null;
  libraryHeroImageUrl?: string | null;
  logoImageUrl?: string | null;
  libraryImageUrl?: string | null;
  coverImageUrl?: string | null;
  title?: string;
  downloadSources?: string[];
  logoPosition?: string | null;
}

export function resolvePreferredGameAssets(
  game: PreferredGameAssetSource | null | undefined,
  shopAssets?: PreferredGameAssetSource | null
) {
  // A populated library row is authoritative, but it can predate artwork
  // enrichment. Fall back field-by-field to the freshly resolved shop assets
  // so local/emulator games do not keep a black hero simply because the
  // original import stored null artwork.
  const iconSrc = game?.iconUrl ?? shopAssets?.iconUrl ?? null;
  const heroSrc =
    game?.libraryHeroImageUrl ?? shopAssets?.libraryHeroImageUrl ?? null;
  const logoSrc = game?.logoImageUrl ?? shopAssets?.logoImageUrl ?? null;
  const coverImageUrl =
    game?.coverImageUrl ?? shopAssets?.coverImageUrl ?? null;
  const libraryImageUrl =
    game?.libraryImageUrl ?? shopAssets?.libraryImageUrl ?? null;
  return {
    iconUrl: iconSrc,
    iconSrc,
    heroImageUrl: heroSrc,
    heroSrc,
    logoImageUrl: logoSrc,
    logoSrc,
    title: game?.title ?? shopAssets?.title ?? "",
    downloadSources: game?.downloadSources ?? shopAssets?.downloadSources ?? [],
    coverSrc: coverImageUrl ?? heroSrc,
    coverImageUrl,
    landscapeSrc: heroSrc ?? libraryImageUrl,
    libraryImageUrl,
    logoPosition: game?.logoPosition ?? shopAssets?.logoPosition ?? null,
  };
}
