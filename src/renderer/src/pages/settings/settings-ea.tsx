import { useContext, useEffect, useState } from "react";
import { Button } from "@renderer/components";
import { useAppSelector, useCachedDetection, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import {
  AlertIcon,
  CheckCircleFillIcon,
  PlusIcon,
  SyncIcon,
} from "@primer/octicons-react";

interface EaGameDef {
  offerId: string | null;
  title: string;
  installDir: string | null;
}

interface EaDetection {
  installed: boolean;
  detected: EaGameDef[];
}

export function SettingsEa() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();

  const { data } = useCachedDetection<EaDetection>("ea-games", () =>
    window.electron.getEaGames()
  );

  const clientInstalled = data?.installed ?? null;
  const detected = data?.detected ?? [];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const isConnected = Boolean(userPreferences?.eaAccessToken);
  const username = userPreferences?.eaUsername;

  useEffect(() => {
    if (data) {
      setSelected((prev) =>
        prev.size > 0 ? prev : new Set(data.detected.map((g) => g.title))
      );
    }
  }, [data]);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const result = await window.electron.openEaAuthWindow();
      if (result) {
        await updateUserPreferences({
          eaAccessToken: result.accessToken,
          eaUsername: result.username,
          eaPid: result.pid,
        });
        showSuccessToast("EA app", `Connected as ${result.username}`);
        handleSync();
      }
    } catch {
      showErrorToast("EA app", "Failed to connect account.");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await updateUserPreferences({
      eaAccessToken: null,
      eaTokenExpiry: null,
      eaUsername: null,
      eaPid: null,
    });
    showSuccessToast("EA app", "Account disconnected.");
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await window.electron.syncEaLibrary();
      if (result.error) {
        showErrorToast("EA app", result.error);
      } else {
        showSuccessToast(
          "EA app",
          `Library synced: ${result.added} game${result.added !== 1 ? "s" : ""} added (${result.total} owned).`
        );
      }
    } catch {
      showErrorToast("EA app", "Library sync failed.");
    } finally {
      setIsSyncing(false);
    }
  };

  const toggleGame = (title: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  const handleAddToLibrary = async () => {
    if (selected.size === 0) return;
    setIsAdding(true);
    try {
      const result = await window.electron.addEaGamesToLibrary(
        Array.from(selected)
      );
      showSuccessToast(
        "EA app",
        `Added ${result.added} game${result.added !== 1 ? "s" : ""} to your library.`
      );
    } catch {
      showErrorToast("EA app", "Failed to add games to library.");
    } finally {
      setIsAdding(false);
    }
  };

  if (userPreferences === null) return null;

  return (
    <div className="settings-account">
      <p className="settings-account__description">
        Connect your EA account to import your owned games — no client required.
        Games launch through the EA app when it&apos;s installed.
      </p>

      {!isConnected ? (
        <div>
          <Button type="button" onClick={handleConnect} disabled={isConnecting}>
            {isConnecting ? "Connecting…" : "Connect EA account"}
          </Button>
        </div>
      ) : (
        <div className="settings-account__row">
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <CheckCircleFillIcon size={14} />
            Connected{username ? ` as ${username}` : ""}
          </span>
          <Button
            type="button"
            onClick={handleSync}
            disabled={isSyncing}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <SyncIcon size={14} />
            {isSyncing ? "Syncing…" : "Sync library"}
          </Button>
          <Button type="button" theme="outline" onClick={handleDisconnect}>
            Disconnect
          </Button>
        </div>
      )}

      {data !== null && clientInstalled === false && (
        <div className="settings-account__warning">
          <AlertIcon size={16} />
          <span>
            EA app / Origin is not installed — synced games can&apos;t be
            launched until you install it.
          </span>
        </div>
      )}

      {detected.length > 0 && (
        <>
          <p className="settings-account__hint">
            Locally installed games detected:
          </p>
          <div className="settings-account__game-grid">
            {detected.map((game) => {
              const isChecked = selected.has(game.title);

              return (
                <button
                  key={game.title}
                  type="button"
                  onClick={() => toggleGame(game.title)}
                  className={`settings-account__game-tile${isChecked ? " settings-account__game-tile--selected" : ""}`}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="settings-account__game-title">
                      {game.title}
                    </div>
                    <div className="settings-account__game-status">
                      <CheckCircleFillIcon size={10} />
                      Installed
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div>
            <Button
              type="button"
              onClick={handleAddToLibrary}
              disabled={selected.size === 0 || isAdding}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <PlusIcon size={14} />
              {isAdding ? "Adding…" : `Add ${selected.size} to library`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
