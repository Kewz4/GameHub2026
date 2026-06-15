import { useContext, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button, Link, TextField } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import {
  LinkExternalIcon,
  SyncIcon,
  CheckCircleFillIcon,
  MarkGithubIcon,
} from "@primer/octicons-react";
import { LibrarySyncModal, type LibrarySyncResult } from "./library-sync-modal";

const STEAM_API_KEY_URL = "https://steamcommunity.com/dev/apikey";

export function SettingsSteamAccount() {
  const { t } = useTranslation("settings");
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();

  const [steamId, setSteamId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [linkedAccount, setLinkedAccount] = useState<{
    steamid: string;
    personaname: string;
    avatarfull: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isOpenIdPending, setIsOpenIdPending] = useState(false);
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
    if (userPreferences) {
      setSteamId(userPreferences.steamId ?? "");
      setApiKey(userPreferences.steamApiKey ?? "");
    }
  }, [userPreferences]);

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

  const handleSteamOpenIdLogin = async () => {
    setIsOpenIdPending(true);
    try {
      const detectedSteamId = await window.electron.startSteamOpenIdLogin();
      // Save immediately so the linked-account panel renders
      await updateUserPreferences({
        steamId: detectedSteamId,
        steamApiKey: apiKey.trim() || null,
      });
      setSteamId(detectedSteamId);
      // Fetch and display profile
      const summary = await window.electron
        .getSteamPlayerSummary(detectedSteamId, apiKey.trim() || undefined)
        .catch(() => null);
      if (summary) {
        setLinkedAccount(summary);
        showSuccessToast(t("steam_account_linked"));
      } else {
        showSuccessToast(t("steam_id_detected", { steamId: detectedSteamId }));
      }
      // Sync owned games in the background.
      runBackgroundSync(detectedSteamId, apiKey.trim() || undefined);
    } catch {
      showErrorToast(t("steam_openid_failed"));
    } finally {
      setIsOpenIdPending(false);
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!steamId.trim()) return;

    setIsSaving(true);
    try {
      const summary = await window.electron.getSteamPlayerSummary(
        steamId.trim(),
        apiKey.trim() || undefined
      );

      if (!summary) {
        showErrorToast(t("steam_account_not_found"));
        return;
      }

      await updateUserPreferences({
        steamId: steamId.trim(),
        steamApiKey: apiKey.trim() || null,
      });
      setLinkedAccount(summary);
      showSuccessToast(t("steam_account_linked"));
      // Sync owned games in the background.
      runBackgroundSync(steamId.trim(), apiKey.trim() || undefined);
    } catch {
      showErrorToast(t("steam_invalid_credentials"));
    } finally {
      setIsSaving(false);
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
    setSteamId("");
    setApiKey("");
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
    <form onSubmit={handleConnect} className="settings-account">
      <p className="settings-account__description">
        {t("steam_account_description")}
      </p>

      <div>
        <Button
          type="button"
          onClick={handleSteamOpenIdLogin}
          disabled={isOpenIdPending}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "#1b2838",
            color: "#c7d5e0",
          }}
        >
          <MarkGithubIcon size={16} />
          {isOpenIdPending ? t("waiting_for_steam") : t("login_with_steam")}
        </Button>
        <p style={{ margin: "8px 0 0", opacity: 0.55, fontSize: "0.8em" }}>
          {t("login_with_steam_hint")}
        </p>
      </div>

      <p style={{ margin: 0, opacity: 0.5, textAlign: "center" }}>{t("or")}</p>

      <TextField
        label={t("steam_id")}
        value={steamId}
        onChange={(e) => setSteamId(e.target.value)}
        placeholder="76561198..."
        hint={t("steam_id_hint")}
      />

      <TextField
        label={t("steam_api_key")}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        type="password"
        placeholder={t("steam_api_key_placeholder")}
        hint={
          <Trans i18nKey="steam_api_key_hint" ns="settings">
            <Link to={STEAM_API_KEY_URL}>
              <LinkExternalIcon size={12} />
            </Link>
          </Trans>
        }
      />

      <div>
        <Button type="submit" disabled={!steamId.trim() || isSaving}>
          {isSaving ? t("connecting") : t("connect_steam_account")}
        </Button>
      </div>
    </form>
  );
}
