import type {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
} from "@types";

const ICON_DECODE_TIMEOUT_MS = 3_000;

export type AchievementIconPreloader = (url: string) => Promise<boolean>;

export type PositionedAchievementNotification = {
  achievement: AchievementNotificationInfo;
  position: AchievementCustomNotificationPosition;
};

export const positionAchievementNotifications = (
  achievements: AchievementNotificationInfo[],
  position: AchievementCustomNotificationPosition
): PositionedAchievementNotification[] =>
  achievements.map((achievement) => ({ achievement, position }));

export const preloadAchievementIcon: AchievementIconPreloader = (url) =>
  new Promise<boolean>((resolve) => {
    if (!url) {
      resolve(false);
      return;
    }
    const image = new Image();
    let settled = false;
    let timeout = 0;
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(loaded);
    };
    const decodeLoadedImage = async () => {
      if (image.naturalWidth <= 0) {
        finish(false);
        return;
      }
      try {
        await image.decode?.();
        finish(true);
      } catch {
        // A loaded-but-undecodable remote badge is not first-paint safe. Use
        // the bundled fallback rather than mounting a box Chromium may flash.
        finish(false);
      }
    };
    timeout = window.setTimeout(() => finish(false), ICON_DECODE_TIMEOUT_MS);
    image.decoding = "async";
    image.onload = () => void decodeLoadedImage();
    image.onerror = () => finish(false);
    image.src = url;
    // Cached images may be complete before `onload` can run. They still go
    // through decode, so the fast path has the same first-paint guarantee.
    if (image.complete) void decodeLoadedImage();
  });

/**
 * Decode every badge before mounting the notification. The transparent host
 * window may already be shown, but it contains no card until this resolves, so
 * Chromium never paints a blank/white image placeholder before the badge.
 */
export const prepareAchievementNotificationIcons = async (
  achievements: AchievementNotificationInfo[],
  fallbackUrl: string,
  preload: AchievementIconPreloader = preloadAchievementIcon
) =>
  Promise.all(
    achievements.map(async (achievement) => {
      const iconUrl = achievement.iconUrl?.trim();
      let iconReady = false;
      try {
        iconReady = Boolean(iconUrl) && (await preload(iconUrl));
      } catch {
        iconReady = false;
      }
      if (iconReady) return achievement;
      await preload(fallbackUrl).catch(() => false);
      return { ...achievement, iconUrl: fallbackUrl };
    })
  );

export type AchievementNotificationIconQueue = {
  enqueue: (
    achievements: AchievementNotificationInfo[]
  ) => Promise<AchievementNotificationInfo[] | null>;
  dispose: () => void;
};

/**
 * Unlock events can arrive while a previous badge is decoding. Serialising the
 * batches preserves event order (A then B) even if B is cached and would decode
 * first, and disposal prevents a late decode from mounting after unmount.
 */
export const createAchievementNotificationIconQueue = (
  fallbackUrl: string,
  preload: AchievementIconPreloader = preloadAchievementIcon
): AchievementNotificationIconQueue => {
  let disposed = false;
  let tail = Promise.resolve<void>(undefined);

  return {
    enqueue(achievements) {
      const prepared = tail.then(async () => {
        if (disposed) return null;
        const batch = await prepareAchievementNotificationIcons(
          achievements,
          fallbackUrl,
          preload
        );
        return disposed ? null : batch;
      });
      tail = prepared.then(
        () => undefined,
        () => undefined
      );
      return prepared;
    },
    dispose() {
      disposed = true;
    },
  };
};
