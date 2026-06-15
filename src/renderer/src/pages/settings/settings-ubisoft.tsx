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

interface UbisoftGameDef {
  installId: string;
  title: string;
  installDir: string;
  launchUri: string;
}

interface UbisoftDetection {
  installed: boolean;
  detected: UbisoftGameDef[];
}

export function SettingsUbisoft() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();

  const { data } = useCachedDetection<UbisoftDetection>("ubisoft-games", () =>
    window.electron.getUbisoftGames()
  );

  const clientInstalled = data?.installed ?? null;
  const detected = data?.detected ?? [];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const isConnected = Boolean(userPreferences?.ubisoftTicket);
  const username = userPreferences?.ubisoftUsername;

  useEffect(() => {
    if (data) {
      setSelected((prev) =>
        prev.size > 0 ? prev : new Set(data.detected.map((g) => g.installId))
      );
    }
  }, [data]);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const result = await window.electron.openUbisoftAuthWindow();
      if (result) {
        // Main process already persisted the credentials — update renderer state
        await updateUserPreferences({
          ubisoftTicket: result.ticket,
          ubisoftUserId: result.userId,
          ubisoftProfileId: result.profileId,
          ubisoftUsername: result.username,
        });
        showSuccessToast("Ubisoft Connect", `Connected as ${result.username}`);
        handleSync();
      }
    } catch {
      showErrorToast("Ubisoft Connect", "Failed to connect account.");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await updateUserPreferences({
      ubisoftTicket: null,
      ubisoftUserId: null,
      ubisoftProfileId: null,
      ubisoftUsername: null,
    });
    showSuccessToast("Ubisoft Connect", "Account disconnected.");
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await window.electron.syncUbisoftLibrary();
      if (result.error) {
        showErrorToast("Ubisoft Connect", result.error);
      } else {
        showSuccessToast(
          "Ubisoft Connect",
          `Library synced: ${result.added} game${result.added !== 1 ? "s" : ""} added (${result.total} owned).`
        );
      }
    } catch {
      showErrorToast("Ubisoft Connect", "Library sync failed.");
    } finally {
      setIsSyncing(false);
    }
  };

  const toggleGame = (installId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(installId)) {
        next.delete(installId);
      } else {
        next.add(installId);
      }
      return next;
    });
  };

  const handleAddToLibrary = async () => {
    if (selected.size === 0) return;
    setIsAdding(true);
    try {
      const result = await window.electron.addUbisoftGamesToLibrary(
        Array.from(selected)
      );
      showSuccessToast(
        "Ubisoft Connect",
        `Added ${result.added} game${result.added !== 1 ? "s" : ""} to your library.`
      );
    } catch {
      showErrorToast("Ubisoft Connect", "Failed to add games to library.");
    } finally {
      setIsAdding(false);
    }
  };

  if (userPreferences === null) return null;

  return (
    <div className="settings-account">
      <p className="settings-account__description">
        Connect your Ubisoft account to import your owned games — no client
        required. Games launch through Ubisoft Connect when it&apos;s
        installed.
      </p>

      {!isConnected ? (
        <div>
          <Button type="button" onClick={handleConnect} disabled={isConnecting}>
            {isConnecting ? "Connecting…" : "Connect Ubisoft account"}
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
            Ubisoft Connect is not installed — synced games can&apos;t be
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
              const isChecked = selected.has(game.installId);

              return (
                <button
                  key={game.installId}
                  type="button"
                  onClick={() => toggleGame(game.installId)}
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
