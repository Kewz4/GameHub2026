import { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import { EpicAuthModal } from "./epic-auth-modal";
import {
  CheckCircleFillIcon,
  PersonIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { LibrarySyncModal, type LibrarySyncResult } from "./library-sync-modal";

type Step = "idle" | "signing_in" | "syncing";

export function SettingsEpicAccount() {
  const { t } = useTranslation("settings");
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();

  const [status, setStatus] = useState<{
    binaryFound: boolean;
    binaryPath: string | null;
    account: string | null;
    authenticated: boolean;
  } | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [syncResult, setSyncResult] = useState<{
    total: number;
    added: number;
  } | null>(null);
  const [syncModal, setSyncModal] = useState<{
    heading: string;
    summary: string;
    results: LibrarySyncResult[];
  } | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const refreshStatus = useCallback(async () => {
    const s = await window.electron.getLegendaryStatus().catch(() => null);
    if (s) {
      setStatus(s);
      // Keep the cached account name in sync with reality
      const cached = userPreferences?.epicAccountName ?? null;
      if (s.authenticated && s.account && s.account !== cached) {
        updateUserPreferences({ epicAccountName: s.account }).catch(() => {});
      } else if (!s.authenticated && cached) {
        updateUserPreferences({ epicAccountName: null }).catch(() => {});
      }
    }
    return s;
  }, [userPreferences?.epicAccountName, updateUserPreferences]);

  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignIn = () => {
    setShowAuthModal(true);
  };

  const handleAuthResult = useCallback(
    async (result: { success: boolean; account?: string }) => {
      if (result.success) {
        showSuccessToast(
          t("epic_logged_in_as", { username: result.account ?? "Epic" })
        );
        // Cache the account name so the connected state renders instantly
        // on the next visit
        await updateUserPreferences({
          epicAccountName: result.account ?? "Epic",
        });
        await refreshStatus();
      } else {
        showErrorToast(t("epic_auth_failed"));
      }
    },
    [showSuccessToast, showErrorToast, t, refreshStatus, updateUserPreferences]
  );

  const handleSignOut = async () => {
    await window.electron.epicSignOut().catch(() => {});
    // Always force local signed-out state — the immediate status re-read can
    // return stale data and leave the UI saying "Logged in as Signed out"
    setStatus((prev) =>
      prev ? { ...prev, authenticated: false, account: null } : null
    );
    await updateUserPreferences({ epicAccountName: null });
    showSuccessToast(t("epic_signed_out"));
  };

  const handleSync = async () => {
    setStep("syncing");
    setSyncResult(null);
    try {
      const result = await window.electron.syncEpicLibrary();
      setSyncResult(result);

      // Auto-run dedup after sync
      const dedupResult = await window.electron
        .mergeDuplicateGames()
        .catch(() => ({ merged: 0, mergedTitles: [] }));

      setSyncModal({
        heading: "Epic Library Synced",
        summary:
          result.added > 0
            ? `Added ${result.added} game${result.added !== 1 ? "s" : ""} (${result.total} total).${dedupResult.merged > 0 ? ` Merged ${dedupResult.merged} duplicate${dedupResult.merged !== 1 ? "s" : ""}.` : ""}`
            : `Library up to date (${result.total} games).${dedupResult.merged > 0 ? ` Merged ${dedupResult.merged} duplicate${dedupResult.merged !== 1 ? "s" : ""}.` : ""}`,
        results: (result.addedGames ?? []).map((g) => ({
          title: g.title,
          coverUrl: g.coverUrl,
          what: g.what,
          isNew: true,
        })),
      });
    } catch (err: any) {
      showErrorToast(err?.message ?? t("epic_sync_failed"));
    } finally {
      setStep("idle");
    }
  };

  const isBusy = step !== "idle";
  // Render connected state instantly from the cached account name; the
  // background status check corrects it if the session actually expired
  const cachedAccount = userPreferences?.epicAccountName ?? null;
  const isAuthenticated = status ? status.authenticated : Boolean(cachedAccount);
  const accountName = status?.account ?? cachedAccount;

  return (
    <>
      <div className="settings-account">
        <p className="settings-account__description">
          {t("epic_account_description")}
        </p>

        {isAuthenticated ? (
          <div className="settings-account__card">
            <CheckCircleFillIcon size={16} />
            <span className="settings-account__identity">
              {t("epic_logged_in_as", { username: accountName })}
            </span>
            <Button
              type="button"
              theme="outline"
              onClick={handleSignOut}
              disabled={isBusy}
            >
              {t("sign_out")}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            onClick={handleSignIn}
            disabled={isBusy}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              width: "fit-content",
            }}
          >
            <PersonIcon size={14} />
            {step === "signing_in" ? t("signing_in") : t("sign_in_epic")}
          </Button>
        )}

        {/* Sync library */}
        {isAuthenticated && (
          <div className="settings-account__row">
            <Button
              type="button"
              onClick={handleSync}
              disabled={isBusy}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <SyncIcon size={14} />
              {step === "syncing" ? t("syncing") : t("sync_epic_library")}
            </Button>
            {syncResult && (
              <small style={{ opacity: 0.7 }}>
                {t("sync_result", {
                  added: syncResult.added,
                  total: syncResult.total,
                })}
              </small>
            )}
          </div>
        )}
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

      <EpicAuthModal
        visible={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={handleAuthResult}
      />
    </>
  );
}
