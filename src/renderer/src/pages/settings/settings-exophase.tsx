import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, CheckboxField } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import {
  CheckCircleFillIcon,
  AlertIcon,
  SyncIcon,
  LinkExternalIcon,
  DownloadIcon,
} from "@primer/octicons-react";
import type { GameShop } from "@types";

const MANAGED_PLATFORMS: Array<{ shop: GameShop; label: string }> = [
  { shop: "steam", label: "Steam" },
  { shop: "xbox", label: "Xbox" },
  { shop: "gog", label: "GOG" },
  { shop: "epic", label: "Epic Games" },
  { shop: "battlenet", label: "Battle.net" },
  { shop: "ea", label: "EA app" },
  { shop: "ubisoft", label: "Ubisoft Connect" },
];

const DEFAULT_MANAGED: GameShop[] = MANAGED_PLATFORMS.map((p) => p.shop);

export function SettingsExophase() {
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const navigate = useNavigate();
  const [username, setUsername] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isImportingPsn, setIsImportingPsn] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    current: number;
    total: number;
    title: string;
  } | null>(null);

  const enabled = userPreferences?.exophaseEnabled !== false;
  const managed = userPreferences?.exophaseManagedPlatforms ?? DEFAULT_MANAGED;

  useEffect(() => {
    setUsername(userPreferences?.exophaseUserId ?? null);
  }, [userPreferences?.exophaseUserId]);

  // Confirm the persisted session is still alive on mount.
  useEffect(() => {
    if (!userPreferences?.exophaseUserId) return;
    window.electron
      .getExophaseAuthState(true)
      .then((state) => setUsername(state.username))
      .catch(() => {});
  }, [userPreferences?.exophaseUserId]);

  const handleLogin = async () => {
    setIsConnecting(true);
    try {
      const state = await window.electron.openExophaseAuthWindow();
      if (state.authenticated) {
        setUsername(state.username);
        await updateUserPreferences({
          exophaseUserId: state.username,
          exophaseEnabled: true,
        });
        // Prime the shared achievement cache in the background.
        window.electron.runExophaseBackgroundSync().catch(() => {});
        showSuccessToast(
          "Exophase connected",
          `Signed in as ${state.username}.`
        );
      } else {
        showErrorToast("Exophase sign-in cancelled.");
      }
    } catch {
      showErrorToast("Exophase sign-in failed.");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleClear = async () => {
    await window.electron.clearExophaseSession().catch(() => {});
    setUsername(null);
    await updateUserPreferences({ exophaseUserId: null });
    showSuccessToast("Exophase disconnected.");
  };

  const handleToggleEnabled = (next: boolean) => {
    updateUserPreferences({ exophaseEnabled: next }).catch(() => {});
  };

  const handleTogglePlatform = (shop: GameShop) => {
    const set = new Set(managed);
    if (set.has(shop)) set.delete(shop);
    else set.add(shop);
    updateUserPreferences({
      exophaseManagedPlatforms: Array.from(set),
    }).catch(() => {});
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncProgress(null);
    const unsub = window.electron.onExophaseSyncProgress((p) =>
      setSyncProgress(p)
    );
    try {
      const result = await window.electron.syncExophaseAchievements();
      if (result.error) {
        showErrorToast("Exophase sync failed", result.error);
      } else {
        showSuccessToast(
          "Achievements synced",
          `${result.totalUnlocked} unlocked across ${result.gamesWithAchievements} games (${result.gamesProcessed} checked).`
        );
      }
    } catch {
      showErrorToast("Exophase sync failed.");
    } finally {
      unsub();
      setIsSyncing(false);
      setSyncProgress(null);
    }
  };

  const handlePsnImport = async () => {
    setIsImportingPsn(true);
    setSyncProgress(null);
    const unsub = window.electron.onExophaseSyncProgress((p) =>
      setSyncProgress(p)
    );
    try {
      const result = await window.electron.importPlaystationAchievements();
      if (result.error) {
        showErrorToast("PlayStation import failed", result.error);
      } else {
        showSuccessToast(
          "PlayStation achievements imported",
          `Credited ${result.totalUnlocked} trophies onto ${result.gamesMatched} game${result.gamesMatched !== 1 ? "s" : ""} (${result.gamesProcessed} checked).`
        );
      }
    } catch {
      showErrorToast("PlayStation import failed.");
    } finally {
      unsub();
      setIsImportingPsn(false);
      setSyncProgress(null);
    }
  };

  const isAuthenticated = Boolean(username);

  return (
    <div className="settings-exophase">
      <CheckboxField
        label="Enable this platform"
        checked={enabled}
        onChange={(e) => handleToggleEnabled(e.target.checked)}
      />
      <p style={{ margin: "8px 0 20px", opacity: 0.65, fontSize: "0.875em" }}>
        When enabled, Exophase tracks achievements for games on your managed
        platforms — a single account covers Steam, Xbox, GOG, Epic and more.
      </p>

      <h3 style={{ margin: "0 0 4px" }}>Exophase Connection</h3>
      <p style={{ margin: "0 0 12px", opacity: 0.65, fontSize: "0.875em" }}>
        Sign in with your Exophase account so GameHub can read your unlocked
        achievements. Don&apos;t have one? You can create it on the same login
        screen.
      </p>

      <div
        style={{
          border: `1px solid ${isAuthenticated ? "rgba(63, 185, 80, 0.5)" : "var(--color-danger, #e05c5c)"}`,
          borderRadius: 8,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          maxWidth: 640,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isAuthenticated ? (
            <CheckCircleFillIcon size={16} className="settings-exophase__ok" />
          ) : (
            <AlertIcon size={16} />
          )}
          <strong>
            {isAuthenticated
              ? `Authenticated as ${username}`
              : "Not authenticated"}
          </strong>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <Button
            type="button"
            onClick={handleLogin}
            disabled={isConnecting}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <LinkExternalIcon size={14} />
            {isConnecting
              ? "Waiting for sign-in…"
              : isAuthenticated
                ? "Re-authenticate"
                : "Login"}
          </Button>
          <Button
            type="button"
            theme="outline"
            onClick={handleClear}
            disabled={!isAuthenticated || isConnecting}
          >
            Clear
          </Button>
        </div>
      </div>

      <h3 style={{ margin: "24px 0 4px" }}>Managed Platforms</h3>
      <p style={{ margin: "0 0 12px", opacity: 0.65, fontSize: "0.875em" }}>
        Games on these platforms will use Exophase for achievements. Check the
        platforms you want Exophase to manage.
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginBottom: 20,
        }}
      >
        {MANAGED_PLATFORMS.map(({ shop, label }) => (
          <CheckboxField
            key={shop}
            label={label}
            checked={managed.includes(shop)}
            onChange={() => handleTogglePlatform(shop)}
          />
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button
          type="button"
          onClick={handleSync}
          disabled={!isAuthenticated || isSyncing || isImportingPsn || !enabled}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <SyncIcon size={14} />
          {isSyncing ? "Syncing achievements…" : "Sync Achievements Now"}
        </Button>

        <Button
          type="button"
          theme="outline"
          onClick={handlePsnImport}
          disabled={!isAuthenticated || isSyncing || isImportingPsn || !enabled}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <DownloadIcon size={14} />
          {isImportingPsn
            ? "Importing trophies…"
            : "Import PlayStation Achievements"}
        </Button>

        <Button
          type="button"
          theme="outline"
          onClick={() => navigate("/achievements-sync")}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <LinkExternalIcon size={14} />
          View Sync Report
        </Button>
      </div>

      <p style={{ margin: "8px 0 0", opacity: 0.6, fontSize: "0.8em" }}>
        PlayStation import credits trophies you earned on PSN onto the matching
        PC game in your library — e.g. God of War trophies from PS4 show up
        unlocked on God of War. You need to{" "}
        <button
          type="button"
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "var(--color-accent)",
            cursor: "pointer",
            fontSize: "inherit",
            textDecoration: "underline",
            textUnderlineOffset: "2px",
          }}
          onClick={() =>
            window.electron.openExternal("https://www.exophase.com/account")
          }
        >
          link your PSN account on Exophase
        </button>{" "}
        first, then click Import.
      </p>

      {(isSyncing || isImportingPsn) && (
        <div style={{ marginTop: 10 }}>
          <p style={{ margin: "0 0 6px", opacity: 0.75, fontSize: "0.8em" }}>
            {syncProgress
              ? `${syncProgress.current}/${syncProgress.total} — ${syncProgress.title}`
              : "Starting…"}
          </p>
          <div
            style={{
              height: 4,
              background: "rgba(255,255,255,0.1)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                background: "#fff",
                borderRadius: 2,
                transition: "width 0.3s ease",
                width: syncProgress
                  ? `${Math.round((syncProgress.current / Math.max(syncProgress.total, 1)) * 100)}%`
                  : "0%",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
