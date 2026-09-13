export interface SidebarModalTabState<TabId extends string = string> {
  id: TabId;
  disabled?: boolean;
}

export function normalizeSidebarModalIdSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function resolveSidebarModalActiveTab<
  Tab extends SidebarModalTabState<string>,
>(tabs: readonly Tab[], requestedTabId?: string) {
  if (requestedTabId) {
    const requestedTab = tabs.find(
      (tab) => tab.id === requestedTabId && !tab.disabled
    );

    if (requestedTab) return requestedTab;
  }

  return tabs.find((tab) => !tab.disabled) ?? null;
}
