import type { EmulatorSystem } from "@types";

import {
  getLibraryFiltersConsolePillId,
  LIBRARY_FILTERS_CONSOLE_ALL_PILL_ID,
} from "./navigation";

export interface LibraryConsoleDirectionalTargets {
  left: string;
  right: string | null;
  up: string;
  down: string;
}

export function getLibraryConsoleFocusOrder(
  systems: readonly EmulatorSystem[]
) {
  return [
    LIBRARY_FILTERS_CONSOLE_ALL_PILL_ID,
    ...systems.map(getLibraryFiltersConsolePillId),
  ];
}

export function getSelectedLibraryConsoleFocusId(
  selectedSystem: EmulatorSystem | null,
  availableSystems: readonly EmulatorSystem[]
) {
  return selectedSystem && availableSystems.includes(selectedSystem)
    ? getLibraryFiltersConsolePillId(selectedSystem)
    : LIBRARY_FILTERS_CONSOLE_ALL_PILL_ID;
}

export function getLibraryConsoleDirectionalTargets(
  focusOrder: readonly string[],
  index: number,
  parentFocusId: string,
  selectedTabFocusId: string
): LibraryConsoleDirectionalTargets {
  return {
    left: index <= 0 ? parentFocusId : focusOrder[index - 1]!,
    right: index >= focusOrder.length - 1 ? null : focusOrder[index + 1]!,
    up: parentFocusId,
    down: selectedTabFocusId,
  };
}
