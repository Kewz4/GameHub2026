import type { FocusOverrideTarget, FocusOverrides } from "../../services";

const itemTarget = (itemId: string): FocusOverrideTarget => ({
  type: "item",
  itemId,
});

/**
 * Builds one explicit vertical focus chain for the sidebar routes, Exit, and
 * the current library entries. The chain wraps at both ends so controller
 * navigation never depends on DOM geometry or a portal's screen position.
 */
export function buildSidebarNavigationOverrides(
  itemIds: readonly string[],
  contentTarget: FocusOverrideTarget
): ReadonlyMap<string, FocusOverrides> {
  const overrides = new Map<string, FocusOverrides>();

  if (itemIds.length === 0) return overrides;

  itemIds.forEach((itemId, index) => {
    const previousId = itemIds[(index - 1 + itemIds.length) % itemIds.length];
    const nextId = itemIds[(index + 1) % itemIds.length];

    overrides.set(itemId, {
      left: { type: "block" },
      right: contentTarget,
      up: itemTarget(previousId),
      down: itemTarget(nextId),
    });
  });

  return overrides;
}
