import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import {
  SyncIcon,
  CheckCircleFillIcon,
  MarkGithubIcon,
} from "@primer/octicons-react";
import { LibrarySyncModal, type LibrarySyncResult } from "./library-sync-modal";

export function SettingsSteamAccount() {
  const { t } = useTranslation("settings");
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();

  const [linkedAccount, setLinkedAccount] = useState<{
    steamid: string;
    personaname: string;
    avatarfull: string;
  } | null>(null);
  const [isInAppPending, setIsInAppPending] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    total: number;
    added: number;
  } | null>(null);
  const [syncModal, setSyncModal] = useState<{
    heading: string;
    summary: string;
    results: LibrarySyncResult[];
  } | null>(null);

  useEffect(() => {
    const savedSteamId = userPreferences?.steamId;

    if (savedSteamId) {
      window.electron
        .getSteamPlayerSummary(
          savedSteamId,
          userPreferences?.steamApiKey ?? undefined
        )
        .then((summary) => {
          if (summary) {
            setLinkedAccount(summary);
            // Cache for instant rendering on the next visit
            if (
              summary.personaname !== userPreferences?.steamUsername ||
              summary.avatarfull !== userPreferences?.steamAvatarUrl
            ) {
              updateUserPreferences({
                steamUsername: summary.personaname,
                steamAvatarUrl: summary.avatarfull,
              }).catch(() => {});
            }
          }
        })
        .catch(() => {});
    } else {
      setLinkedAccount(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPreferences?.steamId, userPreferences?.steamApiKey]);

  // Kick off a Steam library sync in the background (fire-and-forget) right
  // after the account is connected, so the user's owned games get stamped
  // "sync" and locked to the Steam tab without having to click Sync manually.
  const runBackgroundSync = (id: string, key?: string | null) => {
    setIsSyncing(true);
    window.electron
      .syncSteamLibrary(id, key ?? undefined)
      .then(async (result) => {
        if (result.error) {
          showErrorToast(result.error);
          return;
        }
        setSyncResult(result);
        await window.electron.mergeDuplicateGames().catch(() => {});
        if (result.added > 0) {
          showSuccessToast(
            t("steam_sync_result", {
              added: result.added,
              total: result.total,
            })
          );
        }
      })
      .catch(() => {})
      .finally(() => setIsSyncing(false));
  };

  // In-app Steam login (like Epic/GOG). Reads the user's OWN games via the
  // authenticated session — works even when their profile games are private.
  const handleSteamInAppLogin = async () => {
    setIsInAppPending(true);
    try {
      const result = await window.electron.openSteamLoginWindow();
      if (!result?.steamId) {
        showErrorToast(t("steam_openid_failed"));
        return;
      }
      await updateUserPreferences({ steamId: result.steamId });
      const summary = await window.electron
        .getSteamPlayerSummary(result.steamId, undefined)
        .catch(() => null);
      if (summary) setLinkedAccount(summary);
      showSuccessToast(t("steam_account_linked"));
      // Authenticated session is established; sync owned games in background.
      runBackgroundSync(result.steamId);
    } catch {
      showErrorToast(t("steam_openid_failed"));
    } finally {
      setIsInAppPending(false);
    }
  };

  const handleDisconnect = async () => {
    await updateUserPreferences({
      steamId: null,
      steamApiKey: null,
      steamUsername: null,
      steamAvatarUrl: null,
    });
    setLinkedAccount(null);
    setSyncResult(null);
    showSuccessToast(t("steam_account_disconnected"));
  };

  const handleSync = async () => {
    const savedSteamId = userPreferences?.steamId;
    if (!savedSteamId) return;

    setIsSyncing(true);
    setSyncResult(null);
    try {
      const result = await window.electron.syncSteamLibrary(
        savedSteamId,
        userPreferences?.steamApiKey ?? undefined
      );
      if (result.error) {
        showErrorToast(result.error);
        return;
      }
      setSyncResult(result);

      const dedupResult = await window.electron
        .mergeDuplicateGames()
        .catch(() => ({ merged: 0, mergedTitles: [] }));

      setSyncModal({
        heading: "Steam Library Synced",
        summary:
          result.added > 0
            ? `Added ${result.added} game${result.added !== 1 ? "s" : ""} (${result.total} total).${dedupResult.merged > 0 ? ` Merged ${dedupResult.merged} duplicate${dedupResult.merged !== 1 ? "s" : ""}.` : ""}`
            : `Library up to date (${result.total} games).${dedupResult.merged > 0 ? ` Merged ${dedupResult.merged} duplicate${dedupResult.merged !== 1 ? "s" : ""}.` : ""}`,
        results: [],
      });
    } catch {
      showErrorToast(t("steam_sync_failed"));
    } finally {
      setIsSyncing(false);
    }
  };

  // Render connected state instantly from the cached profile; the live
  // lookup refreshes it in the background
  const displayAccount =
    linkedAccount ??
    (userPreferences?.steamId
      ? {
          steamid: userPreferences.steamId,
          personaname: userPreferences.steamUsername ?? "Steam User",
          avatarfull: userPreferences.steamAvatarUrl ?? "",
        }
      : null);

  if (displayAccount) {
    return (
      <>
        <div className="settings-account">
          <div className="settings-account__card">
            <img
              src={displayAccount.avatarfull}
              alt={displayAccount.personaname}
              className="settings-account__avatar"
            />
            <div className="settings-account__identity">
              <div className="settings-account__name">
                <CheckCircleFillIcon size={14} />
                <strong>{displayAccount.personaname}</strong>
              </div>
              <small className="settings-account__sub">
                {displayAccount.steamid}
              </small>
            </div>
            <Button type="button" onClick={handleDisconnect} theme="outline">
              {t("disconnect")}
            </Button>
          </div>

          <div className="settings-account__row">
            <Button
              type="button"
              onClick={handleSync}
              disabled={isSyncing}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <SyncIcon size={14} />
              {isSyncing ? t("syncing") : t("sync_steam_library")}
            </Button>

            {syncResult && (
              <small style={{ opacity: 0.7 }}>
                {t("steam_sync_result", {
                  added: syncResult.added,
                  total: syncResult.total,
                })}
              </small>
            )}
          </div>

          <p className="settings-account__hint">
            {t("steam_library_description")}
          </p>
        </div>

        {syncModal && (
          <LibrarySyncModal
            visible={true}
            heading={syncModal.heading}
            summary={syncModal.summary}
            results={syncModal.results}
            onClose={() => setSyncModal(null)}
          />
        )}
      </>
    );
  }

  return (
    <div className="settings-account">
      <p className="settings-account__description">
        {t("steam_account_description")}
      </p>

      <div>
        <Button
          type="button"
          onClick={handleSteamInAppLogin}
          disabled={isInAppPending}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "#1b2838",
            color: "#c7d5e0",
          }}
        >
          <MarkGithubIcon size={16} />
          {isInAppPending
            ? t("waiting_for_steam")
            : t("login_with_steam_in_app")}
        </Button>
        <p style={{ margin: "8px 0 0", opacity: 0.55, fontSize: "0.8em" }}>
          {t("login_with_steam_in_app_hint")}
        </p>
      </div>
    </div>
  );
}
