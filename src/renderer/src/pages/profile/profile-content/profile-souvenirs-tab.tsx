import { ConfirmationModal, FullscreenMediaModal } from "@renderer/components";
import { useDate, useToast } from "@renderer/hooks";
import { ImageIcon, TrashIcon } from "@primer/octicons-react";
import type { ProfileAchievementSouvenir } from "@types";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import "./profile-souvenirs-tab.scss";

interface ProfileSouvenirsTabProps {
  souvenirs: ProfileAchievementSouvenir[];
  onRefresh: () => Promise<void>;
}

const souvenirKey = (souvenir: ProfileAchievementSouvenir) =>
  `${souvenir.shop}:${souvenir.objectId}:${souvenir.achievementName}`;

export function ProfileSouvenirsTab({
  souvenirs,
  onRefresh,
}: Readonly<ProfileSouvenirsTabProps>) {
  const { t } = useTranslation("user_profile");
  const { formatDateTime } = useDate();
  const { showErrorToast, showSuccessToast } = useToast();
  const [selected, setSelected] = useState<ProfileAchievementSouvenir | null>(
    null
  );
  const [deleteTarget, setDeleteTarget] =
    useState<ProfileAchievementSouvenir | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteTarget || isDeleting) return;

    setIsDeleting(true);
    try {
      await window.electron.deleteAchievementSouvenir({
        shop: deleteTarget.shop,
        objectId: deleteTarget.objectId,
        achievementName: deleteTarget.achievementName,
      });
      if (selected && souvenirKey(selected) === souvenirKey(deleteTarget)) {
        setSelected(null);
      }
      setDeleteTarget(null);
      await onRefresh();
      showSuccessToast(
        t("souvenir_deleted", { defaultValue: "Souvenir deleted" })
      );
    } catch {
      showErrorToast(
        t("souvenir_delete_failed", {
          defaultValue: "Could not delete this souvenir",
        })
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="profile-souvenirs" aria-label={t("souvenirs")}>
      <header className="profile-souvenirs__header">
        <div>
          <h2>{t("souvenirs")}</h2>
          <p>
            {t("souvenirs_description", {
              defaultValue:
                "A private snapshot of the moment each achievement unlocked.",
            })}
          </p>
        </div>
        <span className="profile-souvenirs__count">
          {souvenirs.length.toLocaleString()}
        </span>
      </header>

      {souvenirs.length === 0 ? (
        <div className="profile-souvenirs__empty" role="status">
          <ImageIcon size={30} aria-hidden="true" />
          <div>
            <strong>
              {t("no_souvenirs", {
                defaultValue: "No achievement souvenirs yet",
              })}
            </strong>
            <p>
              {t("no_souvenirs_description", {
                defaultValue:
                  "Enable souvenir capture in Content & gameplay, then unlock an achievement.",
              })}
            </p>
          </div>
        </div>
      ) : (
        <ul className="profile-souvenirs__grid">
          {souvenirs.map((souvenir) => (
            <li key={souvenirKey(souvenir)}>
              <article className="profile-souvenirs__card">
                <button
                  type="button"
                  className="profile-souvenirs__preview"
                  onClick={() => setSelected(souvenir)}
                  aria-label={t("view_souvenir", {
                    defaultValue: "View {{achievement}} souvenir",
                    achievement: souvenir.achievementDisplayName,
                  })}
                >
                  <img
                    src={souvenir.imageUrl}
                    alt=""
                    loading="lazy"
                    draggable={false}
                  />
                  <span
                    className="profile-souvenirs__notification"
                    aria-hidden="true"
                  >
                    {souvenir.achievementIconUrl ? (
                      <img
                        className="profile-souvenirs__achievement-icon"
                        src={souvenir.achievementIconUrl}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span className="profile-souvenirs__achievement-icon profile-souvenirs__achievement-icon--placeholder">
                        <ImageIcon size={18} />
                      </span>
                    )}
                    <span className="profile-souvenirs__notification-copy">
                      <strong>{souvenir.achievementDisplayName}</strong>
                      <span>
                        {souvenir.achievementDescription || souvenir.gameTitle}
                      </span>
                    </span>
                  </span>
                </button>

                <div className="profile-souvenirs__details">
                  {souvenir.gameIconUrl ? (
                    <img
                      className="profile-souvenirs__game-icon"
                      src={souvenir.gameIconUrl}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span className="profile-souvenirs__game-icon profile-souvenirs__game-icon--placeholder">
                      <ImageIcon size={16} aria-hidden="true" />
                    </span>
                  )}
                  <div className="profile-souvenirs__copy">
                    <strong>{souvenir.achievementDisplayName}</strong>
                    <span>
                      {souvenir.gameTitle} ·{" "}
                      {formatDateTime(souvenir.unlockTime)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="profile-souvenirs__delete"
                    onClick={() => setDeleteTarget(souvenir)}
                    aria-label={t("delete_souvenir", {
                      defaultValue: "Delete {{achievement}} souvenir",
                      achievement: souvenir.achievementDisplayName,
                    })}
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      <FullscreenMediaModal
        visible={selected != null}
        onClose={() => setSelected(null)}
        src={selected?.imageUrl}
        alt={t("souvenir_image_alt", {
          defaultValue: "{{achievement}} achievement souvenir",
          achievement: selected?.achievementDisplayName ?? "",
        })}
      />

      <ConfirmationModal
        visible={deleteTarget != null}
        title={t("delete_souvenir_title", {
          defaultValue: "Delete achievement souvenir?",
        })}
        descriptionText={t("delete_souvenir_description", {
          defaultValue:
            "This removes the local image and its private R2 copy. This cannot be undone.",
        })}
        confirmButtonLabel={t("delete_souvenir_confirm", {
          defaultValue: "Delete souvenir",
        })}
        cancelButtonLabel={t("cancel")}
        buttonsIsDisabled={isDeleting}
        onClose={() => {
          if (!isDeleting) setDeleteTarget(null);
        }}
        onConfirm={() => void handleDelete()}
      />
    </section>
  );
}
