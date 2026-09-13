export type UserDiskUsageState = "loading" | "ready" | "unavailable";

export interface UserDiskUsagePresentation {
  safeFreeBytes: number;
  safeTotalBytes: number;
  usedRatio: number;
  statusText: string | null;
  statusRole: "status" | "alert" | null;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const getUserDiskUsagePresentation = (
  usageState: UserDiskUsageState,
  freeBytes: number,
  totalBytes: number
): UserDiskUsagePresentation => {
  const safeFreeBytes = Math.max(freeBytes, 0);
  const safeTotalBytes = Math.max(totalBytes, 0);
  const usedBytes = Math.max(safeTotalBytes - safeFreeBytes, 0);

  if (usageState === "loading") {
    return {
      safeFreeBytes,
      safeTotalBytes,
      usedRatio: 0,
      statusText: "Checking available storage…",
      statusRole: "status",
    };
  }

  if (usageState === "unavailable") {
    return {
      safeFreeBytes,
      safeTotalBytes,
      usedRatio: 0,
      statusText: "Storage information unavailable",
      statusRole: "alert",
    };
  }

  return {
    safeFreeBytes,
    safeTotalBytes,
    usedRatio: safeTotalBytes > 0 ? clamp(usedBytes / safeTotalBytes, 0, 1) : 0,
    statusText: null,
    statusRole: null,
  };
};
