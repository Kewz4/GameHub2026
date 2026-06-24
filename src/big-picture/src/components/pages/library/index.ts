export * from "./hero/hero";
export * from "./grid/focus-grid";
export * from "./list/focus-list";
export * from "./game-card";
export * from "./game-context-menu";
export * from "./game-context-menu-items";
export * from "./filters/filters";
export * from "./library-data";
export * from "./use-library-favorite";
export * from "./use-library-launch-game";
export * from "./use-library-page-data";
export * from "./game-settings-modal";

export function useLibraryPendingAction(_opts?: unknown) {
  return {
    pendingAction: null as null | { type: string; game: { title: string } },
    isSubmittingAction: false,
    requestRemoveFiles: (_game: unknown) => {},
    requestRemoveFromLibrary: (_game: unknown) => {},
    closePendingAction: () => {},
    confirmPendingAction: () => Promise.resolve(),
    setPendingAction: (_action: unknown) => {},
  };
}
