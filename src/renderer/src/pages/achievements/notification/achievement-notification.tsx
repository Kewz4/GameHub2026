import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  injectCustomCss,
  removeCustomCss,
  getAchievementSoundUrl,
  getAchievementSoundVolume,
} from "@renderer/helpers";
import { AchievementNotificationItem } from "@renderer/components/achievements/notification/achievement-notification";
import { levelDBService } from "@renderer/services/leveldb.service";
import app from "../../../app.scss?inline";
import styles from "../../../components/achievements/notification/achievement-notification.scss?inline";
import root from "react-shadow";
import gameHubIconUrl from "@renderer/assets/icons/gamehub-white.svg?url";
import {
  createAchievementNotificationIconQueue,
  positionAchievementNotifications,
  type PositionedAchievementNotification,
} from "@renderer/components/achievements/notification/achievement-notification-icon";

const NOTIFICATION_TIMEOUT = 4000;

export function AchievementNotification() {
  const { t } = useTranslation("achievement");

  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [achievements, setAchievements] = useState<
    PositionedAchievementNotification[]
  >([]);
  const [currentAchievement, setCurrentAchievement] =
    useState<PositionedAchievementNotification | null>(null);

  const achievementAnimation = useRef(-1);
  const closingAnimation = useRef(-1);
  const visibleAnimation = useRef(-1);

  const [shadowRootRef, setShadowRootRef] = useState<HTMLElement | null>(null);

  // The overlay BrowserWindow is created with `transparent: true`, but this
  // route loads the same document as the main app, whose global styles set
  // `body { background-color: var(--color-dark-background) }`. That opaque fill
  // painted the whole window as a black rectangle around the toast (visible over
  // a game). Force the document chain transparent so only the toast shows.
  useEffect(() => {
    const targets = [
      document.documentElement,
      document.body,
      document.getElementById("root"),
    ].filter((el): el is HTMLElement => el != null);
    const previous = targets.map((el) => el.style.background);
    for (const el of targets) el.style.background = "transparent";
    return () => {
      targets.forEach((el, i) => {
        el.style.background = previous[i];
      });
    };
  }, []);

  const playAudio = useCallback(async () => {
    const soundUrl = await getAchievementSoundUrl();
    const volume = await getAchievementSoundVolume();
    const audio = new Audio(soundUrl);
    audio.volume = volume;
    audio.play();
  }, []);

  useEffect(() => {
    const iconQueue = createAchievementNotificationIconQueue(gameHubIconUrl);
    const unsubscribeCombined = window.electron.onCombinedAchievementsUnlocked(
      (gameCount, achievementCount, position) => {
        if (gameCount === 0 || achievementCount === 0) return;

        void iconQueue
          .enqueue([
            {
              title: t("new_achievements_unlocked", {
                gameCount,
                achievementCount,
              }),
              isHidden: false,
              isRare: false,
              isPlatinum: false,
              iconUrl: gameHubIconUrl,
            },
          ])
          .then((preparedAchievements) => {
            if (!preparedAchievements) return;
            setAchievements((current) =>
              current.concat(
                positionAchievementNotifications(
                  preparedAchievements,
                  position ?? "top-left"
                )
              )
            );
            void playAudio();
          });
      }
    );

    const unsubscribeAchievement = window.electron.onAchievementUnlocked(
      (position, achievements) => {
        if (!achievements?.length) return;
        void iconQueue.enqueue(achievements).then((preparedAchievements) => {
          if (!preparedAchievements) return;
          setAchievements((current) =>
            current.concat(
              positionAchievementNotifications(
                preparedAchievements,
                position ?? "top-left"
              )
            )
          );
          void playAudio();
        });
      }
    );

    return () => {
      iconQueue.dispose();
      unsubscribeCombined();
      unsubscribeAchievement();
    };
  }, [t, playAudio]);

  // Main waits for this explicit handshake before showing the host window or
  // sending the first unlock. This effect is declared after both IPC listener
  // subscriptions, so the first badge cannot race React mounting.
  useEffect(() => {
    window.electron.achievementNotificationRendererReady();
  }, []);

  const hasAchievementsPending = achievements.length > 0;

  const startAnimateClosing = useCallback(() => {
    cancelAnimationFrame(closingAnimation.current);
    cancelAnimationFrame(visibleAnimation.current);
    cancelAnimationFrame(achievementAnimation.current);

    setIsClosing(true);

    const zero = performance.now();
    closingAnimation.current = requestAnimationFrame(
      function animateClosing(time) {
        if (time - zero <= 450) {
          closingAnimation.current = requestAnimationFrame(animateClosing);
        } else {
          setIsVisible(false);
          setIsClosing(false);
          setAchievements((ach) => ach.slice(1));
        }
      }
    );
  }, []);

  useEffect(() => {
    if (hasAchievementsPending) {
      setIsClosing(false);
      setIsVisible(true);

      let zero = performance.now();
      cancelAnimationFrame(closingAnimation.current);
      cancelAnimationFrame(visibleAnimation.current);
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
    }
  }, [hasAchievementsPending, startAnimateClosing, currentAchievement]);

  useEffect(() => {
    if (achievements.length) {
      setCurrentAchievement(achievements[0]);
    }
  }, [achievements]);

  // Once the queue has drained and the notification has animated out, tell the
  // main process to hide the transparent overlay window. Without this the
  // window stays shown with no content and paints as a black rectangle in the
  // configured corner.
  useEffect(() => {
    if (!hasAchievementsPending && !isVisible && !isClosing) {
      setCurrentAchievement(null);
      window.electron.hideAchievementCustomNotificationWindow();
    }
  }, [hasAchievementsPending, isVisible, isClosing]);

  const loadAndApplyTheme = useCallback(async () => {
    if (!shadowRootRef) return;
    const allThemes = (await levelDBService.values("themes")) as {
      isActive?: boolean;
      code?: string;
    }[];
    const activeTheme = allThemes.find((theme) => theme.isActive);
    if (activeTheme?.code) {
      injectCustomCss(activeTheme.code, shadowRootRef);
    } else {
      removeCustomCss(shadowRootRef);
    }
  }, [shadowRootRef]);

  useEffect(() => {
    loadAndApplyTheme();
  }, [loadAndApplyTheme]);

  useEffect(() => {
    const unsubscribe = window.electron.onCustomThemeUpdated(() => {
      loadAndApplyTheme();
    });

    return () => unsubscribe();
  }, [loadAndApplyTheme]);

  return (
    <root.div>
      <style type="text/css">
        {app} {styles}
      </style>
      <section ref={setShadowRootRef}>
        {isVisible && currentAchievement && (
          <AchievementNotificationItem
            achievement={currentAchievement.achievement}
            isClosing={isClosing}
            position={currentAchievement.position}
          />
        )}
      </section>
    </root.div>
  );
}
