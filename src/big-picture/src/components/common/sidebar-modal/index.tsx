import "./styles.scss";

import cn from "classnames";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { FocusOverrides } from "../../../services";
import { useNavigationIsFocused } from "../../../stores";
import { Button } from "../button";
import { HorizontalFocusGroup } from "../horizontal-focus-group";
import { Modal } from "../modal";
import { VerticalFocusGroup } from "../vertical-focus-group";
import {
  normalizeSidebarModalIdSegment,
  resolveSidebarModalActiveTab,
} from "./sidebar-modal-state";

export interface SidebarModalTab<TabId extends string = string> {
  id: TabId;
  label: ReactNode;
  content?: ReactNode;
  primaryControlId?: string;
  disabled?: boolean;
}

export interface SidebarModalProps<TabId extends string = string> {
  tabs: SidebarModalTab<TabId>[];
  activeTabId?: TabId;
  defaultActiveTabId?: TabId;
  onActiveTabChange?: (id: TabId) => void;
  /** Compatibility aliases used by older settings screens. */
  selectedTabId?: TabId;
  onTabChange?: (id: TabId) => void;
  children?: ReactNode;
  className?: string;
  visible?: boolean;
  onClose?: () => void;
  title?: string;
  coverImage?: string;
  ariaLabel?: string;
  contentEntryFocusId?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  closeOnB?: boolean;
}

function SidebarModalTabButton<TabId extends string>({
  tab,
  focusId,
  panelId,
  active,
  onActivate,
}: Readonly<{
  tab: SidebarModalTab<TabId>;
  focusId: string;
  panelId: string;
  active: boolean;
  onActivate: (id: TabId) => void;
}>) {
  const focused = useNavigationIsFocused(focusId);
  const activate = useCallback(() => {
    if (!tab.disabled) onActivate(tab.id);
  }, [onActivate, tab.disabled, tab.id]);

  useEffect(() => {
    if (focused && !active) activate();
  }, [activate, active, focused]);

  return (
    <Button
      type="button"
      focusId={focusId}
      variant="tertiary"
      className="sidebar-modal__tab"
      disabled={tab.disabled}
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      data-sidebar-tab-id={tab.id}
      data-active={active || undefined}
      onClick={activate}
    >
      {tab.label}
    </Button>
  );
}

export function SidebarModal<TabId extends string = string>({
  tabs,
  activeTabId,
  defaultActiveTabId,
  onActiveTabChange,
  selectedTabId,
  onTabChange,
  children,
  className,
  visible = false,
  onClose = () => undefined,
  title = "",
  coverImage,
  ariaLabel,
  contentEntryFocusId,
  closeOnBackdrop = true,
  closeOnEscape = true,
  closeOnB = true,
}: Readonly<SidebarModalProps<TabId>>) {
  const generatedId = useId().replaceAll(":", "");
  const modalId = `sidebar-modal-${generatedId}`;
  const tabsRegionId = `${modalId}-tabs`;
  const contentRegionId = `${modalId}-content`;
  const layoutRegionId = `${modalId}-layout`;
  const controlledTabId = activeTabId ?? selectedTabId;
  const [internalTabId, setInternalTabId] = useState<TabId | "">(
    () =>
      defaultActiveTabId ??
      controlledTabId ??
      resolveSidebarModalActiveTab(tabs)?.id ??
      ""
  );
  const requestedTabId = controlledTabId ?? internalTabId;
  const activeTab = useMemo(
    () => resolveSidebarModalActiveTab(tabs, requestedTabId),
    [requestedTabId, tabs]
  );
  const getTabFocusId = useCallback(
    (tabId: string) =>
      `${modalId}-tab-${normalizeSidebarModalIdSegment(tabId || "untitled")}`,
    [modalId]
  );
  const getPanelId = useCallback(
    (tabId: string) =>
      `${modalId}-panel-${normalizeSidebarModalIdSegment(tabId || "untitled")}`,
    [modalId]
  );
  const activeTabFocusId = activeTab ? getTabFocusId(activeTab.id) : undefined;
  const activePanelId = activeTab
    ? getPanelId(activeTab.id)
    : `${modalId}-panel`;
  const resolvedContentEntryFocusId =
    activeTab?.primaryControlId ?? contentEntryFocusId;

  const notifyTabChange = useCallback(
    (tabId: TabId) => {
      onActiveTabChange?.(tabId);

      if (onTabChange !== onActiveTabChange) {
        onTabChange?.(tabId);
      }
    },
    [onActiveTabChange, onTabChange]
  );

  const setActiveTab = useCallback(
    (tabId: TabId) => {
      const nextTab = tabs.find((tab) => tab.id === tabId && !tab.disabled);

      if (!nextTab) return;

      if (controlledTabId === undefined) {
        setInternalTabId(tabId);
      }

      if (tabId !== requestedTabId) {
        notifyTabChange(tabId);
      }
    },
    [controlledTabId, notifyTabChange, requestedTabId, tabs]
  );

  useEffect(() => {
    if (!visible || !activeTab || activeTab.id === requestedTabId) return;

    if (controlledTabId === undefined) {
      setInternalTabId(activeTab.id);
    }

    notifyTabChange(activeTab.id);
  }, [activeTab, controlledTabId, notifyTabChange, requestedTabId, visible]);

  const tabsNavigationOverrides = useMemo<FocusOverrides>(
    () => ({
      right: activeTab
        ? resolvedContentEntryFocusId
          ? { type: "item", itemId: resolvedContentEntryFocusId }
          : {
              type: "region",
              regionId: contentRegionId,
              entryDirection: "right",
              preferRememberedFocus: true,
            }
        : { type: "block" },
    }),
    [activeTab, contentRegionId, resolvedContentEntryFocusId]
  );
  const contentNavigationOverrides = useMemo<FocusOverrides>(
    () => ({
      left: activeTabFocusId
        ? { type: "item", itemId: activeTabFocusId }
        : { type: "block" },
    }),
    [activeTabFocusId]
  );

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={title}
      coverImage={coverImage}
      ariaLabel={ariaLabel ?? title}
      className={cn("sidebar-modal", className)}
      closeOnBackdrop={closeOnBackdrop}
      closeOnEscape={closeOnEscape}
      closeOnB={closeOnB}
      initialFocusId={activeTabFocusId}
    >
      <HorizontalFocusGroup regionId={layoutRegionId} asChild>
        <div
          className="sidebar-modal__layout"
          data-sidebar-modal
          data-active-sidebar-tab={activeTab?.id}
        >
          <aside className="sidebar-modal__sidebar">
            <VerticalFocusGroup
              regionId={tabsRegionId}
              className="sidebar-modal__tabs"
              style={{ gap: 0 }}
              navigationOverrides={tabsNavigationOverrides}
              role="tablist"
              aria-label={`${ariaLabel ?? title} sections`}
            >
              {tabs.map((tab) => (
                <SidebarModalTabButton
                  key={tab.id}
                  tab={tab}
                  focusId={getTabFocusId(tab.id)}
                  panelId={getPanelId(tab.id)}
                  active={tab.id === activeTab?.id}
                  onActivate={setActiveTab}
                />
              ))}
            </VerticalFocusGroup>
          </aside>

          <VerticalFocusGroup
            regionId={contentRegionId}
            className="sidebar-modal__content"
            navigationOverrides={contentNavigationOverrides}
            role="tabpanel"
            id={activePanelId}
            aria-labelledby={activeTabFocusId}
            data-sidebar-panel-id={activeTab?.id}
          >
            {activeTab?.content ?? children}
          </VerticalFocusGroup>
        </div>
      </HorizontalFocusGroup>
    </Modal>
  );
}

export {
  normalizeSidebarModalIdSegment,
  resolveSidebarModalActiveTab,
} from "./sidebar-modal-state";
