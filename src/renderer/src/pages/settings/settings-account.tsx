import { Avatar, Button, SelectField } from "@renderer/components";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useCallback, useContext, useEffect, useState } from "react";
import {
  KeyIcon,
  MailIcon,
  XCircleFillIcon,
  CloudIcon,
  DownloadIcon,
} from "@primer/octicons-react";
import { settingsContext } from "@renderer/context";
import { AuthPage } from "@shared";
import "./settings-account.scss";

interface FormValues {
  profileVisibility: "PUBLIC" | "FRIENDS" | "PRIVATE";
}

export function SettingsAccount() {
  const { t } = useTranslation("settings");
  const { t: tUserProfile } = useTranslation("user_profile");

  const [isUnblocking, setIsUnblocking] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const { showSuccessToast, showErrorToast } = useToast();

  const { blockedUsers, fetchBlockedUsers } = useContext(settingsContext);

  const {
    control,
    formState: { isSubmitting },
    setValue,
    handleSubmit,
  } = useForm<FormValues>();

  const {
    userDetails,
    patchUser,
    fetchUserDetails,
    updateUserDetails,
    unblockUser,
  } = useUserDetails();

  useEffect(() => {
    if (userDetails?.profileVisibility) {
      setValue("profileVisibility", userDetails.profileVisibility);
    }
  }, [userDetails, setValue]);

  useEffect(() => {
    const unsubscribe = window.electron.onAccountUpdated(() => {
      fetchUserDetails().then((response) => {
        if (response) {
          updateUserDetails(response);
        }
      });
      showSuccessToast(t("account_data_updated_successfully"));
    });

    return () => {
      unsubscribe();
    };
  }, [fetchUserDetails, updateUserDetails, t, showSuccessToast]);

  const visibilityOptions = [
    { value: "PUBLIC", label: t("public") },
    { value: "FRIENDS", label: t("friends_only") },
    { value: "PRIVATE", label: t("private") },
  ];

  const onSubmit = async (values: FormValues) => {
    await patchUser(values);
    showSuccessToast(t("changes_saved"));
  };

  const handleUnblockClick = useCallback(
    (id: string) => {
      setIsUnblocking(true);

      unblockUser(id)
        .then(() => {
          fetchBlockedUsers();
          showSuccessToast(t("user_unblocked"));
        })
        .finally(() => {
          setIsUnblocking(false);
        });
    },
    [unblockUser, fetchBlockedUsers, t, showSuccessToast]
  );

  if (!userDetails) return null;

  return (
    <form
      className="settings-account__form"
      data-settings-account
      onSubmit={handleSubmit(onSubmit)}
    >
      <Controller
        control={control}
        name="profileVisibility"
        render={({ field }) => {
          const handleChange = (
            event: React.ChangeEvent<HTMLSelectElement>
          ) => {
            field.onChange(event);
            handleSubmit(onSubmit)();
          };

          return (
            <section className="settings-account__section">
              <SelectField
                id="settings-profile-visibility"
                label={t("profile_visibility")}
                value={field.value}
                onChange={handleChange}
                options={visibilityOptions.map((visiblity) => ({
                  key: visiblity.value,
                  value: visiblity.value,
                  label: visiblity.label,
                }))}
                disabled={isSubmitting}
              />

              <small>{t("profile_visibility_description")}</small>
            </section>
          );
        }}
      />

      <section className="settings-account__section">
        <h4>{t("current_username")}</h4>
        <p>
          {userDetails?.username?.trim() ||
            userDetails?.displayName ||
            "GameHub user"}
        </p>

        <h4>{t("current_email")}</h4>
        <p>{userDetails?.email ?? t("no_email_account")}</p>

        <div className="settings-account__actions">
          <Button
            theme="outline"
            onClick={() => window.electron.openAuthWindow(AuthPage.UpdateEmail)}
          >
            <MailIcon aria-hidden="true" />
            {t("update_email")}
          </Button>

          <Button
            theme="outline"
            onClick={() =>
              window.electron.openAuthWindow(AuthPage.UpdatePassword)
            }
          >
            <KeyIcon aria-hidden="true" />
            {t("update_password")}
          </Button>
        </div>
      </section>

      <section className="settings-account__section">
        <h3>{t("settings_sync_title")}</h3>
        <p className="settings-account__sync-description">
          {t("settings_sync_description")}
        </p>
        <div className="settings-account__actions">
          <Button
            theme="outline"
            disabled={isBackingUp}
            onClick={async () => {
              setIsBackingUp(true);
              try {
                const result = await window.electron.backupSettingsToCloud();
                if (result.ok) showSuccessToast(t("settings_backup_success"));
                else showErrorToast(t("settings_backup_failed"));
              } finally {
                setIsBackingUp(false);
              }
            }}
          >
            <CloudIcon aria-hidden="true" />
            {isBackingUp ? t("backing_up") : t("backup_settings")}
          </Button>

          <Button
            theme="outline"
            disabled={isRestoring}
            onClick={async () => {
              setIsRestoring(true);
              try {
                const result = await window.electron.restoreSettingsFromCloud();
                if (result.restored)
                  showSuccessToast(t("settings_restore_success"));
                else showErrorToast(t("settings_restore_not_found"));
              } finally {
                setIsRestoring(false);
              }
            }}
          >
            <DownloadIcon aria-hidden="true" />
            {isRestoring ? t("restoring") : t("restore_settings")}
          </Button>
        </div>
      </section>

      <section className="settings-account__section">
        <h3>{t("blocked_users")}</h3>

        {blockedUsers.length > 0 ? (
          <ul className="settings-account__blocked-users">
            {blockedUsers.map((user) => {
              return (
                <li key={user.id} className="settings-account__blocked-user">
                  <div className="settings-account__user-info">
                    <Avatar
                      className="settings-account__user-avatar"
                      size={32}
                      src={user.profileImageUrl}
                      alt={user.displayName}
                    />
                    <span>{user.displayName}</span>
                  </div>

                  <button
                    type="button"
                    className="settings-account__unblock-button"
                    onClick={() => handleUnblockClick(user.id)}
                    disabled={isUnblocking}
                    aria-label={`${tUserProfile("unblock")} ${user.displayName}`}
                    title={`${tUserProfile("unblock")} ${user.displayName}`}
                  >
                    <XCircleFillIcon aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <small>{t("no_users_blocked")}</small>
        )}
      </section>
    </form>
  );
}
