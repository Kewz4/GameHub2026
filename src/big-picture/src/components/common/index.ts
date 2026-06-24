export * from "./accordion";
export * from "./animated-hero-image";
export * from "./backdrop";
export * from "./button";
export * from "./checkbox";
export * from "./challenge-game-card";
export * from "./chip";
export * from "./divider";
export * from "./game-card";
export * from "./horizontal-card";
export * from "./horizontal-library-game-card";
export * from "./horizontal-store-game-card";
export * from "./image-lightbox";
export * from "./input";
export * from "./list-card";
export * from "./modal";
export * from "./radio";
export * from "./route-anchor";
export * from "./scroll-area";
export * from "./skeleton";
export * from "./source-anchor";
export * from "./tabs";
export * from "./tooltip";
export * from "./typography";
export * from "./user-disk-item";
export * from "./user-profile";
export * from "./vertical-game-card";
export * from "./vertical-store-game-card";
export * from "./horizontal-focus-group";
export * from "./vertical-focus-group";
export * from "./grid-focus-group";
export * from "./navigation-layer";
export * from "./focus-item";
export * from "./diagnostics";
export * from "./dropdown-select";
export * from "./download-source-card";
export * from "./context-menu";
export * from "./scroll-area";
export * from "./route-anchor";
export * from "./button";
export * from "./input";
export * from "./typography";
export * from "./divider";
export * from "./user-profile";
export * from "./box";
export * from "./focus-carousel";
export * from "./navigation-history-bridge";
export * from "./toast";
export * from "./virtual-keyboard";

/* ── Stubs added for game-settings-modal compatibility ──────────────────── */
import type { ReactNode } from "react";

export interface SidebarModalTab<TId extends string = string> {
  id: TId;
  label: string;
  content?: ReactNode;
  primaryControlId?: string;
}

interface SidebarModalProps {
  tabs: SidebarModalTab<string>[];
  activeTabId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onActiveTabChange?: (id: any) => void;
  selectedTabId?: string;
  onTabChange?: (id: string) => void;
  children?: ReactNode;
  className?: string;
  visible?: boolean;
  onClose?: () => void;
  title?: string;
  coverImage?: string;
  ariaLabel?: string;
  contentEntryFocusId?: string;
}

export function SidebarModal(_props: Readonly<SidebarModalProps>): null {
  return null;
}

interface EmptyStateProps {
  children?: ReactNode;
  className?: string;
  icon?: ReactNode;
  title?: string;
  description?: string;
}

export function EmptyState(_props: Readonly<EmptyStateProps>): null {
  return null;
}
