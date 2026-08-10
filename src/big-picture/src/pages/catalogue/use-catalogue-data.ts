import type {
  CatalogueSearchPayload,
  CatalogueSearchResult,
  DownloadSource,
  EmulatorSystem,
} from "@types";
import { levelDBService } from "@renderer/services/leveldb.service";
import { resolveExternalResourcesUrl } from "@renderer/helpers/external-resources";
import axios from "axios";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";

const DEFAULT_PAGE_SIZE = 20;
const WIDE_PAGE_SIZE = 30;
const WIDE_GRID_MEDIA_QUERY = "(min-width: 1440px)";

function getCataloguePageSize() {
  return globalThis.window.matchMedia(WIDE_GRID_MEDIA_QUERY).matches
    ? WIDE_PAGE_SIZE
    : DEFAULT_PAGE_SIZE;
}

export enum FilterType {
  Genres = "genres",
  Tags = "tags",
  DownloadSourceFingerprints = "downloadSourceFingerprints",
  Publishers = "publishers",
  Developers = "developers",
}

export type CatalogueMetadataStatus =
  | "loading"
  | "ready"
  | "partial"
  | "unavailable";

interface CatalogueFacet<T> {
  data: T;
  label: string;
  color: string;
  status: CatalogueMetadataStatus;
}

export interface CatalogueData {
  [FilterType.Genres]: CatalogueFacet<string[]>;
  [FilterType.Tags]: CatalogueFacet<Record<string, number>>;
  [FilterType.DownloadSourceFingerprints]: CatalogueFacet<
    Record<string, string>
  >;
  [FilterType.Developers]: CatalogueFacet<string[]>;
  [FilterType.Publishers]: CatalogueFacet<string[]>;
}

export interface SearchGamesFormValues {
  title?: string;
  sortBy?: CatalogueSearchPayload["sortBy"];
  sortOrder?: CatalogueSearchPayload["sortOrder"];
  [FilterType.Tags]?: number[];
  [FilterType.Genres]?: string[];
  [FilterType.Publishers]?: string[];
  [FilterType.Developers]?: string[];
  [FilterType.DownloadSourceFingerprints]?: string[];
}

export const CATALOGUE_SORT_OPTIONS = [
  {
    value: "popularity:desc",
    label: "Popularity",
    sortBy: "popularity",
    sortOrder: "desc",
  },
  {
    value: "releaseDate:desc",
    label: "Newest releases",
    sortBy: "releaseDate",
    sortOrder: "desc",
  },
  {
    value: "releaseDate:asc",
    label: "Oldest releases",
    sortBy: "releaseDate",
    sortOrder: "asc",
  },
  {
    value: "alphabetical:asc",
    label: "Title (A-Z)",
    sortBy: "alphabetical",
    sortOrder: "asc",
  },
  {
    value: "alphabetical:desc",
    label: "Title (Z-A)",
    sortBy: "alphabetical",
    sortOrder: "desc",
  },
  {
    value: "hydraScore:desc",
    label: "Highest rating",
    sortBy: "hydraScore",
    sortOrder: "desc",
  },
  {
    value: "hydraScore:asc",
    label: "Lowest rating",
    sortBy: "hydraScore",
    sortOrder: "asc",
  },
] as const satisfies ReadonlyArray<{
  value: string;
  label: string;
  sortBy: CatalogueSearchPayload["sortBy"];
  sortOrder: CatalogueSearchPayload["sortOrder"];
}>;

export type CatalogueSortValue =
  (typeof CATALOGUE_SORT_OPTIONS)[number]["value"];

const DEFAULT_CATALOGUE_SORT_OPTION = CATALOGUE_SORT_OPTIONS[0];

export interface SearchGamesResponseData {
  edges: CatalogueSearchResult[];
  count: number;
}

interface SteamGenresResponse {
  en: string[];
}

interface SteamTagsResponse {
  en: Record<string, number>;
}

const externalResourcesInstance = axios.create({
  baseURL: resolveExternalResourcesUrl(
    import.meta.env.RENDERER_VITE_EXTERNAL_RESOURCES_URL
  ),
});

function parseJsonParam(value: string | null): unknown {
  if (!value) return undefined;

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseStringArrayParam(value: string | null) {
  const parsed = parseJsonParam(value);

  if (!Array.isArray(parsed)) return [];

  return parsed.filter((item): item is string => typeof item === "string");
}

function parseNumberArrayParam(value: string | null) {
  const parsed = parseJsonParam(value);

  if (!Array.isArray(parsed)) return [];

  return parsed.filter(
    (item): item is number => typeof item === "number" && Number.isFinite(item)
  );
}

function getCatalogueSortOption(searchParams: URLSearchParams) {
  const value = `${searchParams.get("sortBy")}:${searchParams.get("sortOrder")}`;

  return (
    CATALOGUE_SORT_OPTIONS.find((option) => option.value === value) ??
    DEFAULT_CATALOGUE_SORT_OPTION
  );
}

export function useCatalogueData() {
  const [searchParams, setSearchParams] = useSearchParams();
  const deferredTitle = useDeferredValue(searchParams.get("title") ?? "");
  const [pageSize, setPageSize] = useState(getCataloguePageSize);
  const [page, setPage] = useState(1);

  const [steamGenres, setSteamGenres] = useState<string[]>([]);
  const [steamTags, setSteamTags] = useState<Record<string, number>>({});
  const [steamDevelopers, setSteamDevelopers] = useState<string[]>([]);
  const [steamPublishers, setSteamPublishers] = useState<string[]>([]);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [metadataStatus, setMetadataStatus] = useState<
    Record<FilterType, CatalogueMetadataStatus>
  >({
    [FilterType.Genres]: "loading",
    [FilterType.Tags]: "loading",
    [FilterType.Developers]: "loading",
    [FilterType.Publishers]: "loading",
    [FilterType.DownloadSourceFingerprints]: "loading",
  });
  const [searchData, setSearchData] = useState<SearchGamesResponseData>();
  const [isLoadingSearch, setIsLoadingSearch] = useState(true);
  const [searchError, setSearchError] = useState<Error | null>(null);
  const downloadSourceIds = useMemo(
    () => downloadSources.map((source) => source.id),
    [downloadSources]
  );

  useEffect(() => {
    const mediaQuery = globalThis.window.matchMedia(WIDE_GRID_MEDIA_QUERY);
    const updatePageSize = () => setPageSize(getCataloguePageSize());

    mediaQuery.addEventListener("change", updatePageSize);

    return () => {
      mediaQuery.removeEventListener("change", updatePageSize);
    };
  }, []);

  const values = useMemo<SearchGamesFormValues>(() => {
    const sortOption = getCatalogueSortOption(searchParams);

    return {
      title: searchParams.get("title") ?? "",
      sortBy: sortOption.sortBy,
      sortOrder: sortOption.sortOrder,
      tags: parseNumberArrayParam(searchParams.get("tags")),
      genres: parseStringArrayParam(searchParams.get("genres")),
      publishers: parseStringArrayParam(searchParams.get("publishers")),
      developers: parseStringArrayParam(searchParams.get("developers")),
      downloadSourceFingerprints: parseStringArrayParam(
        searchParams.get("downloadSourceFingerprints")
      ),
    };
  }, [searchParams]);

  // Platform filter (All / PC / Console) + optional console-system, mirroring
  // the desktop catalogue. Kept in the URL like every other filter.
  const platform = (searchParams.get("platform") ?? "") as
    | ""
    | "pc"
    | "console";
  const consoleSystem = (searchParams.get("consoleSystem") ?? "") as
    | ""
    | EmulatorSystem;

  const setPlatform = useCallback(
    (next: "" | "pc" | "console") => {
      setSearchParams((current) => {
        const params = new URLSearchParams(current);
        if (next) params.set("platform", next);
        else params.delete("platform");
        params.delete("consoleSystem");
        return params;
      });
    },
    [setSearchParams]
  );

  const setConsoleSystem = useCallback(
    (next: "" | EmulatorSystem) => {
      setSearchParams((current) => {
        const params = new URLSearchParams(current);
        if (next) params.set("consoleSystem", next);
        else params.delete("consoleSystem");
        return params;
      });
    },
    [setSearchParams]
  );

  useEffect(() => {
    setPage(1);
  }, [
    values.title,
    values.developers,
    values.downloadSourceFingerprints,
    values.genres,
    values.publishers,
    values.sortBy,
    values.sortOrder,
    values.tags,
    pageSize,
    platform,
    consoleSystem,
  ]);

  const updateSearchParams = useCallback(
    (newValues: Partial<SearchGamesFormValues>) => {
      setSearchParams((currentSearchParams) => {
        const nextSearchParams = new URLSearchParams(currentSearchParams);

        Object.entries(newValues).forEach(([key, value]) => {
          if (typeof value === "string") {
            if (value.trim().length > 0) {
              nextSearchParams.set(key, value);
            } else {
              nextSearchParams.delete(key);
            }

            return;
          }

          if (Array.isArray(value) && value.length > 0) {
            nextSearchParams.set(key, JSON.stringify(value));
          } else {
            nextSearchParams.delete(key);
          }
        });

        return nextSearchParams;
      });
    },
    [setSearchParams]
  );

  useEffect(() => {
    let cancelled = false;

    const loadMetadata = async () => {
      const [
        genresResponse,
        tagsResponse,
        developersResponse,
        publishersResponse,
        rawDownloadSources,
      ] = await Promise.allSettled([
        externalResourcesInstance.get<SteamGenresResponse>(
          "/steam-genres.json"
        ),
        externalResourcesInstance.get<SteamTagsResponse>(
          "/steam-user-tags.json"
        ),
        externalResourcesInstance.get<string[]>("/steam-developers.json"),
        externalResourcesInstance.get<string[]>("/steam-publishers.json"),
        levelDBService.values("downloadSources"),
      ]);

      if (cancelled) return;

      if (genresResponse.status === "fulfilled") {
        const genres = Array.isArray(genresResponse.value.data.en)
          ? genresResponse.value.data.en
          : [];
        setSteamGenres(genres);
      }

      if (tagsResponse.status === "fulfilled") {
        const tags = tagsResponse.value.data.en;
        setSteamTags(
          tags && typeof tags === "object" && !Array.isArray(tags) ? tags : {}
        );
      }

      if (developersResponse.status === "fulfilled") {
        setSteamDevelopers(
          Array.isArray(developersResponse.value.data)
            ? developersResponse.value.data
            : []
        );
      }

      if (publishersResponse.status === "fulfilled") {
        setSteamPublishers(
          Array.isArray(publishersResponse.value.data)
            ? publishersResponse.value.data
            : []
        );
      }

      if (rawDownloadSources.status === "fulfilled") {
        setDownloadSources(
          (rawDownloadSources.value as DownloadSource[]).filter(
            (source) => !!source.fingerprint
          )
        );
      }

      setMetadataStatus({
        [FilterType.Genres]:
          genresResponse.status === "fulfilled" &&
          Array.isArray(genresResponse.value.data.en) &&
          genresResponse.value.data.en.length > 0
            ? "ready"
            : "unavailable",
        [FilterType.Tags]:
          tagsResponse.status === "fulfilled" &&
          tagsResponse.value.data.en &&
          typeof tagsResponse.value.data.en === "object" &&
          Object.keys(tagsResponse.value.data.en).length > 0
            ? "ready"
            : "unavailable",
        [FilterType.Developers]:
          developersResponse.status === "fulfilled" &&
          Array.isArray(developersResponse.value.data) &&
          developersResponse.value.data.length > 0
            ? "ready"
            : "unavailable",
        [FilterType.Publishers]:
          publishersResponse.status === "fulfilled" &&
          Array.isArray(publishersResponse.value.data) &&
          publishersResponse.value.data.length > 0
            ? "ready"
            : "unavailable",
        [FilterType.DownloadSourceFingerprints]:
          rawDownloadSources.status === "fulfilled" ? "ready" : "unavailable",
      });
    };

    loadMetadata();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let isRedirectingToAvailablePage = false;
    setIsLoadingSearch(true);

    const timeoutId = globalThis.window.setTimeout(async () => {
      try {
        const payload: CatalogueSearchPayload = {
          title: deferredTitle,
          sortBy: values.sortBy ?? DEFAULT_CATALOGUE_SORT_OPTION.sortBy,
          sortOrder:
            values.sortOrder ?? DEFAULT_CATALOGUE_SORT_OPTION.sortOrder,
          downloadSourceFingerprints: values.downloadSourceFingerprints ?? [],
          tags: values.tags ?? [],
          publishers: values.publishers ?? [],
          genres: values.genres ?? [],
          developers: values.developers ?? [],
          protondbSupportBadges: [],
          deckCompatibility: [],
        };

        const isConsoleOnly = platform === "console";
        const isPcOnly = platform === "pc";
        // Console/classics games (GameHub Vault) merge into the grid on page 1
        // unless the user is in PC-only mode. In console-only mode the classics
        // ARE the results and the PC search is skipped.
        const hasPcOnlyFilters =
          (values.genres?.length ?? 0) > 0 ||
          (values.tags?.length ?? 0) > 0 ||
          (values.publishers?.length ?? 0) > 0 ||
          (values.developers?.length ?? 0) > 0 ||
          (values.downloadSourceFingerprints?.length ?? 0) > 0;
        const wantClassics =
          !isPcOnly &&
          page === 1 &&
          !hasPcOnlyFilters &&
          (isConsoleOnly || Boolean(deferredTitle.trim()));

        const [response, classics] = await Promise.all([
          isConsoleOnly
            ? Promise.resolve<SearchGamesResponseData>({ edges: [], count: 0 })
            : globalThis.window.electron.hydraApi.post<SearchGamesResponseData>(
                "/catalogue/search",
                {
                  data: {
                    ...payload,
                    downloadSourceIds,
                    take: pageSize,
                    skip: (page - 1) * pageSize,
                  },
                  needsAuth: false,
                }
              ),
          wantClassics
            ? globalThis.window.electron
                .searchClassicsCatalogue(
                  deferredTitle,
                  consoleSystem ? 200 : 100,
                  (consoleSystem || undefined) as EmulatorSystem | undefined
                )
                .catch(() => [] as CatalogueSearchResult[])
            : Promise.resolve([] as CatalogueSearchResult[]),
        ]);

        if (cancelled) return;

        const merged: SearchGamesResponseData = isConsoleOnly
          ? { edges: classics, count: classics.length }
          : {
              edges: [...classics, ...response.edges],
              count: response.count + classics.length,
            };

        const lastAvailablePage = Math.max(
          1,
          Math.ceil(merged.count / pageSize)
        );

        if (page > lastAvailablePage) {
          isRedirectingToAvailablePage = true;
          setPage(lastAvailablePage);
          return;
        }

        setSearchData(merged);
        setSearchError(null);
      } catch (error) {
        if (cancelled) return;

        setSearchError(
          error instanceof Error
            ? error
            : new Error("Failed to search catalogue.")
        );
      } finally {
        if (!cancelled && !isRedirectingToAvailablePage) {
          setIsLoadingSearch(false);
        }
      }
    }, 200);

    return () => {
      cancelled = true;
      globalThis.window.clearTimeout(timeoutId);
    };
  }, [
    deferredTitle,
    values.developers,
    values.downloadSourceFingerprints,
    values.genres,
    values.publishers,
    values.sortBy,
    values.sortOrder,
    values.tags,
    downloadSourceIds,
    page,
    pageSize,
    platform,
    consoleSystem,
  ]);

  const downloadSourcesAndFingerprints = useMemo(() => {
    return downloadSources.reduce<Record<string, string>>((acc, source) => {
      acc[source.name] = source.fingerprint!;
      return acc;
    }, {});
  }, [downloadSources]);

  const catalogueData = useMemo<CatalogueData>(() => {
    const visibleResultGenres = Array.from(
      new Set(searchData?.edges.flatMap((game) => game.genres) ?? [])
    ).sort((left, right) => left.localeCompare(right));
    const resolvedGenres =
      steamGenres.length > 0 ? steamGenres : visibleResultGenres;
    const genresStatus =
      metadataStatus[FilterType.Genres] === "unavailable" &&
      visibleResultGenres.length > 0
        ? "partial"
        : metadataStatus[FilterType.Genres];

    return {
      [FilterType.Genres]: {
        data: resolvedGenres,
        label: "Genres",
        color: "magenta",
        status: genresStatus,
      },
      [FilterType.Tags]: {
        data: steamTags,
        label: "Tags",
        color: "yellow",
        status: metadataStatus[FilterType.Tags],
      },
      [FilterType.DownloadSourceFingerprints]: {
        data: downloadSourcesAndFingerprints,
        label: "Download Sources",
        color: "red",
        status: metadataStatus[FilterType.DownloadSourceFingerprints],
      },
      [FilterType.Developers]: {
        data: steamDevelopers,
        label: "Developers",
        color: "cyan",
        status: metadataStatus[FilterType.Developers],
      },
      [FilterType.Publishers]: {
        data: steamPublishers,
        label: "Publishers",
        color: "lime",
        status: metadataStatus[FilterType.Publishers],
      },
    };
  }, [
    downloadSourcesAndFingerprints,
    metadataStatus,
    searchData?.edges,
    steamDevelopers,
    steamGenres,
    steamPublishers,
    steamTags,
  ]);
  const totalPages = Math.ceil((searchData?.count ?? 0) / pageSize);
  const catalogueMetadataState = Object.values(metadataStatus).some(
    (status) => status === "loading"
  )
    ? "loading"
    : Object.values(metadataStatus).some((status) => status === "unavailable")
      ? "unavailable"
      : "ready";

  const changePage = useCallback((nextPage: number) => {
    setIsLoadingSearch(true);
    setPage(nextPage);
  }, []);

  return {
    page,
    pageSize,
    totalPages,
    changePage,
    values,
    updateSearchParams,
    catalogueData,
    catalogueMetadataState,
    platform,
    consoleSystem,
    setPlatform,
    setConsoleSystem,
    search: {
      data: searchData,
      isLoading: isLoadingSearch,
      isError: Boolean(searchError),
      error: searchError,
      isEmpty: !searchData || searchData.edges.length === 0,
    },
  };
}
