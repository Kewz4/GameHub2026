import debounce from "lodash-es/debounce";
import { useEffect, useMemo, useRef, useState } from "react";

import { logger } from "@renderer/logger";

export const STEAM_MATCH_SEARCH_MIN_QUERY_LENGTH = 2;
export const STEAM_MATCH_SEARCH_LIMIT = 5;
export const STEAM_MATCH_SEARCH_DEBOUNCE_MS = 350;

export interface SteamMatchSuggestion {
  title: string;
  objectId: string;
  shop: "steam";
  iconUrl: string | null;
}

export function isCurrentSteamMatchSearch(
  requestId: number,
  activeRequestId: number,
  requestQuery: string,
  activeQuery: string,
  enabled: boolean
) {
  return (
    enabled && requestId === activeRequestId && requestQuery === activeQuery
  );
}

/** Debounced public-catalogue suggestions with stale response suppression. */
export function useSteamMatchSearch(query: string, enabled: boolean) {
  const [suggestions, setSuggestions] = useState<SteamMatchSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const requestIdRef = useRef(0);
  const activeQueryRef = useRef("");
  const enabledRef = useRef(enabled);

  enabledRef.current = enabled;

  const fetchSuggestions = useMemo(
    () =>
      debounce(async (searchQuery: string, requestId: number) => {
        try {
          const results = await window.electron.hydraApi.get<
            SteamMatchSuggestion[]
          >("/catalogue/search/suggestions", {
            params: {
              query: searchQuery,
              limit: STEAM_MATCH_SEARCH_LIMIT,
              shop: "steam",
            },
            needsAuth: false,
          });

          if (
            isCurrentSteamMatchSearch(
              requestId,
              requestIdRef.current,
              searchQuery,
              activeQueryRef.current,
              enabledRef.current
            )
          ) {
            setSuggestions(results);
          }
        } catch (error) {
          if (requestId === requestIdRef.current) {
            logger.error("Failed to fetch Steam match suggestions", error);
            setSuggestions([]);
          }
        } finally {
          if (requestId === requestIdRef.current) {
            setIsSearching(false);
          }
        }
      }, STEAM_MATCH_SEARCH_DEBOUNCE_MS),
    []
  );

  useEffect(() => {
    const trimmedQuery = query.trim();
    const requestId = ++requestIdRef.current;
    activeQueryRef.current = trimmedQuery;
    fetchSuggestions.cancel();

    if (!enabled || trimmedQuery.length < STEAM_MATCH_SEARCH_MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    fetchSuggestions(trimmedQuery, requestId);
  }, [enabled, fetchSuggestions, query]);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      fetchSuggestions.cancel();
    },
    [fetchSuggestions]
  );

  const clearSuggestions = () => {
    requestIdRef.current += 1;
    fetchSuggestions.cancel();
    setSuggestions([]);
    setIsSearching(false);
  };

  return { suggestions, isSearching, clearSuggestions };
}
