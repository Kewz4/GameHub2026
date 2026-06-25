import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAppSelector } from "./redux";
import { debounce } from "lodash-es";
import { logger } from "@renderer/logger";
import type { EmulatorSystem, GameShop } from "@types";

export interface SearchSuggestion {
  title: string;
  objectId: string;
  shop: GameShop;
  iconUrl: string | null;
  source: "library" | "catalogue" | "classics";
  /** Set only for classics (emulated) suggestions, used to route + fetch ROMs. */
  system?: EmulatorSystem;
}

export function useSearchSuggestions(
  query: string,
  isOnLibraryPage: boolean,
  enabled: boolean = true
) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const library = useAppSelector((state) => state.library.value);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, SearchSuggestion[]>>(new Map());
  const librarySearchIndex = useMemo(
    () =>
      library.map((game) => ({
        titleLower: game.title.toLowerCase(),
        game,
      })),
    [library]
  );

  const getLibrarySuggestions = useCallback(
    (searchQuery: string, limit: number = 3): SearchSuggestion[] => {
      const normalizedQuery = searchQuery.trim().toLowerCase();
      if (normalizedQuery.length < 2) return [];

      const matches: SearchSuggestion[] = [];

      for (const { game, titleLower } of librarySearchIndex) {
        if (matches.length >= limit) break;

        if (titleLower.includes(normalizedQuery)) {
          matches.push({
            title: game.title,
            objectId: game.objectId,
            shop: game.shop,
            iconUrl: game.iconUrl,
            source: "library",
          });
          continue;
        }

        let queryIndex = 0;

        for (
          let index = 0;
          index < titleLower.length && queryIndex < normalizedQuery.length;
          index++
        ) {
          if (titleLower[index] === normalizedQuery[queryIndex]) {
            queryIndex++;
          }
        }

        if (queryIndex === normalizedQuery.length) {
          matches.push({
            title: game.title,
            objectId: game.objectId,
            shop: game.shop,
            iconUrl: game.iconUrl,
            source: "library",
          });
        }
      }

      return matches;
    },
    [librarySearchIndex]
  );

  const fetchCatalogueSuggestions = useCallback(
    async (searchQuery: string, limit: number = 3) => {
      if (!searchQuery.trim() || searchQuery.length < 2) {
        setSuggestions([]);
        setIsLoading(false);
        return;
      }

      const cacheKey = `${searchQuery.toLowerCase()}_${limit}`;
      const cachedResults = cacheRef.current.get(cacheKey);

      if (cachedResults) {
        setSuggestions(cachedResults);
        setIsLoading(false);
        return;
      }

      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setIsLoading(true);

      try {
        // Query the PC catalogue (HydraApi) and the local console/emulated
        // catalogue (minerva) in parallel — a failure of one must not hide the
        // other, so each side falls back to an empty list.
        const [response, classics] = await Promise.all([
          window.electron.hydraApi
            .get<
              {
                title: string;
                objectId: string;
                shop: GameShop;
                iconUrl: string | null;
              }[]
            >("/catalogue/search/suggestions", {
              params: { query: searchQuery, limit },
              needsAuth: false,
            })
            .catch(() => []),
          window.electron.searchMinervaGames(searchQuery, limit).catch(() => []),
        ]);

        if (abortController.signal.aborted) return;

        const catalogueSuggestions: SearchSuggestion[] = response.map(
          (item) => ({
            ...item,
            source: "catalogue" as const,
          })
        );

        const classicsSuggestions: SearchSuggestion[] = classics.map(
          (item) => ({
            title: item.title,
            objectId: item.objectId,
            shop: "launchbox" as const,
            iconUrl: null,
            source: "classics" as const,
            system: item.system,
          })
        );

        const merged = [...catalogueSuggestions, ...classicsSuggestions];

        cacheRef.current.set(cacheKey, merged);
        setSuggestions(merged);
      } catch (error) {
        if (!abortController.signal.aborted) {
          setSuggestions([]);
          logger.error("Failed to fetch search suggestions", error);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  const debouncedFetchCatalogue = useRef(
    debounce(fetchCatalogueSuggestions, 300)
  ).current;

  useEffect(() => {
    if (!enabled || !query || query.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      abortControllerRef.current?.abort();
      debouncedFetchCatalogue.cancel();
      return;
    }

    if (isOnLibraryPage) {
      const librarySuggestions = getLibrarySuggestions(query, 3);
      setSuggestions(librarySuggestions);
      setIsLoading(false);
    } else {
      debouncedFetchCatalogue(query, 3);
    }

    return () => {
      debouncedFetchCatalogue.cancel();
      abortControllerRef.current?.abort();
    };
  }, [
    query,
    isOnLibraryPage,
    enabled,
    getLibrarySuggestions,
    debouncedFetchCatalogue,
  ]);

  return { suggestions, isLoading };
}
