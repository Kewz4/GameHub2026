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

export function resolvePreferredGameAssets(
  game: {
    iconUrl?: string | null;
    libraryHeroImageUrl?: string | null;
    logoImageUrl?: string | null;
    libraryImageUrl?: string | null;
    coverImageUrl?: string | null;
    title?: string;
    downloadSources?: string[];
    logoPosition?: string | null;
  } | null | undefined,
  _shopDetails?: unknown
) {
  if (!game) {
    return {
      iconUrl: null, iconSrc: null, heroImageUrl: null, heroSrc: null,
      logoImageUrl: null, logoSrc: null, title: "", downloadSources: [],
      coverSrc: null, coverImageUrl: null, landscapeSrc: null,
      libraryImageUrl: null, logoPosition: null,
    };
  }
  const iconSrc = game.iconUrl ?? null;
  const heroSrc = game.libraryHeroImageUrl ?? null;
  const logoSrc = game.logoImageUrl ?? null;
  return {
    iconUrl: iconSrc,
    iconSrc,
    heroImageUrl: heroSrc,
    heroSrc,
    logoImageUrl: logoSrc,
    logoSrc,
    title: game.title ?? "",
    downloadSources: game.downloadSources ?? [],
    coverSrc: game.coverImageUrl ?? heroSrc,
    coverImageUrl: game.coverImageUrl ?? null,
    landscapeSrc: game.libraryHeroImageUrl ?? null,
    libraryImageUrl: game.libraryImageUrl ?? null,
    logoPosition: game.logoPosition ?? null,
  };
}
