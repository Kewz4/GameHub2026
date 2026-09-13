import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AchievementCustomNotificationPosition } from "@types";
import {
  getAchievementSoundUrl,
  getAchievementSoundVolume,
} from "@renderer/helpers";
import { AchievementNotificationItem } from "./achievement-notification";
import {
  createAchievementNotificationIconQueue,
  positionAchievementNotifications,
  type PositionedAchievementNotification,
} from "./achievement-notification-icon";
import gameHubIconUrl from "@renderer/assets/icons/gamehub-white.svg?url";

const NOTIFICATION_TIMEOUT = 4000;

const anchorByPosition: Record<
  AchievementCustomNotificationPosition,
  Pick<CSSProperties, "justifyContent" | "alignItems">
> = {
  "top-left": { justifyContent: "flex-start", alignItems: "flex-start" },
  "top-center": { justifyContent: "center", alignItems: "flex-start" },
  "top-right": { justifyContent: "flex-end", alignItems: "flex-start" },
  "bottom-left": { justifyContent: "flex-start", alignItems: "flex-end" },
  "bottom-center": { justifyContent: "center", alignItems: "flex-end" },
  "bottom-right": { justifyContent: "flex-end", alignItems: "flex-end" },
};

export function AchievementNotificationOverlay() {
  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [achievements, setAchievements] = useState<
    PositionedAchievementNotification[]
  >([]);
  const [currentAchievement, setCurrentAchievement] =
    useState<PositionedAchievementNotification | null>(null);

  const achievementAnimation = useRef(-1);
  const closingAnimation = useRef(-1);

  const playAudio = useCallback(async () => {
    const soundUrl = await getAchievementSoundUrl();
    const volume = await getAchievementSoundVolume();
    const audio = new Audio(soundUrl);
    audio.volume = volume;
    audio.play();
  }, []);

  useEffect(() => {
    const iconQueue = createAchievementNotificationIconQueue(gameHubIconUrl);
    const unsubscribe = window.electron.onInAppAchievementUnlocked(
      (nextPosition, nextAchievements) => {
        if (!nextAchievements?.length) return;
        void iconQueue
          .enqueue(nextAchievements)
          .then((preparedAchievements) => {
            if (!preparedAchievements) return;
            setAchievements((current) =>
              current.concat(
                positionAchievementNotifications(
                  preparedAchievements,
                  nextPosition ?? "top-left"
                )
              )
            );
            void playAudio();
          });
      }
    );

    return () => {
      iconQueue.dispose();
      unsubscribe();
    };
  }, [playAudio]);

  const hasAchievementsPending = achievements.length > 0;

  const startAnimateClosing = useCallback(() => {
    cancelAnimationFrame(closingAnimation.current);
    cancelAnimationFrame(achievementAnimation.current);

    setIsClosing(true);

    const zero = performance.now();
    closingAnimation.current = requestAnimationFrame(
      function animateClosing(time) {
        if (time - zero <= 450) {
          closingAnimation.current = requestAnimationFrame(animateClosing);
        } else {
          setIsVisible(false);
          setAchievements((current) => current.slice(1));
        }
      }
    );
  }, []);

  useEffect(() => {
    if (!hasAchievementsPending) return;

    setIsClosing(false);
    setIsVisible(true);

    let zero = performance.now();
    cancelAnimationFrame(closingAnimation.current);
    cancelAnimationFrame(achievementAnimation.current);
    achievementAnimation.current = requestAnimationFrame(
      function animateLock(time) {
        if (time - zero > NOTIFICATION_TIMEOUT) {
          zero = performance.now();
          startAnimateClosing();
        }
        achievementAnimation.current = requestAnimationFrame(animateLock);
      }
    );
  }, [hasAchievementsPending, startAnimateClosing, currentAchievement]);

  useEffect(() => {
    if (achievements.length) {
      setCurrentAchievement(achievements[0]);
    }
  }, [achievements]);

  if (!isVisible || !currentAchievement) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        pointerEvents: "none",
        zIndex: 999999,
        ...anchorByPosition[currentAchievement.position],
      }}
    >
      <AchievementNotificationItem
        achievement={currentAchievement.achievement}
        isClosing={isClosing}
        position={currentAchievement.position}
      />
    </div>
  );
}
