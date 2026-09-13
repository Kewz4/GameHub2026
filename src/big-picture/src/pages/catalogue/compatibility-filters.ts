import type { CatalogueSearchPayload } from "@types";

export type CatalogueCompatibilityFilters = Pick<
  CatalogueSearchPayload,
  "protondbSupportBadges" | "deckCompatibility"
>;

export const PROTON_FILTER_OPTIONS = [
  { value: "any", label: "Any Proton rating", badges: [] },
  {
    value: "silver_plus",
    label: "Proton: Silver or better",
    badges: ["silver", "gold", "platinum"],
  },
  {
    value: "gold_plus",
    label: "Proton: Gold or better",
    badges: ["gold", "platinum"],
  },
  { value: "platinum", label: "Proton: Platinum", badges: ["platinum"] },
] as const;

export const DECK_FILTER_OPTIONS = [
  { value: "any", label: "Any Steam Deck rating", ratings: [] },
  {
    value: "compatible",
    label: "Deck: Playable or verified",
    ratings: ["playable", "verified"],
  },
  { value: "verified", label: "Deck: Verified", ratings: ["verified"] },
] as const;

const PROTON_BADGES = [
  "borked",
  "bronze",
  "silver",
  "gold",
  "platinum",
] as const;
const DECK_RATINGS = [
  "verified",
  "playable",
  "unsupported",
  "unknown",
] as const;

function parseAllowedValues<T extends string>(
  raw: string | null,
  allowed: readonly T[]
): T[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(value.filter((item): item is T => allowed.includes(item))),
    ];
  } catch {
    return [];
  }
}

export function readCatalogueCompatibilityFilters(
  params: URLSearchParams
): CatalogueCompatibilityFilters {
  return {
    protondbSupportBadges: parseAllowedValues(
      params.get("protondbSupportBadges"),
      PROTON_BADGES
    ),
    deckCompatibility: parseAllowedValues(
      params.get("deckCompatibility"),
      DECK_RATINGS
    ),
  };
}

export function matchingCompatibilityOption(
  values: readonly string[],
  options: ReadonlyArray<{ value: string; values: readonly string[] }>
) {
  return (
    options.find(
      (option) =>
        option.values.length === values.length &&
        option.values.every((value) => values.includes(value))
    )?.value ?? "custom"
  );
}

export function hasCatalogueCompatibilityFilters(
  values: Partial<CatalogueCompatibilityFilters>
) {
  return Boolean(
    values.protondbSupportBadges?.length || values.deckCompatibility?.length
  );
}
