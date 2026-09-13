import type { ReactNode } from "react";

interface SettingsTabRailLayoutProps {
  beforeTabs?: ReactNode;
  afterTabs?: ReactNode;
  children: ReactNode;
}

/**
 * Keeps bumper hints outside the horizontally scrolling tab viewport. This is
 * deliberately a structural component: the controls cannot be scrolled away
 * when a later Settings category is selected.
 */
export function SettingsTabRailLayout({
  beforeTabs,
  afterTabs,
  children,
}: Readonly<SettingsTabRailLayoutProps>) {
  return (
    <div className="tabs__settings-rail" data-tabs-settings-rail>
      {beforeTabs && (
        <div className="tabs__before-tabs" data-tabs-rail-control="before">
          {beforeTabs}
        </div>
      )}

      {children}

      {afterTabs && (
        <div className="tabs__after-tabs" data-tabs-rail-control="after">
          {afterTabs}
        </div>
      )}
    </div>
  );
}
