export interface SupportedLanguage {
  language: string;
  hasAudio: boolean;
}

/** Parse Steam's comma-separated language markup before its audio footnote. */
export function parseSupportedLanguages(
  supportedLanguages: string | null | undefined
): SupportedLanguage[] {
  if (!supportedLanguages?.trim()) return [];

  const languageList = supportedLanguages.split(/<br\s*\/?>/i, 1)[0] ?? "";

  return languageList
    .split(",")
    .map((entry) => {
      const hasAudio = /<strong[^>]*>\s*\*\s*<\/strong>/i.test(entry);
      const language = entry
        .replace(/<strong[^>]*>\s*\*\s*<\/strong>/gi, "")
        .replace(/<[^>]+>/g, "")
        .trim();

      return { language, hasAudio };
    })
    .filter((entry) => entry.language.length > 0);
}
