export const DOWNLOAD_MANAGER_TABS = ["downloads", "custom"] as const;

export type DownloadManagerTab = (typeof DOWNLOAD_MANAGER_TABS)[number];

export function getAdjacentDownloadManagerTab(
  current: DownloadManagerTab,
  direction: "ArrowLeft" | "ArrowRight"
): DownloadManagerTab {
  const currentIndex = DOWNLOAD_MANAGER_TABS.indexOf(current);
  const offset = direction === "ArrowRight" ? 1 : -1;
  return DOWNLOAD_MANAGER_TABS[
    (currentIndex + offset + DOWNLOAD_MANAGER_TABS.length) %
      DOWNLOAD_MANAGER_TABS.length
  ];
}
