import type { CatalogueEntry } from "./exophase-catalogue";

const TRAILING_VARIANT_PATTERNS = [
  /\s+(?:closed\s+technical|technical|closed|open)?\s*beta$/i,
  /\s+(?:\d+)(?:st|nd|rd|th)?\s+year\s+celebration$/i,
  /\s+redux$/i,
];

const SEQUEL_NUMERALS = new Set([
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "ii",
  "iii",
  "iv",
  "vi",
  "vii",
  "viii",
  "ix",
  "xi",
  "xii",
]);

export const normalizeCatalogueMatchTitle = (title: string): string => {
  let normalized = title
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  normalized = normalized.replace(
    /\s+(?:(?:game of the year|goty|definitive|complete|deluxe|ultimate|enhanced|remastered|standard)(?: edition)?|director s cut)$/i,
    ""
  );
  for (const pattern of TRAILING_VARIANT_PATTERNS) {
    normalized = normalized.replace(pattern, "");
  }
  return normalized.replace(/\s+/g, " ").trim();
};

const scoreCatalogueTitle = (query: string, candidate: string): number => {
  const queryTitle = normalizeCatalogueMatchTitle(query);
  const candidateTitle = normalizeCatalogueMatchTitle(candidate);
  if (!queryTitle || !candidateTitle) return -1;
  if (queryTitle === candidateTitle) return 1_000;

  const longer = Math.max(queryTitle.length, candidateTitle.length);
  const shorter = Math.min(queryTitle.length, candidateTitle.length);
  const ratio = shorter / longer;
  if (
    ratio >= 0.85 &&
    (candidateTitle.includes(queryTitle) || queryTitle.includes(candidateTitle))
  ) {
    return 800 + Math.round(ratio * 100);
  }

  if (queryTitle.length >= 5 && candidateTitle.startsWith(`${queryTitle} `)) {
    const firstExtensionWord = candidateTitle
      .slice(queryTitle.length + 1)
      .split(" ")[0];
    if (!SEQUEL_NUMERALS.has(firstExtensionWord)) return 700;
  }
  return -1;
};

export function selectBestCatalogueMatch<T extends CatalogueEntry>(
  title: string,
  entries: T[]
): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const entry of entries) {
    const score = scoreCatalogueTitle(title, entry.title);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return bestScore >= 0 ? best : null;
}
