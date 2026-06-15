import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import {
  CheckCircleFillIcon,
  PersonIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";

export function SettingsXbox() {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const { updateUserPreferences } = useContext(settingsContext);
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    added: number;
    total: number;
  } | null>(null);

  const gamertag = userPreferences?.xboxGamertag ?? null;
  const hasGamePass = userPreferences?.xboxHasGamePass ?? false;
  const isSignedIn = !!gamertag;

  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      const result = await window.electron.openXboxAuthWindow();
      if (result.success) {
        await updateUserPreferences({
          xboxGamertag: result.gamertag ?? "Xbox User",
          xboxHasGamePass: false, // user sets this manually below
        } as any);
        showSuccessToast(
          t("xbox_signed_in_as", { gamertag: result.gamertag ?? "Xbox User" })
        );
      } else {
        showErrorToast(t("xbox_auth_failed"));
      }
    } catch (err: any) {
      showErrorToast(err?.message ?? t("xbox_auth_failed"));
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    setSyncResult(null);
    await updateUserPreferences({
      xboxAccessToken: null,
      xboxUserHash: null,
      xboxXstsToken: null,
      xboxTokenExpiry: null,
      xboxGamertag: null,
      xboxHasGamePass: false,
    } as any);
    showSuccessToast(t("xbox_signed_out"));
  };

  const handleToggleGamePass = async (value: boolean) => {
    await updateUserPreferences({ xboxHasGamePass: value } as any);
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const result = await window.electron.syncGamePassLibrary();
      setSyncResult(result);
      showSuccessToast(
        t("xbox_library_synced", { added: result.added, total: result.total })
      );
    } catch (err: any) {
      showErrorToast(err?.message ?? t("xbox_sync_failed"));
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="settings-account">
      <p className="settings-account__description">{t("xbox_description")}</p>

      {!isSignedIn ? (
        <Button
          type="button"
          onClick={handleSignIn}
          disabled={isSigningIn}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            width: "fit-content",
          }}
        >
          <PersonIcon size={14} />
          {isSigningIn ? t("signing_in") : t("sign_in_xbox")}
        </Button>
      ) : (
        <>
          <div className="settings-account__card">
            <CheckCircleFillIcon size={16} />
            <span className="settings-account__identity">
              {t("xbox_signed_in_as", { gamertag })}
            </span>
            <Button type="button" theme="outline" onClick={handleSignOut}>
              {t("sign_out")}
            </Button>
          </div>

          {/* Manual Game Pass toggle — API detection is unreliable without partner access */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={hasGamePass}
              onChange={(e) => handleToggleGamePass(e.target.checked)}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
            <span>{t("xbox_i_have_gamepass")}</span>
          </label>

          {hasGamePass && (
            <>
              <div className="settings-account__row">
                <Button
                  type="button"
                  onClick={handleSync}
                  disabled={isSyncing}
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <SyncIcon size={14} />
                  {isSyncing ? t("syncing") : t("sync_xbox_library")}
                </Button>
                {syncResult && (
                  <small style={{ opacity: 0.7 }}>
                    {t("xbox_library_synced", {
                      added: syncResult.added,
                      total: syncResult.total,
                    })}
                  </small>
                )}
              </div>
              <p className="settings-account__hint">
                {t("xbox_launch_hint")}
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
