import { useContext, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Info,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { Button, SelectField, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type {
  MusicProvider,
  SpotifyProviderError,
  SpotifyStatus,
} from "@types";
import SpotifyIcon from "@renderer/assets/icons/spotify.svg?react";

import "./settings-spotify.scss";

const DASHBOARD_URL = "https://developer.spotify.com/dashboard";
const PKCE_DOCS_URL =
  "https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow";
const REDIRECT_DOCS_URL =
  "https://developer.spotify.com/documentation/web-api/concepts/redirect_uri";
const FALLBACK_REDIRECT_URI = "http://127.0.0.1/callback";

const errorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
      .replace(/^Error invoking remote method '[^']+':\s*/i, "")
      .replace(/^Error:\s*/i, "");
  }
  return "Spotify could not complete the request.";
};

const statusErrorMessage = (error: SpotifyProviderError | null | undefined) => {
  if (!error) return null;
  return error.message;
};

const storageLabel = (status: SpotifyStatus | null) => {
  if (!status) return "Checking";
  if (status.secureStorage === "available") return "OS credential storage";
  if (status.secureStorage === "linux-basic-text")
    return "Linux keyring required";
  return "Unavailable";
};

export function SettingsSpotify() {
  const { updateUserPreferences } = useContext(settingsContext);
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const [clientId, setClientId] = useState("");
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  // First-time setup requires a personal Spotify Development Mode app, so keep
  // the walkthrough visible by default instead of leaving users at a disabled
  // Connect button with no explanation.
  const [showGuide, setShowGuide] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  const refreshStatus = async () => {
    const nextStatus = await window.electron.spotifyGetStatus();
    setStatus(nextStatus);
    return nextStatus;
  };

  useEffect(() => {
    setClientId(userPreferences?.spotifyClientId ?? "");
  }, [userPreferences?.spotifyClientId]);

  useEffect(() => {
    let cancelled = false;
    window.electron
      .spotifyGetStatus()
      .then((nextStatus) => {
        if (!cancelled) setStatus(nextStatus);
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const redirectUri = status?.redirectUri ?? FALLBACK_REDIRECT_URI;
  const provider = userPreferences?.musicProvider ?? "gamehub";
  const secureStorageBlocked =
    status !== null && status.secureStorage !== "available";
  const effectiveError = error ?? statusErrorMessage(status?.lastError) ?? null;

  const reconnectDate = useMemo(() => {
    if (!status?.reauthorizationAt) return "After connection";
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(status.reauthorizationAt);
  }, [status?.reauthorizationAt]);

  const saveClientId = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateUserPreferences({
        spotifyClientId: clientId.trim() || null,
      });
      await refreshStatus();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateUserPreferences({
        spotifyClientId: clientId.trim() || null,
      });
      const nextStatus = await window.electron.spotifyLogin();
      setStatus(nextStatus);
      if (nextStatus.connected) {
        await window.electron.musicPause();
        await updateUserPreferences({ musicProvider: "spotify" });
      }
    } catch (cause) {
      setError(errorMessage(cause));
      await refreshStatus().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await window.electron.spotifyLogout());
      if (provider === "spotify") {
        await updateUserPreferences({ musicProvider: "gamehub" });
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const changeProvider = async (nextProvider: MusicProvider) => {
    setError(null);
    if (nextProvider === "spotify" && !status?.connected) {
      setError("Connect Spotify before selecting it as the music provider.");
      return;
    }
    if (nextProvider === "spotify") await window.electron.musicPause();
    await updateUserPreferences({ musicProvider: nextProvider });
  };

  const copyRedirectUri = async () => {
    await window.electron.clipboard.writeText(redirectUri);
    setCopiedRedirect(true);
    window.setTimeout(() => setCopiedRedirect(false), 2500);
  };

  return (
    <div className="settings-spotify">
      <div className="settings-spotify__identity">
        <SpotifyIcon aria-label="Spotify" />
        <div>
          <strong>Spotify Connect</strong>
          <span>Experimental personal setup</span>
        </div>
      </div>

      <p className="settings-spotify__copy">
        GameHub can browse your authorized Spotify library and remotely control
        an existing Spotify app or device. Spotify remains a separate provider:
        its audio is not streamed through GameHub or added to the GameHub music
        queue.
      </p>

      <div className="settings-spotify__status" aria-live="polite">
        <div
          className={`settings-spotify__status-card${
            status?.connected ? " settings-spotify__status-card--connected" : ""
          }`}
        >
          <span>Connection</span>
          <strong>
            {status?.connected
              ? status.account?.displayName || "Connected"
              : status?.needsReauth
                ? "Reconnect required"
                : "Not connected"}
          </strong>
        </div>
        <div className="settings-spotify__status-card">
          <span>Token protection</span>
          <strong>{storageLabel(status)}</strong>
        </div>
        <div className="settings-spotify__status-card">
          <span>Reconnect by</span>
          <strong>{reconnectDate}</strong>
        </div>
        <div className="settings-spotify__status-card">
          <span>Playback</span>
          <strong>Spotify Connect device</strong>
        </div>
      </div>

      <SelectField
        label="Music provider"
        value={provider}
        options={[
          {
            key: "gamehub",
            value: "gamehub",
            label: "GameHub Music (default)",
          },
          {
            key: "spotify",
            value: "spotify",
            label: "Spotify Connect (experimental)",
          },
        ]}
        onChange={(event) =>
          void changeProvider(event.target.value as MusicProvider)
        }
      />

      <TextField
        label="Spotify Client ID"
        value={clientId}
        onChange={(event) => setClientId(event.target.value)}
        placeholder="Paste the public Client ID"
        autoComplete="off"
        spellCheck={false}
        hint="The Client ID is public. GameHub never asks for or stores a client secret."
        rightContent={
          <Button
            type="button"
            theme="outline"
            disabled={busy}
            onClick={() => void saveClientId()}
          >
            Save
          </Button>
        }
      />

      <div className="settings-spotify__actions">
        {status?.connected ? (
          <>
            <Button type="button" theme="outline" disabled>
              Connected
            </Button>
            <Button
              type="button"
              theme="outline"
              disabled={busy || secureStorageBlocked}
              onClick={() => void connect()}
            >
              Reconnect
            </Button>
            <Button
              type="button"
              theme="danger"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              Disconnect
            </Button>
          </>
        ) : (
          <Button
            type="button"
            disabled={busy || secureStorageBlocked || !clientId.trim()}
            onClick={() => void connect()}
          >
            {busy ? "Connecting" : "Connect Spotify"}
          </Button>
        )}
      </div>

      {effectiveError && (
        <p
          className="settings-spotify__notice settings-spotify__notice--error"
          role="alert"
        >
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{effectiveError}</span>
        </p>
      )}

      {secureStorageBlocked && !effectiveError && (
        <p
          className="settings-spotify__notice settings-spotify__notice--error"
          role="alert"
        >
          <TriangleAlert size={16} aria-hidden="true" />
          <span>
            {status?.secureStorage === "linux-basic-text"
              ? "Spotify connection is blocked because Electron selected the insecure basic_text backend. Configure and unlock Secret Service or KWallet, then restart GameHub."
              : "Spotify connection is blocked until the operating system credential store is available. GameHub will not save OAuth tokens in plaintext."}
          </span>
        </p>
      )}

      <p className="settings-spotify__notice">
        <Info size={16} aria-hidden="true" />
        <span>
          Remote playback commands require Spotify Premium and an available
          Spotify device. Development Mode also requires a Premium app owner and
          allows up to five explicitly allowlisted users. GameHub falls back to
          its built-in music provider when Spotify is disconnected.
        </span>
      </p>

      <p className="settings-spotify__notice">
        <ShieldCheck size={16} aria-hidden="true" />
        <span>
          GameHub only sends Spotify Connect control commands. While Spotify is
          the selected provider, GameHub automatically disables system-audio
          capture so Spotify music cannot enter gameplay recordings or Instant
          Replay. Video capture remains available.
        </span>
      </p>

      <button
        type="button"
        className="settings-spotify__guide-toggle"
        aria-expanded={showGuide}
        onClick={() => setShowGuide((visible) => !visible)}
      >
        {showGuide ? (
          <ChevronDown size={15} aria-hidden="true" />
        ) : (
          <ChevronRight size={15} aria-hidden="true" />
        )}
        Spotify app setup guide
      </button>

      {showGuide && (
        <section className="settings-spotify__guide">
          <ol>
            <li>
              Open the <strong>Spotify Developer Dashboard</strong> and create a
              personal app. Under the APIs used by the app, select{" "}
              <strong>Web API</strong>. GameHub does not use the Web Playback
              SDK.
            </li>
            <li>
              Add this redirect URI exactly:
              <span className="settings-spotify__copy-row">
                <code>{redirectUri}</code>
                <button
                  type="button"
                  onClick={() => void copyRedirectUri()}
                  aria-label="Copy Spotify redirect URI"
                >
                  {copiedRedirect ? (
                    <Check size={12} aria-hidden="true" />
                  ) : (
                    <Copy size={12} aria-hidden="true" />
                  )}
                  {copiedRedirect ? "Copied" : "Copy"}
                </button>
              </span>
              Use the numeric loopback address, not <code>localhost</code>, and
              do not add a port to the registered URI.
            </li>
            <li>
              In <strong>Users and Access</strong>, allowlist every Spotify
              account that will connect. Development Mode currently permits up
              to five users, and the app owner must have Premium.
            </li>
            <li>
              Copy the app&apos;s public Client ID into GameHub, select{" "}
              <strong>Save</strong>, then select{" "}
              <strong>Connect Spotify</strong>. Never paste a client secret.
            </li>
            <li>
              Open Spotify on the PC, console, phone, or speaker and start
              playback once. The GameHub player can then select that available
              device and send remote commands.
            </li>
          </ol>
          <p className="settings-spotify__copy">
            Spotify currently allows up to 25 Client IDs per developer account,
            with Web API quota shared across that account. A quota error is not
            fixed by reconnecting; wait for the quota window or use an app under
            another developer account.
          </p>
          <p className="settings-spotify__copy">
            Development Mode does not provide Spotify&apos;s recommendations,
            radio, or editorial browse endpoints. Playlist item reads are
            limited to playlists the connected user owns or collaborates on.
            GameHub still exposes authorized search, library, top and recent
            items, podcasts and episodes, the playback queue, and available
            devices.
          </p>
          <div className="settings-spotify__guide-links">
            <button
              type="button"
              onClick={() => void window.electron.openExternal(DASHBOARD_URL)}
            >
              Developer Dashboard
              <ExternalLink size={12} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void window.electron.openExternal(PKCE_DOCS_URL)}
            >
              PKCE setup
              <ExternalLink size={12} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() =>
                void window.electron.openExternal(REDIRECT_DOCS_URL)
              }
            >
              Redirect URI rules
              <ExternalLink size={12} aria-hidden="true" />
            </button>
          </div>
          <span className="sr-only" role="status" aria-live="polite">
            {copiedRedirect ? "Spotify redirect URI copied." : ""}
          </span>
        </section>
      )}

      <details>
        <summary>Authorized Web API scopes</summary>
        <ul className="settings-spotify__scopes">
          {(status?.scopes ?? []).map((scope) => (
            <li key={scope}>{scope}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
