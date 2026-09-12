import { logger } from "@renderer/logger";

type MetadataKind = "genres" | "tags" | "developers" | "publishers";
const SUPPORTED_LANGUAGES = new Set(["en", "es", "pt", "ru", "fr"]);
const requests = new Map<
  string,
  { expiresAt: number; promise: Promise<unknown> }
>();

/** Shared by Desktop and Big Picture; failed requests are never cached. */
export function getCatalogueMetadata<T>(
  kind: MetadataKind,
  language = "en"
): Promise<T> {
  const base = language.split(/[-_]/)[0].toLowerCase();
  const localized = kind === "genres" || kind === "tags";
  const requestLanguage = SUPPORTED_LANGUAGES.has(base) ? base : "en";
  const key = `${kind}:${localized ? requestLanguage : ""}`;
  const cached = requests.get(key);
  if (cached && cached.expiresAt > Date.now())
    return cached.promise as Promise<T>;

  const promise = window.electron.hydraApi
    .get<T>(`/catalogue/steam/${kind}`, {
      needsAuth: false,
      ...(localized ? { params: { language: requestLanguage } } : {}),
    })
    .then((data) => {
      const valid =
        kind === "tags"
          ? data !== null &&
            typeof data === "object" &&
            !Array.isArray(data) &&
            Object.values(data).every(
              (id) => typeof id === "number" && Number.isFinite(id)
            )
          : Array.isArray(data) &&
            data.every((value) => typeof value === "string");
      if (!valid) throw new Error(`Invalid ${kind} catalogue metadata`);
      return data;
    })
    .catch((error: unknown) => {
      if (requests.get(key)?.promise === promise) requests.delete(key);
      logger.warn(`[catalogue] Could not load ${kind}`, error);
      throw error;
    });
  requests.set(key, { expiresAt: Date.now() + 5 * 60_000, promise });
  return promise;
}

export async function getLocalizedCatalogueMetadata<T>(
  kind: "genres" | "tags",
  locale: string
) {
  const language = locale.split(/[-_]/)[0].toLowerCase() || "en";
  const english = await getCatalogueMetadata<T>(kind);
  const localized =
    language === "en"
      ? english
      : await getCatalogueMetadata<T>(kind, language).catch(() => english);
  return { en: english, [language]: localized };
}
