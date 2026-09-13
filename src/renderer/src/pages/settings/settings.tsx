import { useTranslation } from "react-i18next";
import {
  SettingsContextConsumer,
  SettingsContextProvider,
} from "@renderer/context";
import { SettingsAccount } from "./settings-account";
import { useUserDetails } from "@renderer/hooks";
import { useMemo, useRef } from "react";
import "./settings.scss";
import {
  BellIcon,
  CloudIcon,
  DownloadIcon,
  GearIcon,
  PlayIcon,
  ShieldCheckIcon,
  VideoIcon,
} from "@primer/octicons-react";
import { Wrench, Trophy, Gamepad2 } from "lucide-react";
import { SettingsContextGeneral } from "./settings-context-general";
import { SettingsContextDownloads } from "./settings-context-downloads";
import { SettingsContextNotifications } from "./settings-context-notifications";
import { SettingsContextContentGameplay } from "./settings-context-content-gameplay";
import { SettingsContextIntegrations } from "./settings-context-integrations";
import { SettingsContextAchievements } from "./settings-context-achievements";
import { SettingsContextCompatibility } from "./settings-context-compatibility";
import { SettingsContextBigPicture } from "./settings-context-big-picture";
import { SettingsContextEmulation } from "./settings-context-emulation";
import {
  getSettingsCategoryNavigationTarget,
  type SettingsCategoryId,
} from "@renderer/context/settings/settings-navigation";

export default function Settings() {
  const { t } = useTranslation("settings");
  const { t: tSidebar } = useTranslation("sidebar");

  const { userDetails } = useUserDetails();
  const categoryButtonRefs = useRef<Map<SettingsCategoryId, HTMLButtonElement>>(
    new Map()
  );

  const categories = useMemo(
    () => [
      {
        id: "general" as const,
        label: t("general"),
        icon: <GearIcon size={16} />,
      },
      {
        id: "downloads" as const,
        label: t("downloads"),
        icon: <DownloadIcon size={16} />,
      },
      {
        id: "notifications" as const,
        label: t("notifications"),
        icon: <BellIcon size={16} />,
      },
      {
        id: "content_gameplay" as const,
        label: t("content_gameplay"),
        icon: <PlayIcon size={16} />,
      },
      {
        id: "integrations" as const,
        label: t("integrations"),
        icon: <CloudIcon size={16} />,
      },
      {
        id: "achievements" as const,
        label: t("achievements"),
        icon: <Trophy size={16} />,
      },
      {
        id: "compatibility" as const,
        label: t("compatibility"),
        icon: <Wrench size={16} />,
      },
      {
        id: "big_picture" as const,
        label: t("big_picture"),
        icon: <VideoIcon size={16} />,
      },
      {
        id: "emulation" as const,
        label: t("emulation"),
        icon: <Gamepad2 size={16} />,
      },
      ...(userDetails
        ? [
            {
              id: "account_privacy" as const,
              label: `${t("account")} & ${t("privacy")}`,
              icon: <ShieldCheckIcon size={16} />,
            },
          ]
        : []),
    ],
    [t, userDetails]
  );

  return (
    <SettingsContextProvider>
      <SettingsContextConsumer>
        {({ currentCategoryId, setCurrentCategoryId, appearance }) => {
          const currentCategory =
            categories.find((category) => category.id === currentCategoryId) ??
            categories[0];
          const selectedCategoryId = currentCategory.id;
          const categoryIds = categories.map((category) => category.id);

          const handleCategoryKeyDown = (
            event: React.KeyboardEvent<HTMLButtonElement>,
            categoryId: SettingsCategoryId
          ) => {
            const nextCategoryId = getSettingsCategoryNavigationTarget(
              categoryIds,
              categoryId,
              event.key
            );
            if (!nextCategoryId) return;

            event.preventDefault();
            setCurrentCategoryId(nextCategoryId);
            requestAnimationFrame(() => {
              categoryButtonRefs.current.get(nextCategoryId)?.focus();
            });
          };

          const renderCategory = () => {
            if (selectedCategoryId === "general") {
              return <SettingsContextGeneral appearance={appearance} />;
            }

            if (selectedCategoryId === "downloads") {
              return <SettingsContextDownloads />;
            }

            if (selectedCategoryId === "notifications") {
              return <SettingsContextNotifications />;
            }

            if (selectedCategoryId === "content_gameplay") {
              return <SettingsContextContentGameplay />;
            }

            if (selectedCategoryId === "integrations") {
              return <SettingsContextIntegrations />;
            }

            if (selectedCategoryId === "achievements") {
              return <SettingsContextAchievements />;
            }

            if (selectedCategoryId === "compatibility") {
              return <SettingsContextCompatibility />;
            }

            if (selectedCategoryId === "big_picture") {
              return <SettingsContextBigPicture />;
            }

            if (selectedCategoryId === "emulation") {
              return <SettingsContextEmulation />;
            }

            return <SettingsAccount />;
          };

          return (
            <section className="settings__container">
              <div className="settings__content">
                <div
                  className="settings__sidebar"
                  role="tablist"
                  aria-label={tSidebar("settings")}
                >
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      ref={(element) => {
                        if (element) {
                          categoryButtonRefs.current.set(category.id, element);
                        } else {
                          categoryButtonRefs.current.delete(category.id);
                        }
                      }}
                      type="button"
                      id={`settings-category-tab-${category.id}`}
                      role="tab"
                      aria-selected={selectedCategoryId === category.id}
                      aria-controls="settings-category-panel"
                      tabIndex={selectedCategoryId === category.id ? 0 : -1}
                      data-settings-category={category.id}
                      className={`settings__sidebar-button ${
                        selectedCategoryId === category.id
                          ? "settings__sidebar-button--active"
                          : ""
                      }`}
                      onClick={() => setCurrentCategoryId(category.id)}
                      onKeyDown={(event) =>
                        handleCategoryKeyDown(event, category.id)
                      }
                    >
                      <span
                        className="settings__sidebar-button-icon"
                        aria-hidden="true"
                      >
                        {category.icon}
                      </span>
                      <span>{category.label}</span>
                    </button>
                  ))}
                </div>

                <div
                  className="settings__panel"
                  id="settings-category-panel"
                  role="tabpanel"
                  aria-labelledby={`settings-category-tab-${selectedCategoryId}`}
                  data-settings-panel={selectedCategoryId}
                >
                  <h2>{currentCategory.label}</h2>
                  {renderCategory()}
                </div>
              </div>
            </section>
          );
        }}
      </SettingsContextConsumer>
    </SettingsContextProvider>
  );
}
