const NINTENDO_EAD_NAME =
  /^Nintendo Entertainment Analysis\s*(?:&|and)\s*Development(?:\s*\(EAD\))?$/i;

function normalizeMetadataCredit(value: string) {
  const normalized = value.trim().replaceAll(/\s+/g, " ");

  if (NINTENDO_EAD_NAME.test(normalized)) return "Nintendo EAD";

  return normalized;
}

/**
 * Merge developer/publisher lists supplied by independent metadata sources.
 * Empty values are ignored and names are deduplicated case-insensitively after
 * normalizing well-known long-form credits to their user-facing label.
 */
export function mergeMetadataCredits(
  ...sources: Array<readonly (string | null | undefined)[] | null | undefined>
) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const source of sources) {
    for (const value of source ?? []) {
      if (!value) continue;

      const normalized = normalizeMetadataCredit(value);
      const key = normalized.toLocaleLowerCase();
      if (!normalized || seen.has(key)) continue;

      seen.add(key);
      result.push(normalized);
    }
  }

  return result;
}
