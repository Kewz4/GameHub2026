import { useCallback, useEffect, useState } from "react";
import { Button, VerticalFocusGroup } from "../../components";
import { useBigPictureToast, useUserPreferences } from "../../hooks";
import { SettingsSection } from "./settings-section";
import { BPEpicAuthModal } from "./epic-auth-modal";
import {
  INTEGRATIONS_STEAM_PRIMARY_BTN_ID,
  INTEGRATIONS_STEAM_SYNC_BTN_ID,
  INTEGRATIONS_STEAM_DISCONNECT_BTN_ID,
  INTEGRATIONS_EPIC_PRIMARY_BTN_ID,
  INTEGRATIONS_EPIC_SYNC_BTN_ID,
  INTEGRATIONS_EPIC_SIGNOUT_BTN_ID,
  INTEGRATIONS_GOG_PRIMARY_BTN_ID,
  INTEGRATIONS_GOG_SYNC_BTN_ID,
  INTEGRATIONS_GOG_DISCONNECT_BTN_ID,
  INTEGRATIONS_XBOX_PRIMARY_BTN_ID,
  INTEGRATIONS_XBOX_SYNC_BTN_ID,
  INTEGRATIONS_XBOX_SIGNOUT_BTN_ID,
  INTEGRATIONS_EA_PRIMARY_BTN_ID,
  INTEGRATIONS_UBISOFT_PRIMARY_BTN_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import type { FocusOverrideTarget } from "../../services";

interface SettingsSectionProps {
  className?: string;
  downTarget: FocusOverrideTarget;
}

const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  flexWrap: "wrap",
};

const ACCOUNT_CARD_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "8px 12px",
  background: "rgba(255,255,255,0.06)",
  borderRadius: "8px",
  marginBottom: "10px",
};

const STATUS_STYLE: React.CSSProperties = {
  flex: 1,
  fontSize: "0.875rem",
  opacity: 0.9,
};

const HINT_STYLE: React.CSSProperties = {
  margin: "6px 0 0",
  fontSize: "0.8rem",
  opacity: 0.55,
};

// ────────────────────────────────────────────────────────────────────────────────
// Steam
// ────────────────────────────────────────────────────────────────────────────────

function SteamSection() {
  const userPreferences = useUserPreferences();
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const steamId = userPreferences?.steamId ?? null;
  const displayName = userPreferences?.steamUsername ?? steamId ?? null;
  const avatarUrl = userPreferences?.steamAvatarUrl ?? null;

  const handleSignIn = async () => {
    setIsConnecting(true);
    try {
      const result = await globalThis.window.electron.openSteamLoginWindow();
      if (!result?.steamId) {
        showErrorToast("Steam sign-in failed", {
          fallbackVisual: "settings",
          message: "Could not complete Steam login.",
        });
        return;
      }
      await globalThis.window.electron.updateUserPreferences({
        steamId: result.steamId,
      });
      showSuccessToast("Steam account linked", {
        fallbackVisual: "settings",
        message: "Your Steam library will sync in the background.",
      });
      void globalThis.window.electron
        .syncSteamLibrary(result.steamId)
        .catch(() => {});
    } catch {
      showErrorToast("Steam sign-in failed", { fallbackVisual: "settings" });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSync = async () => {
    if (!steamId) return;
    setIsSyncing(true);
    try {
      const result = await globalThis.window.electron.syncSteamLibrary(steamId);
      if (result.error) {
        showErrorToast("Sync failed", {
          fallbackVisual: "settings",
          message: result.error,
        });
        return;
      }
      await globalThis.window.electron.mergeDuplicateGames().catch(() => {});
      showSuccessToast("Steam library synced", {
        fallbackVisual: "settings",
        message: `Added ${result.added} game${result.added !== 1 ? "s" : ""} (${result.total} total).`,
      });
    } catch {
      showErrorToast("Sync failed", { fallbackVisual: "settings" });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    await globalThis.window.electron.updateUserPreferences({
      steamId: null,
      steamApiKey: null,
      steamUsername: null,
      steamAvatarUrl: null,
    });
    showSuccessToast("Steam disconnected", { fallbackVisual: "settings" });
  };

  return (
    <SettingsSection
      title="Steam"
      description="Link your Steam account to sync your library and achievements."
    >
      {steamId ? (
        <div>
          <div style={ACCOUNT_CARD_STYLE}>
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt={displayName ?? "Steam"}
                width={36}
                height={36}
                style={{ borderRadius: "50%" }}
                draggable={false}
              />
            )}
            <span style={STATUS_STYLE}>{displayName ?? steamId}</span>
          </div>
          <div style={ROW_STYLE}>
            <Button
              variant="primary"
              loading={isSyncing}
              focusId={INTEGRATIONS_STEAM_SYNC_BTN_ID}
              focusNavigationOverrides={{
                up: { type: "item", itemId: INTEGRATIONS_STEAM_DISCONNECT_BTN_ID },
                down: { type: "item", itemId: INTEGRATIONS_STEAM_DISCONNECT_BTN_ID },
              }}
              onClick={() => void handleSync()}
            >
              {isSyncing ? "Syncing…" : "Sync library"}
            </Button>
            <Button
              variant="secondary"
              focusId={INTEGRATIONS_STEAM_DISCONNECT_BTN_ID}
              focusNavigationOverrides={{
                up: { type: "item", itemId: INTEGRATIONS_STEAM_SYNC_BTN_ID },
                down: { type: "item", itemId: INTEGRATIONS_EPIC_PRIMARY_BTN_ID },
              }}
              onClick={() => void handleDisconnect()}
            >
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="primary"
          loading={isConnecting}
          focusId={INTEGRATIONS_STEAM_PRIMARY_BTN_ID}
          focusNavigationOverrides={{
            up: SETTINGS_HEADER_RETURN_TARGET,
            down: { type: "item", itemId: INTEGRATIONS_EPIC_PRIMARY_BTN_ID },
          }}
          onClick={() => void handleSignIn()}
        >
          {isConnecting ? "Waiting for Steam…" : "Sign in with Steam"}
        </Button>
      )}
    </SettingsSection>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// Epic Games
// ────────────────────────────────────────────────────────────────────────────────

function EpicSection() {
  const userPreferences = useUserPreferences();
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    globalThis.window.electron
      .getLegendaryStatus()
      .then((s) => {
        setIsAuthenticated(s.authenticated);
        setAccountName(s.account ?? userPreferences?.epicAccountName ?? null);
      })
      .catch(() => {
        setIsAuthenticated(false);
        setAccountName(userPreferences?.epicAccountName ?? null);
      });
  }, [userPreferences?.epicAccountName]);

  const handleAuthSuccess = useCallback(
    async (result: { success: boolean; account?: string }) => {
      if (result.success) {
        setIsAuthenticated(true);
        setAccountName(result.account ?? null);
        await globalThis.window.electron
          .updateUserPreferences({ epicAccountName: result.account ?? "Epic" })
          .catch(() => {});
        showSuccessToast("Epic Games connected", {
          fallbackVisual: "settings",
          message: result.account ? `Signed in as ${result.account}.` : "Signed in.",
        });
      } else {
        showErrorToast("Epic sign-in failed", { fallbackVisual: "settings" });
      }
    },
    [showSuccessToast, showErrorToast]
  );

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await globalThis.window.electron.syncEpicLibrary();
      showSuccessToast("Epic library synced", {
        fallbackVisual: "settings",
        message: `Added ${result.added} game${result.added !== 1 ? "s" : ""} (${result.total} total).`,
      });
    } catch {
      showErrorToast("Sync failed", { fallbackVisual: "settings" });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSignOut = async () => {
    await globalThis.window.electron.epicSignOut().catch(() => {});
    await globalThis.window.electron
      .updateUserPreferences({ epicAccountName: null })
      .catch(() => {});
    setIsAuthenticated(false);
    setAccountName(null);
    showSuccessToast("Epic signed out", { fallbackVisual: "settings" });
  };

  return (
    <>
      <SettingsSection
        title="Epic Games"
        description="Sign in with Legendary to sync your Epic Games library."
      >
        {isAuthenticated ? (
          <div>
            <div style={ACCOUNT_CARD_STYLE}>
              <span style={STATUS_STYLE}>{accountName ?? "Epic Games"}</span>
            </div>
            <div style={ROW_STYLE}>
              <Button
                variant="primary"
                loading={isSyncing}
                focusId={INTEGRATIONS_EPIC_SYNC_BTN_ID}
                focusNavigationOverrides={{
                  up: { type: "item", itemId: INTEGRATIONS_STEAM_PRIMARY_BTN_ID },
                  down: { type: "item", itemId: INTEGRATIONS_EPIC_SIGNOUT_BTN_ID },
                }}
                onClick={() => void handleSync()}
              >
                {isSyncing ? "Syncing…" : "Sync library"}
              </Button>
              <Button
                variant="secondary"
                focusId={INTEGRATIONS_EPIC_SIGNOUT_BTN_ID}
                focusNavigationOverrides={{
                  up: { type: "item", itemId: INTEGRATIONS_EPIC_SYNC_BTN_ID },
                  down: { type: "item", itemId: INTEGRATIONS_GOG_PRIMARY_BTN_ID },
                }}
                onClick={() => void handleSignOut()}
              >
                Sign out
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="primary"
            focusId={INTEGRATIONS_EPIC_PRIMARY_BTN_ID}
            focusNavigationOverrides={{
              up: { type: "item", itemId: INTEGRATIONS_STEAM_PRIMARY_BTN_ID },
              down: { type: "item", itemId: INTEGRATIONS_GOG_PRIMARY_BTN_ID },
            }}
            onClick={() => setShowAuthModal(true)}
          >
            Sign in to Epic Games
          </Button>
        )}
      </SettingsSection>

      <BPEpicAuthModal
        visible={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={(result) => void handleAuthSuccess(result)}
      />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// GOG
// ────────────────────────────────────────────────────────────────────────────────

function GogSection() {
  const userPreferences = useUserPreferences();
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const hasToken = Boolean(userPreferences?.gogRefreshToken);
  const username =
    userPreferences?.gogUsername ?? (hasToken ? "GOG User" : null);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const result = await globalThis.window.electron.openGogAuthWindow();
      if (!result) {
        showErrorToast("GOG sign-in cancelled", { fallbackVisual: "settings" });
        return;
      }
      await globalThis.window.electron.updateUserPreferences({
        gogRefreshToken: result.refresh_token,
        gogUsername: result.username,
      });
      showSuccessToast("GOG connected", {
        fallbackVisual: "settings",
        message: `Signed in as ${result.username}.`,
      });
      void globalThis.window.electron
        .getGogdlStatus()
        .then((s) => {
          if (!s.binaryFound)
            globalThis.window.electron.installGogdl().catch(() => {});
        })
        .catch(() => {});
    } catch {
      showErrorToast("GOG sign-in failed", { fallbackVisual: "settings" });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await globalThis.window.electron.syncGogLibrary();
      showSuccessToast("GOG library synced", {
        fallbackVisual: "settings",
        message: `Added ${result.added} game${result.added !== 1 ? "s" : ""} (${result.total} total).`,
      });
    } catch {
      showErrorToast("Sync failed", { fallbackVisual: "settings" });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    await globalThis.window.electron.updateUserPreferences({
      gogRefreshToken: null,
      gogUsername: null,
    });
    showSuccessToast("GOG disconnected", { fallbackVisual: "settings" });
  };

  return (
    <SettingsSection
      title="GOG"
      description="Connect your GOG account to add your GOG library."
    >
      {hasToken ? (
        <div>
          <div style={ACCOUNT_CARD_STYLE}>
            <span style={STATUS_STYLE}>{username}</span>
          </div>
          <div style={ROW_STYLE}>
            <Button
              variant="primary"
              loading={isSyncing}
              focusId={INTEGRATIONS_GOG_SYNC_BTN_ID}
              focusNavigationOverrides={{
                up: { type: "item", itemId: INTEGRATIONS_EPIC_PRIMARY_BTN_ID },
                down: { type: "item", itemId: INTEGRATIONS_GOG_DISCONNECT_BTN_ID },
              }}
              onClick={() => void handleSync()}
            >
              {isSyncing ? "Syncing…" : "Sync library"}
            </Button>
            <Button
              variant="secondary"
              focusId={INTEGRATIONS_GOG_DISCONNECT_BTN_ID}
              focusNavigationOverrides={{
                up: { type: "item", itemId: INTEGRATIONS_GOG_SYNC_BTN_ID },
                down: { type: "item", itemId: INTEGRATIONS_XBOX_PRIMARY_BTN_ID },
              }}
              onClick={() => void handleDisconnect()}
            >
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="primary"
          loading={isConnecting}
          focusId={INTEGRATIONS_GOG_PRIMARY_BTN_ID}
          focusNavigationOverrides={{
            up: { type: "item", itemId: INTEGRATIONS_EPIC_PRIMARY_BTN_ID },
            down: { type: "item", itemId: INTEGRATIONS_XBOX_PRIMARY_BTN_ID },
          }}
          onClick={() => void handleConnect()}
        >
          {isConnecting ? "Opening GOG login…" : "Connect GOG"}
        </Button>
      )}
    </SettingsSection>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// Xbox / Game Pass
// ────────────────────────────────────────────────────────────────────────────────

function XboxSection() {
  const userPreferences = useUserPreferences();
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const gamertag = userPreferences?.xboxGamertag ?? null;
  const hasGamePass = userPreferences?.xboxHasGamePass ?? false;
  const isSignedIn = Boolean(gamertag);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      const result = await globalThis.window.electron.openXboxAuthWindow();
      if (result?.success) {
        await globalThis.window.electron.updateUserPreferences({
          xboxGamertag: result.gamertag ?? "Xbox User",
          xboxHasGamePass: false,
        });
        showSuccessToast("Xbox signed in", {
          fallbackVisual: "settings",
          message: `Signed in as ${result.gamertag ?? "Xbox User"}.`,
        });
      } else {
        showErrorToast("Xbox sign-in failed", { fallbackVisual: "settings" });
      }
    } catch {
      showErrorToast("Xbox sign-in failed", { fallbackVisual: "settings" });
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await globalThis.window.electron.updateUserPreferences({
      xboxAccessToken: null,
      xboxUserHash: null,
      xboxXstsToken: null,
      xboxTokenExpiry: null,
      xboxGamertag: null,
      xboxHasGamePass: false,
    });
    showSuccessToast("Xbox signed out", { fallbackVisual: "settings" });
  };

  const handleToggleGamePass = async (value: boolean) => {
    await globalThis.window.electron.updateUserPreferences({
      xboxHasGamePass: value,
    });
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await globalThis.window.electron.syncGamePassLibrary();
      showSuccessToast("Xbox library synced", {
        fallbackVisual: "settings",
        message: `Added ${result.added} game${result.added !== 1 ? "s" : ""} (${result.total} total).`,
      });
    } catch {
      showErrorToast("Sync failed", { fallbackVisual: "settings" });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <SettingsSection
      title="Xbox / Game Pass"
      description="Sign in with your Microsoft account to sync your Xbox and Game Pass library."
    >
      {!isSignedIn ? (
        <Button
          variant="primary"
          loading={isSigningIn}
          focusId={INTEGRATIONS_XBOX_PRIMARY_BTN_ID}
          focusNavigationOverrides={{
            up: { type: "item", itemId: INTEGRATIONS_GOG_PRIMARY_BTN_ID },
            down: { type: "item", itemId: INTEGRATIONS_EA_PRIMARY_BTN_ID },
          }}
          onClick={() => void handleSignIn()}
        >
          {isSigningIn ? "Waiting for Xbox login…" : "Sign in with Microsoft"}
        </Button>
      ) : (
        <div>
          <div style={ACCOUNT_CARD_STYLE}>
            <span style={STATUS_STYLE}>{gamertag}</span>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              cursor: "pointer",
              marginBottom: "10px",
            }}
          >
            <input
              type="checkbox"
              checked={hasGamePass}
              onChange={(e) => void handleToggleGamePass(e.target.checked)}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
            <span style={{ fontSize: "0.875rem" }}>I have Game Pass</span>
          </label>

          {hasGamePass && (
            <div style={{ ...ROW_STYLE, marginBottom: "8px" }}>
              <Button
                variant="primary"
                loading={isSyncing}
                focusId={INTEGRATIONS_XBOX_SYNC_BTN_ID}
                focusNavigationOverrides={{
                  up: { type: "item", itemId: INTEGRATIONS_GOG_PRIMARY_BTN_ID },
                  down: { type: "item", itemId: INTEGRATIONS_XBOX_SIGNOUT_BTN_ID },
                }}
                onClick={() => void handleSync()}
              >
                {isSyncing ? "Syncing…" : "Sync Game Pass library"}
              </Button>
            </div>
          )}

          <div style={ROW_STYLE}>
            <Button
              variant="secondary"
              focusId={INTEGRATIONS_XBOX_SIGNOUT_BTN_ID}
              focusNavigationOverrides={{
                up: { type: "item", itemId: INTEGRATIONS_XBOX_SYNC_BTN_ID },
                down: { type: "item", itemId: INTEGRATIONS_EA_PRIMARY_BTN_ID },
              }}
              onClick={() => void handleSignOut()}
            >
              Sign out
            </Button>
          </div>
          <p style={HINT_STYLE}>
            Xbox launches games via the Microsoft Store protocol.
          </p>
        </div>
      )}
    </SettingsSection>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// EA App
// ────────────────────────────────────────────────────────────────────────────────

function EaSection() {
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const result = await globalThis.window.electron.openEaAuthWindow();
      if (!result) {
        showErrorToast("EA sign-in cancelled", { fallbackVisual: "settings" });
        return;
      }
      const syncResult = await globalThis.window.electron.syncEaLibrary();
      showSuccessToast("EA App connected", {
        fallbackVisual: "settings",
        message: `Signed in as ${result.username}. Added ${syncResult.added} game${syncResult.added !== 1 ? "s" : ""}.`,
      });
    } catch {
      showErrorToast("EA sign-in failed", { fallbackVisual: "settings" });
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <SettingsSection
      title="EA App"
      description="Connect EA App to detect and launch your EA games."
    >
      <Button
        variant="primary"
        loading={isConnecting}
        focusId={INTEGRATIONS_EA_PRIMARY_BTN_ID}
        focusNavigationOverrides={{
          up: { type: "item", itemId: INTEGRATIONS_XBOX_PRIMARY_BTN_ID },
          down: { type: "item", itemId: INTEGRATIONS_UBISOFT_PRIMARY_BTN_ID },
        }}
        onClick={() => void handleConnect()}
      >
        {isConnecting ? "Opening EA login…" : "Connect EA App"}
      </Button>
    </SettingsSection>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// Ubisoft Connect
// ────────────────────────────────────────────────────────────────────────────────

function UbisoftSection({ downTarget }: { downTarget: FocusOverrideTarget }) {
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const result = await globalThis.window.electron.openUbisoftAuthWindow();
      if (!result) {
        showErrorToast("Ubisoft sign-in cancelled", {
          fallbackVisual: "settings",
        });
        return;
      }
      const syncResult = await globalThis.window.electron.syncUbisoftLibrary();
      showSuccessToast("Ubisoft connected", {
        fallbackVisual: "settings",
        message: `Signed in as ${result.username}. Added ${syncResult.added} game${syncResult.added !== 1 ? "s" : ""}.`,
      });
    } catch {
      showErrorToast("Ubisoft sign-in failed", { fallbackVisual: "settings" });
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <SettingsSection
      title="Ubisoft Connect"
      description="Connect Ubisoft Connect to detect and launch your Ubisoft games."
    >
      <Button
        variant="primary"
        loading={isConnecting}
        focusId={INTEGRATIONS_UBISOFT_PRIMARY_BTN_ID}
        focusNavigationOverrides={{
          up: { type: "item", itemId: INTEGRATIONS_EA_PRIMARY_BTN_ID },
          down: downTarget,
        }}
        onClick={() => void handleConnect()}
      >
        {isConnecting ? "Opening Ubisoft login…" : "Connect Ubisoft Connect"}
      </Button>
    </SettingsSection>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// Composed section
// ────────────────────────────────────────────────────────────────────────────────

export function PlatformIntegrationsSection({
  className,
  downTarget,
}: Readonly<SettingsSectionProps>) {
  return (
    <div
      className={
        className
          ? `platform-integrations-section ${className}`
          : "platform-integrations-section"
      }
    >
      <SteamSection />
      <EpicSection />
      <GogSection />
      <XboxSection />
      <EaSection />
      <UbisoftSection downTarget={downTarget} />
    </div>
  );
}
