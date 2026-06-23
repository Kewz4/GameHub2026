import "./filters.scss";

import type { GameCollection, LibraryGame } from "@types";
import { useMemo } from "react";
import { logger } from "@renderer/logger";

import {
  Button,
  Divider,
  DropdownSelect,
  type DropdownSelectOption,
  FocusItem,
  HorizontalFocusGroup,
  Input,
  Tabs,
  type TabsItem,
} from "../../../common";
import {
  FunnelIcon,
  ListDashesIcon,
  MagnifyingGlassIcon,
  MagnifyingGlassPlusIcon,
  PlusIcon,
  SortAscendingIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import type { FocusOverrides } from "../../../../services";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../../../layout";
import {
  getLibraryFiltersPlatformPillId,
  getLibraryFiltersTabFocusId,
  LIBRARY_FILTERS_FILTER_SELECT_ID,
  LIBRARY_FILTERS_GRID_VIEW_BUTTON_ID,
  LIBRARY_FILTERS_LIST_VIEW_BUTTON_ID,
  LIBRARY_FILTERS_NEW_FOLDER_BUTTON_ID,
  LIBRARY_FILTERS_SCAN_BUTTON_ID,
  LIBRARY_FILTERS_SEARCH_INPUT_ID,
  LIBRARY_FILTERS_SORT_SELECT_ID,
  LIBRARY_FILTERS_TABS_REGION_ID,
  LIBRARY_FILTERS_TOOLBAR_REGION_ID,
  LIBRARY_HERO_ACTIONS_REGION_ID,
} from "../navigation";
import {
  countGamesInCollection,
  type LibraryFilterCounts,
  type LibraryFilterTab,
  type LibrarySecondaryFilter,
  type LibrarySortOption,
  type LibraryViewMode,
} from "../library-data";

const SORT_OPTIONS = [
  { value: "last_played", label: "Last Played" },
  { value: "playtime", label: "Most Played" },
  { value: "title_asc", label: "Alphabetical (A-Z)" },
  { value: "title_desc", label: "Alphabetical (Z-A)" },
  { value: "added_desc", label: "Newest Added" },
  { value: "added_asc", label: "Oldest Added" },
] satisfies Array<DropdownSelectOption<LibrarySortOption>>;

// Install-state filters live in the dropdown; platform filters are surfaced as
// quick-toggle pills next to the filter button for a friendlier UX.
const FILTER_OPTIONS = [
  { value: "all_games", label: "All Games" },
  { value: "installed", label: "Installed" },
  { value: "not_installed", label: "Not Installed" },
  { value: "never_played", label: "Never Played" },
] satisfies Array<DropdownSelectOption<LibrarySecondaryFilter>>;

const PLATFORM_PILLS = [
  { value: "steam", label: "Steam" },
  { value: "epic", label: "Epic" },
  { value: "gog", label: "GOG" },
  { value: "xbox", label: "Xbox" },
] satisfies Array<{ value: LibrarySecondaryFilter; label: string }>;

const PLATFORM_FILTER_VALUES = new Set<LibrarySecondaryFilter>(
  PLATFORM_PILLS.map((pill) => pill.value)
);

const TITLE_COMPARE_COLLECTIONS = { sensitivity: "base" } as const;

const SIDEBAR_LIBRARY_OVERRIDE = {
  type: "item" as const,
  itemId: BIG_PICTURE_SIDEBAR_ITEM_IDS.library,
};

const TAB_UP_FROM_TOOLBAR_OVERRIDE = {
  type: "region" as const,
  regionId: LIBRARY_FILTERS_TOOLBAR_REGION_ID,
  entryDirection: "up" as const,
};

export interface LibraryFiltersProps {
  selectedTab: LibraryFilterTab;
  onSelectedTabChange: (tab: LibraryFilterTab) => void;
  viewMode: LibraryViewMode;
  onViewModeChange: (viewMode: LibraryViewMode) => void;
  sortBy: LibrarySortOption;
  onSortByChange: (sortBy: LibrarySortOption) => void;
  filterBy: LibrarySecondaryFilter;
  onFilterByChange: (filterBy: LibrarySecondaryFilter) => void;
  search: string;
  onSearchChange: (search: string) => void;
  counts: LibraryFilterCounts;
  library: LibraryGame[];
  collections: GameCollection[];
  firstContentItemId?: string | null;
  onScanGames?: () => void;
}

export function LibraryFilters({
  selectedTab,
  onSelectedTabChange,
  viewMode,
  onViewModeChange,
  sortBy,
  onSortByChange,
  filterBy,
  onFilterByChange,
  search,
  onSearchChange,
  counts,
  library,
  collections,
  firstContentItemId = null,
  onScanGames,
}: Readonly<LibraryFiltersProps>) {
  const tabDownOverride = useMemo(
    () =>
      firstContentItemId
        ? {
            type: "item" as const,
            itemId: firstContentItemId,
          }
        : {
            type: "block" as const,
          },
    [firstContentItemId]
  );

  const { tabItems, lastTabFocusId } = useMemo(() => {
    const sortedCollections = [...collections].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, TITLE_COMPARE_COLLECTIONS)
    );

    const builtins: Array<{
      id: string;
      value: LibraryFilterTab;
      label: string;
    }> = [
      {
        id: getLibraryFiltersTabFocusId("all"),
        value: "all",
        label: `All (${counts.all})`,
      },
      {
        id: getLibraryFiltersTabFocusId("favorites"),
        value: "favorites",
        label: `Favorites (${counts.favorites})`,
      },
      {
        id: getLibraryFiltersTabFocusId("completed"),
        value: "completed",
        label: `Completed (${counts.completed})`,
      },
    ];

    const collectionSpecs = sortedCollections.map((collection) => ({
      id: getLibraryFiltersTabFocusId(collection.id),
      value: collection.id,
      label: `${collection.name} (${countGamesInCollection(library, collection.id)})`,
    }));

    const row = [...builtins, ...collectionSpecs];
    const lastTabFocusId = row[row.length - 1]!.id;

    const tabItemsLocal = row.map((spec, index) => ({
      ...spec,
      navigationOverrides: {
        left:
          index === 0
            ? SIDEBAR_LIBRARY_OVERRIDE
            : {
                type: "item" as const,
                itemId: row[index - 1]!.id,
              },
        right:
          index === row.length - 1
            ? {
                type: "item" as const,
                itemId: LIBRARY_FILTERS_NEW_FOLDER_BUTTON_ID,
              }
            : {
                type: "item" as const,
                itemId: row[index + 1]!.id,
              },
        up: TAB_UP_FROM_TOOLBAR_OVERRIDE,
        down: tabDownOverride,
      },
    })) satisfies Array<TabsItem<LibraryFilterTab>>;

    return { tabItems: tabItemsLocal, lastTabFocusId };
  }, [collections, counts, library, tabDownOverride]);

  const newFolderNavigationOverrides = useMemo(
    (): FocusOverrides => ({
      left: {
        type: "item",
        itemId: lastTabFocusId,
      },
      right: { type: "block" },
      up: TAB_UP_FROM_TOOLBAR_OVERRIDE,
      down: tabDownOverride,
    }),
    [lastTabFocusId, tabDownOverride]
  );

  const selectedTabFocusId = useMemo(() => {
    return getLibraryFiltersTabFocusId(String(selectedTab));
  }, [selectedTab]);

  const toolbarNavigationOverrides: FocusOverrides = useMemo(() => {
    return {
      up: {
        type: "region",
        regionId: LIBRARY_HERO_ACTIONS_REGION_ID,
        entryDirection: "up",
      },
      down: {
        type: "item",
        itemId: selectedTabFocusId,
      },
    };
  }, [selectedTabFocusId]);

  const toolbarUpOverride = {
    type: "region",
    regionId: LIBRARY_HERO_ACTIONS_REGION_ID,
    entryDirection: "up",
  } as const;
  const toolbarDownOverride = {
    type: "item",
    itemId: selectedTabFocusId,
  } as const;
  const searchNavigationOverrides: FocusOverrides = {
    left: SIDEBAR_LIBRARY_OVERRIDE,
    right: {
      type: "item",
      itemId: LIBRARY_FILTERS_SORT_SELECT_ID,
    },
    up: toolbarUpOverride,
    down: toolbarDownOverride,
  };
  const sortNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: LIBRARY_FILTERS_SEARCH_INPUT_ID,
    },
    right: {
      type: "item",
      itemId: LIBRARY_FILTERS_FILTER_SELECT_ID,
    },
    up: toolbarUpOverride,
    down: toolbarDownOverride,
  };
  const firstPlatformPillId = getLibraryFiltersPlatformPillId(
    PLATFORM_PILLS[0].value
  );
  const lastPlatformPillId = getLibraryFiltersPlatformPillId(
    PLATFORM_PILLS[PLATFORM_PILLS.length - 1].value
  );
  // The dropdown only tracks install-state filters; when a platform pill is the
  // active filter the dropdown falls back to showing "All Games".
  const statusFilterValue: LibrarySecondaryFilter = PLATFORM_FILTER_VALUES.has(
    filterBy
  )
    ? "all_games"
    : filterBy;

  const platformPillOverrides = useMemo(
    () =>
      PLATFORM_PILLS.map((pill, index) => ({
        ...pill,
        focusId: getLibraryFiltersPlatformPillId(pill.value),
        navigationOverrides: {
          left:
            index === 0
              ? { type: "item" as const, itemId: LIBRARY_FILTERS_FILTER_SELECT_ID }
              : {
                  type: "item" as const,
                  itemId: getLibraryFiltersPlatformPillId(
                    PLATFORM_PILLS[index - 1].value
                  ),
                },
          right:
            index === PLATFORM_PILLS.length - 1
              ? {
                  type: "item" as const,
                  itemId: onScanGames
                    ? LIBRARY_FILTERS_SCAN_BUTTON_ID
                    : LIBRARY_FILTERS_LIST_VIEW_BUTTON_ID,
                }
              : {
                  type: "item" as const,
                  itemId: getLibraryFiltersPlatformPillId(
                    PLATFORM_PILLS[index + 1].value
                  ),
                },
          up: toolbarUpOverride,
          down: toolbarDownOverride,
        } satisfies FocusOverrides,
      })),
    [onScanGames, toolbarUpOverride, toolbarDownOverride]
  );

  const filterNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: LIBRARY_FILTERS_SORT_SELECT_ID,
    },
    right: {
      type: "item",
      itemId: firstPlatformPillId,
    },
    up: toolbarUpOverride,
    down: toolbarDownOverride,
  };
  const listViewNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: onScanGames
        ? LIBRARY_FILTERS_SCAN_BUTTON_ID
        : lastPlatformPillId,
    },
    right: {
      type: "item",
      itemId: LIBRARY_FILTERS_GRID_VIEW_BUTTON_ID,
    },
    up: toolbarUpOverride,
    down: toolbarDownOverride,
  };

  const handlePlatformPillClick = (value: LibrarySecondaryFilter) => {
    // Toggle: clicking the active platform clears back to "All Games".
    onFilterByChange(filterBy === value ? "all_games" : value);
  };
  const gridViewNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: LIBRARY_FILTERS_LIST_VIEW_BUTTON_ID,
    },
    right: {
      type: "block",
    },
    up: toolbarUpOverride,
    down: toolbarDownOverride,
  };
  const tabsNavigationOverrides: FocusOverrides = {
    up: TAB_UP_FROM_TOOLBAR_OVERRIDE,
    down: tabDownOverride,
  };

  return (
    <div className="library-filters">
      <div className="library-filters__header">
        <h2 className="library-filters__title">Your Library</h2>
      </div>

      <HorizontalFocusGroup
        className="library-filters__toolbar"
        regionId={LIBRARY_FILTERS_TOOLBAR_REGION_ID}
        navigationOverrides={toolbarNavigationOverrides}
      >
        <div className="library-filters__search-and-filters">
          <div className="library-filters__search">
            <Input
              focusId={LIBRARY_FILTERS_SEARCH_INPUT_ID}
              focusNavigationOverrides={searchNavigationOverrides}
              type="text"
              placeholder="Search library"
              iconLeft={<MagnifyingGlassIcon size={24} />}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>

          <div className="library-filters__toolbar-divider" aria-hidden="true">
            <Divider orientation="vertical" color="var(--text-secondary)" />
          </div>

          <DropdownSelect
            className="library-filters__select"
            hideLabel
            leadingIcon={<SortAscendingIcon size={22} />}
            ariaLabel="Sort library by"
            focusId={LIBRARY_FILTERS_SORT_SELECT_ID}
            focusNavigationOverrides={sortNavigationOverrides}
            value={sortBy}
            options={SORT_OPTIONS}
            onValueChange={onSortByChange}
          />

          <DropdownSelect
            className="library-filters__select"
            hideLabel
            leadingIcon={<FunnelIcon size={20} />}
            ariaLabel="Filter library games"
            focusId={LIBRARY_FILTERS_FILTER_SELECT_ID}
            focusNavigationOverrides={filterNavigationOverrides}
            value={statusFilterValue}
            options={FILTER_OPTIONS}
            onValueChange={onFilterByChange}
          />

          <div className="library-filters__platform-pills">
            {platformPillOverrides.map((pill) => {
              const active = filterBy === pill.value;
              return (
                <Button
                  key={pill.value}
                  focusId={pill.focusId}
                  focusNavigationOverrides={pill.navigationOverrides}
                  className="library-filters__platform-pill"
                  variant={active ? "primary" : "secondary"}
                  size="small"
                  aria-pressed={active}
                  onClick={() => handlePlatformPillClick(pill.value)}
                >
                  {pill.label}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="library-filters__view-actions">
          {onScanGames && (
            <Button
              focusId={LIBRARY_FILTERS_SCAN_BUTTON_ID}
              focusNavigationOverrides={{
                left: { type: "item", itemId: lastPlatformPillId },
                right: { type: "item", itemId: LIBRARY_FILTERS_LIST_VIEW_BUTTON_ID },
                up: toolbarUpOverride,
                down: toolbarDownOverride,
              }}
              className="library-filters__view-button"
              variant="secondary"
              size="icon"
              aria-label="Scan for games"
              onClick={onScanGames}
            >
              <MagnifyingGlassPlusIcon
                className="library-filters__view-icon"
                size={22}
              />
            </Button>
          )}
          <Button
            focusId={LIBRARY_FILTERS_LIST_VIEW_BUTTON_ID}
            focusNavigationOverrides={listViewNavigationOverrides}
            className="library-filters__view-button library-filters__view-button--list"
            variant={viewMode === "list" ? "primary" : "secondary"}
            size="icon"
            aria-label="List view"
            aria-pressed={viewMode === "list"}
            onClick={() => onViewModeChange("list")}
          >
            <ListDashesIcon
              className="library-filters__view-icon library-filters__view-icon--list"
              size={24}
            />
          </Button>

          <Button
            focusId={LIBRARY_FILTERS_GRID_VIEW_BUTTON_ID}
            focusNavigationOverrides={gridViewNavigationOverrides}
            className="library-filters__view-button library-filters__view-button--grid"
            variant={viewMode === "grid" ? "primary" : "secondary"}
            size="icon"
            aria-label="Grid view"
            aria-pressed={viewMode === "grid"}
            onClick={() => onViewModeChange("grid")}
          >
            <SquaresFourIcon
              className="library-filters__view-icon library-filters__view-icon--grid"
              size={24}
            />
          </Button>
        </div>
      </HorizontalFocusGroup>

      <div className="library-filters__tabs">
        <Tabs
          className="library-filters-tabs"
          items={tabItems}
          value={selectedTab}
          onValueChange={onSelectedTabChange}
          regionId={LIBRARY_FILTERS_TABS_REGION_ID}
          navigationOverrides={tabsNavigationOverrides}
          ariaLabel="Library filters"
          afterTabs={
            <FocusItem
              id={LIBRARY_FILTERS_NEW_FOLDER_BUTTON_ID}
              asChild
              navigationOverrides={newFolderNavigationOverrides}
            >
              <button
                type="button"
                className="tabs__tab"
                aria-label="New Folder"
                onClick={() => {
                  logger.log("library new folder clicked");
                }}
              >
                <span className="tabs__tab-label tabs__tab-label--with-icon">
                  <PlusIcon
                    className="tabs__tab-icon"
                    size={16}
                    aria-hidden="true"
                  />
                  <span>New Folder</span>
                </span>
              </button>
            </FocusItem>
          }
        />
      </div>
    </div>
  );
}
