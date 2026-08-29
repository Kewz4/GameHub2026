import type { GameCollection } from "@types";

import { BIG_PICTURE_APP_LAYER_ID } from "../../layout/navigation";
import type { LibraryFilterTab } from "../../components";

const BUILTIN_LIBRARY_TAB_ORDER: LibraryFilterTab[] = [
  "all",
  "favorites",
  "completed",
];
const TITLE_COMPARE_OPTIONS = { sensitivity: "base" } as const;

export function canHandleLibraryBumperInput(
  activeLayerId: string | null,
  virtualKeyboardOpen: boolean
) {
  return activeLayerId === BIG_PICTURE_APP_LAYER_ID && !virtualKeyboardOpen;
}

export function getLibraryTabOrder(
  collections: ReadonlyArray<Pick<GameCollection, "id" | "name">>
): LibraryFilterTab[] {
  const collectionIds = [...collections]
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, TITLE_COMPARE_OPTIONS)
    )
    .map((collection) => collection.id);

  return [...BUILTIN_LIBRARY_TAB_ORDER, ...collectionIds];
}

export function getAdjacentLibraryTab(
  tabOrder: readonly LibraryFilterTab[],
  currentTab: LibraryFilterTab,
  direction: -1 | 1
): LibraryFilterTab | null {
  const currentIndex = tabOrder.indexOf(currentTab);
  if (currentIndex < 0) return tabOrder[0] ?? null;

  return tabOrder[currentIndex + direction] ?? null;
}
