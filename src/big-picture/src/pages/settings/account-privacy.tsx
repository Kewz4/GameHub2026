import "./account-privacy.scss";

import {
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  EnvelopeSimpleIcon,
  KeyIcon,
} from "@phosphor-icons/react";
import { AuthPage } from "@shared";
import type { ProfileVisibility, UserBlocks, UserFriend } from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Button,
  DropdownSelect,
  HorizontalFocusGroup,
  type DropdownSelectOption,
} from "../../components";
import { useBigPictureToast, useNavigation, useUserDetails } from "../../hooks";
import { getBigPictureRoutePath } from "../../helpers";
import type { FocusOverrides } from "../../services";
import {
  ACCOUNT_PRIVACY_BACKUP_SETTINGS_BUTTON_ID,
  ACCOUNT_PRIVACY_CLOUD_SAVES_BUTTON_ID,
  ACCOUNT_PRIVACY_PRIVACY_SELECT_ID,
  ACCOUNT_PRIVACY_RESTORE_SETTINGS_BUTTON_ID,
  ACCOUNT_PRIVACY_UPDATE_EMAIL_BUTTON_ID,
  ACCOUNT_PRIVACY_UPDATE_PASSWORD_BUTTON_ID,
  getAccountPrivacyBlockedUserButtonFocusId,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { GAMEHUB_CLOUD_SAVES_COPY } from "./account-privacy-cloud";
import {
  getSettingsBackupFeedback,
  getSettingsRestoreFeedback,
} from "./account-privacy-sync";
import { SettingsSection } from "./settings-section";

interface SettingsSectionProps {
  className?: string;
}

const SETTINGS_TOAST_OPTIONS = {
  fallbackVisual: "settings" as const,
};

function getProfileVisibilityLabel(value: ProfileVisibility) {
  switch (value) {
    case "FRIENDS":
      return "Friends Only";
    case "PRIVATE":
      return "Private";
    default:
      return "Public";
  }
}

export function AccountPrivacySettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  const navigate = useNavigate();
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const { setFocus } = useNavigation();
  const { userDetails, patchUser, unblockUser } = useUserDetails();
  const [profileVisibility, setProfileVisibility] =
    useState<ProfileVisibility>("PUBLIC");
  const [blockedUsers, setBlockedUsers] = useState<UserFriend[]>([]);
  const [isSavingVisibility, setIsSavingVisibility] = useState(false);
  const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);
  const [settingsSyncOperation, setSettingsSyncOperation] = useState<
    "backup" | "restore" | null
  >(null);

  useEffect(() => {
    if (!userDetails?.profileVisibility) return;

    setProfileVisibility(userDetails.profileVisibility);
  }, [userDetails?.profileVisibility]);

  const fetchBlockedUsers = useCallback(async () => {
    if (!userDetails) {
      setBlockedUsers([]);
      return [];
    }

    const response = await globalThis.window.electron.hydraApi
      .get<UserBlocks>("/profile/blocks", {
        params: { take: 12, skip: 0 },
      })
      .catch(() => ({ totalBlocks: 0, blocks: [] }) satisfies UserBlocks);

    const nextBlockedUsers = response.blocks ?? [];
    setBlockedUsers(nextBlockedUsers);
    return nextBlockedUsers;
  }, [userDetails]);

  useEffect(() => {
    void fetchBlockedUsers();
  }, [fetchBlockedUsers]);

  const visibilityOptions = useMemo<
    Array<DropdownSelectOption<ProfileVisibility>>
  >(
    () => [
      { value: "PUBLIC", label: "Public" },
      { value: "FRIENDS", label: "Friends Only" },
      { value: "PRIVATE", label: "Private" },
    ],
    []
  );

  const blockedUserFocusIds = useMemo(
    () =>
      blockedUsers.map((user) => ({
        user,
        focusId: getAccountPrivacyBlockedUserButtonFocusId(user.id),
      })),
    [blockedUsers]
  );

  const handleProfileVisibilityChange = useCallback(
    async (value: ProfileVisibility) => {
      if (!userDetails || isSavingVisibility) return;

      const previousValue = profileVisibility;

      setProfileVisibility(value);
      setIsSavingVisibility(true);

      try {
        await patchUser({ profileVisibility: value });
        showSuccessToast("Profile visibility updated", {
          ...SETTINGS_TOAST_OPTIONS,
          message: `Your profile is now ${getProfileVisibilityLabel(value)}.`,
        });
      } catch {
        setProfileVisibility(previousValue);
        showErrorToast(
          "Failed to update profile visibility",
          SETTINGS_TOAST_OPTIONS
        );
      } finally {
        setIsSavingVisibility(false);
      }
    },
    [
      isSavingVisibility,
      patchUser,
      profileVisibility,
      showErrorToast,
      showSuccessToast,
      userDetails,
    ]
  );

  const handleUnblock = useCallback(
    async (userId: string) => {
      const currentIndex = blockedUsers.findIndex((user) => user.id === userId);
      const nextUser = blockedUsers[currentIndex + 1];
      const previousUser = blockedUsers[currentIndex - 1];
      const nextFocusId = nextUser
        ? getAccountPrivacyBlockedUserButtonFocusId(nextUser.id)
        : previousUser
          ? getAccountPrivacyBlockedUserButtonFocusId(previousUser.id)
          : ACCOUNT_PRIVACY_CLOUD_SAVES_BUTTON_ID;

      setUnblockingUserId(userId);

      try {
        await unblockUser(userId);
        await fetchBlockedUsers();
        globalThis.window.requestAnimationFrame(() => {
          setFocus(nextFocusId);
        });
      } finally {
        setUnblockingUserId(null);
      }
    },
    [blockedUsers, fetchBlockedUsers, setFocus, unblockUser]
  );

  const restoreActionFocus = useCallback(
    (focusId: string) => {
      globalThis.window.requestAnimationFrame(() => {
        setFocus(focusId);
      });
    },
    [setFocus]
  );

  const handleSettingsBackup = useCallback(async () => {
    if (settingsSyncOperation) return;

    setSettingsSyncOperation("backup");

    try {
      const result = await globalThis.window.electron.backupSettingsToCloud();
      const feedback = getSettingsBackupFeedback(result);
      const showToast = feedback.success ? showSuccessToast : showErrorToast;

      showToast(feedback.title, {
        ...SETTINGS_TOAST_OPTIONS,
        message: feedback.message,
      });
    } catch {
      const feedback = getSettingsBackupFeedback(null);
      showErrorToast(feedback.title, {
        ...SETTINGS_TOAST_OPTIONS,
        message: feedback.message,
      });
    } finally {
      setSettingsSyncOperation(null);
      restoreActionFocus(ACCOUNT_PRIVACY_BACKUP_SETTINGS_BUTTON_ID);
    }
  }, [
    restoreActionFocus,
    settingsSyncOperation,
    showErrorToast,
    showSuccessToast,
  ]);

  const handleSettingsRestore = useCallback(async () => {
    if (settingsSyncOperation) return;

    setSettingsSyncOperation("restore");

    try {
      const result =
        await globalThis.window.electron.restoreSettingsFromCloud();
      const feedback = getSettingsRestoreFeedback(result);
      const showToast = feedback.success ? showSuccessToast : showErrorToast;

      showToast(feedback.title, {
        ...SETTINGS_TOAST_OPTIONS,
        message: feedback.message,
      });
    } catch {
      const feedback = getSettingsRestoreFeedback(null);
      showErrorToast(feedback.title, {
        ...SETTINGS_TOAST_OPTIONS,
        message: feedback.message,
      });
    } finally {
      setSettingsSyncOperation(null);
      restoreActionFocus(ACCOUNT_PRIVACY_RESTORE_SETTINGS_BUTTON_ID);
    }
  }, [
    restoreActionFocus,
    settingsSyncOperation,
    showErrorToast,
    showSuccessToast,
  ]);

  const cloudSavesButtonOverrides = useMemo<FocusOverrides>(
    () => ({
      up: {
        type: "item",
        itemId: ACCOUNT_PRIVACY_BACKUP_SETTINGS_BUTTON_ID,
      },
      down: blockedUserFocusIds[0]
        ? {
            type: "item",
            itemId: blockedUserFocusIds[0].focusId,
          }
        : { type: "block" },
    }),
    [blockedUserFocusIds]
  );

  const blockedUserNavigationOverrides = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    return Object.fromEntries(
      blockedUserFocusIds.map(({ focusId }, index) => {
        const previousItem = blockedUserFocusIds[index - 1];
        const nextItem = blockedUserFocusIds[index + 1];

        return [
          focusId,
          {
            up: previousItem
              ? { type: "item", itemId: previousItem.focusId }
              : {
                  type: "item",
                  itemId: ACCOUNT_PRIVACY_CLOUD_SAVES_BUTTON_ID,
                },
            down: nextItem
              ? { type: "item", itemId: nextItem.focusId }
              : { type: "block" },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [blockedUserFocusIds]);

  if (!userDetails) return null;

  return (
    <div
      className={
        className
          ? `account-privacy-settings-section ${className}`
          : "account-privacy-settings-section"
      }
    >
      <SettingsSection
        title="Privacy"
        description="Choose who can see your profile and library."
      >
        <div className="account-privacy-settings-section__section-content">
          <DropdownSelect
            className="account-privacy-settings-section__select"
            label="Profile Visibility"
            value={profileVisibility}
            options={visibilityOptions}
            focusId={ACCOUNT_PRIVACY_PRIVACY_SELECT_ID}
            focusNavigationOverrides={{
              up: SETTINGS_HEADER_RETURN_TARGET,
              down: {
                type: "item",
                itemId: ACCOUNT_PRIVACY_UPDATE_EMAIL_BUTTON_ID,
              },
            }}
            onValueChange={(value) => {
              void handleProfileVisibilityChange(value);
            }}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Account"
        description="Review your current account details and update your security settings."
      >
        <div className="account-privacy-settings-section__section-content account-privacy-settings-section__section-content--account">
          <div className="account-privacy-settings-section__detail-grid">
            <div className="account-privacy-settings-section__detail">
              <p className="account-privacy-settings-section__detail-label">
                Username
              </p>
              <p className="account-privacy-settings-section__detail-value">
                {userDetails.username.trim() || userDetails.displayName}
              </p>
            </div>

            <div className="account-privacy-settings-section__detail">
              <p className="account-privacy-settings-section__detail-label">
                Current Email
              </p>
              <p className="account-privacy-settings-section__detail-value">
                {userDetails.email ?? "You have not set an email yet"}
              </p>
            </div>
          </div>

          <HorizontalFocusGroup asChild>
            <div className="account-privacy-settings-section__actions">
              <Button
                className="account-privacy-settings-section__action-button"
                variant="secondary"
                icon={<EnvelopeSimpleIcon size={22} />}
                focusId={ACCOUNT_PRIVACY_UPDATE_EMAIL_BUTTON_ID}
                focusNavigationOverrides={{
                  up: {
                    type: "item",
                    itemId: ACCOUNT_PRIVACY_PRIVACY_SELECT_ID,
                  },
                  down: {
                    type: "item",
                    itemId: ACCOUNT_PRIVACY_BACKUP_SETTINGS_BUTTON_ID,
                  },
                  left: { type: "block" },
                  right: {
                    type: "item",
                    itemId: ACCOUNT_PRIVACY_UPDATE_PASSWORD_BUTTON_ID,
                  },
                }}
                onClick={() => {
                  void globalThis.window.electron.openAuthWindow(
                    AuthPage.UpdateEmail
                  );
                }}
              >
                Update Email
              </Button>

              <Button
                className="account-privacy-settings-section__action-button"
                variant="secondary"
                icon={<KeyIcon size={22} />}
                focusId={ACCOUNT_PRIVACY_UPDATE_PASSWORD_BUTTON_ID}
                focusNavigationOverrides={{
                  up: {
                    type: "item",
                    itemId: ACCOUNT_PRIVACY_PRIVACY_SELECT_ID,
                  },
                  down: {
                    type: "item",
                    itemId: ACCOUNT_PRIVACY_RESTORE_SETTINGS_BUTTON_ID,
                  },
                  left: {
                    type: "item",
                    itemId: ACCOUNT_PRIVACY_UPDATE_EMAIL_BUTTON_ID,
                  },
                  right: { type: "block" },
                }}
                onClick={() => {
                  void globalThis.window.electron.openAuthWindow(
                    AuthPage.UpdatePassword
                  );
                }}
              >
                Update Password
              </Button>
            </div>
          </HorizontalFocusGroup>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Settings Backup"
        description="Keep this device's GameHub settings in your configured R2 storage and restore them after a reinstall."
      >
        <div className="account-privacy-settings-section__section-content">
          <p className="account-privacy-settings-section__subscription-line">
            Your local settings remain available on this device. Cloud backup is
            optional and does not require a subscription.
          </p>

          <HorizontalFocusGroup asChild>
            <div className="account-privacy-settings-section__actions">
              <Button
                className="account-privacy-settings-section__action-button"
                variant="secondary"
                icon={<CloudArrowUpIcon size={22} />}
                loading={settingsSyncOperation === "backup"}
                disabled={settingsSyncOperation !== null}
                focusId={ACCOUNT_PRIVACY_BACKUP_SETTINGS_BUTTON_ID}
                focusNavigationOverrides={{
                  up: {
                    type: "item",
                    itemId: ACCOUNT_PRIVACY_UPDATE_EMAIL_BUTTON_ID,
                  },
                  down: {
                    type: "item",
                    itemId: ACCOUNT_PRIVACY_CLOUD_SAVES_BUTTON_ID,
                  },
                  left: { type: "block" },
                  right: {
                    type: "item",
                    itemId: ACCOUNT_PRIVACY_RESTORE_SETTINGS_BUTTON_ID,
                  },
                }}
                onClick={() => {
                  void handleSettingsBackup();
                }}
              >
                {settingsSyncOperation === "backup"
                  ? "Backing Up…"
                  : "Back Up Settings"}
              </Button>

              <Button
                className="account-privacy-settings-section__action-button"
                variant="secondary"
                icon={<CloudArrowDownIcon size={22} />}
                loading={settingsSyncOperation === "restore"}
                disabled={settingsSyncOperation !== null}
                focusId={ACCOUNT_PRIVACY_RESTORE_SETTINGS_BUTTON_ID}
                focusNavigationOverrides={{
                  up: {
                    type: "item",
                    itemId: ACCOUNT_PRIVACY_UPDATE_PASSWORD_BUTTON_ID,
                  },
                  down: {
                    type: "item",
                    itemId: ACCOUNT_PRIVACY_CLOUD_SAVES_BUTTON_ID,
                  },
                  left: {
                    type: "item",
                    itemId: ACCOUNT_PRIVACY_BACKUP_SETTINGS_BUTTON_ID,
                  },
                  right: { type: "block" },
                }}
                onClick={() => {
                  void handleSettingsRestore();
                }}
              >
                {settingsSyncOperation === "restore"
                  ? "Restoring…"
                  : "Restore Settings"}
              </Button>
            </div>
          </HorizontalFocusGroup>
        </div>
      </SettingsSection>

      <SettingsSection
        title={GAMEHUB_CLOUD_SAVES_COPY.title}
        description={GAMEHUB_CLOUD_SAVES_COPY.description}
      >
        <div className="account-privacy-settings-section__section-content">
          <div className="account-privacy-settings-section__subscription-copy">
            <p className="account-privacy-settings-section__subscription-line">
              {GAMEHUB_CLOUD_SAVES_COPY.status}
            </p>
          </div>

          <Button
            className="account-privacy-settings-section__cloud-button"
            focusId={ACCOUNT_PRIVACY_CLOUD_SAVES_BUTTON_ID}
            focusNavigationOverrides={cloudSavesButtonOverrides}
            onClick={() => {
              navigate(getBigPictureRoutePath("/cloud-saves"));
            }}
          >
            {GAMEHUB_CLOUD_SAVES_COPY.action}
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Blocked Users"
        description="Review the users you have blocked and unblock them anytime."
      >
        <div className="account-privacy-settings-section__section-content">
          {blockedUserFocusIds.length > 0 ? (
            <div className="account-privacy-settings-section__blocked-users">
              {blockedUserFocusIds.map(({ user, focusId }) => (
                <div
                  key={user.id}
                  className="account-privacy-settings-section__blocked-user"
                >
                  <div className="account-privacy-settings-section__blocked-user-info">
                    {user.profileImageUrl ? (
                      <img
                        src={user.profileImageUrl}
                        alt={user.displayName}
                        className="account-privacy-settings-section__blocked-user-avatar"
                        width={40}
                        height={40}
                        draggable={false}
                      />
                    ) : (
                      <div className="account-privacy-settings-section__blocked-user-avatar account-privacy-settings-section__blocked-user-avatar--placeholder">
                        {user.displayName[0]?.toUpperCase() ?? "?"}
                      </div>
                    )}

                    <p className="account-privacy-settings-section__blocked-user-name">
                      {user.displayName}
                    </p>
                  </div>

                  <Button
                    variant="secondary"
                    loading={unblockingUserId === user.id}
                    focusId={focusId}
                    focusNavigationOverrides={
                      blockedUserNavigationOverrides[focusId]
                    }
                    onClick={() => {
                      void handleUnblock(user.id);
                    }}
                  >
                    Unblock
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="account-privacy-settings-section__empty">
              You have no blocked users.
            </p>
          )}
        </div>
      </SettingsSection>
    </div>
  );
}
