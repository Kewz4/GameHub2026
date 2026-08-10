import { useContext, useEffect, useState } from "react";
import { Button } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import { CheckCircleFillIcon } from "@primer/octicons-react";

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.04)",
  color: "inherit",
  fontSize: "0.875em",
};

export function RetroAchievementsSection() {
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [password, setPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    setUsername(userPreferences?.retroAchievementsUsername ?? "");
    setApiKey(userPreferences?.retroAchievementsApiKey ?? "");
  }, [
    userPreferences?.retroAchievementsUsername,
    userPreferences?.retroAchievementsApiKey,
  ]);

  const isConnected =
    Boolean(userPreferences?.retroAchievementsUsername) &&
    Boolean(userPreferences?.retroAchievementsApiKey);

  // Whether the emulator itself is signed in (a login token is stored), so
  // RALibretro is authenticated without prompting.
  const emulatorSignedIn = Boolean(userPreferences?.retroAchievementsToken);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateUserPreferences({
        retroAchievementsUsername: username.trim() || undefined,
        retroAchievementsApiKey: apiKey.trim() || undefined,
      });
      showSuccessToast("RetroAchievements credentials saved");
    } finally {
      setIsSaving(false);
    }
  };

  // Exchange the password for a login token (the password is never stored) and
  // save it, so setup can inject it into RALibretro's config silently.
  const handleEmulatorSignIn = async () => {
    if (!username.trim() || !password) {
      showErrorToast("Enter your RetroAchievements username and password.");
      return;
    }
    setIsSigningIn(true);
    try {
      const result = await window.electron.loginRetroAchievements(
        username.trim(),
        password
      );
      if (result.success && result.token) {
        await updateUserPreferences({
          retroAchievementsUsername: username.trim(),
          retroAchievementsToken: result.token,
        });
        // Push the login straight into an already-installed RALibretro so it
        // takes effect now, not only on the next install.
        await window.electron.syncRalibretroLogin().catch(() => {});
        setPassword("");
        showSuccessToast(
          "Signed in to RetroAchievements — the emulator will log in automatically."
        );
      } else {
        showErrorToast(result.error ?? "Sign-in failed.");
      }
    } catch {
      showErrorToast("Couldn't reach RetroAchievements.");
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleDisconnect = async () => {
    setUsername("");
    setApiKey("");
    setPassword("");
    await updateUserPreferences({
      retroAchievementsUsername: undefined,
      retroAchievementsApiKey: undefined,
      retroAchievementsToken: undefined,
    });
    showSuccessToast("RetroAchievements disconnected");
  };

  return (
    <section
      className="settings-emulation__retroachievements"
      style={{ maxWidth: 640, marginBottom: 24 }}
    >
      <h3 style={{ margin: "0 0 4px" }}>RetroAchievements</h3>
      <p style={{ margin: "0 0 12px", opacity: 0.65, fontSize: "0.875em" }}>
        Log into RetroAchievements inside your emulator to earn achievements.
        Enter your RA username and web API key here so unlocks pop up as
        notifications and appear on the game&apos;s achievements page while you
        play. Find your API key at{" "}
        <button
          type="button"
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "var(--color-text-bright)",
            cursor: "pointer",
            fontSize: "inherit",
            textDecoration: "underline",
            textUnderlineOffset: "2px",
          }}
          onClick={() =>
            window.electron.openExternal(
              "https://retroachievements.org/settings"
            )
          }
        >
          retroachievements.org/settings
        </button>
        .
      </p>

      {isConnected && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <CheckCircleFillIcon size={14} />
          <strong>
            Connected as {userPreferences?.retroAchievementsUsername}
          </strong>
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="RetroAchievements username"
          spellCheck={false}
          autoComplete="off"
          style={inputStyle}
        />
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Web API key"
          spellCheck={false}
          autoComplete="off"
          style={inputStyle}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <Button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !username.trim() || !apiKey.trim()}
        >
          {isSaving ? "Saving…" : "Save"}
        </Button>
        {isConnected && (
          <Button type="button" theme="outline" onClick={handleDisconnect}>
            Disconnect
          </Button>
        )}
      </div>

      <div
        style={{
          borderTop: "1px solid rgba(255,255,255,0.1)",
          paddingTop: 16,
        }}
      >
        <h4 style={{ margin: "0 0 4px", display: "flex", gap: 8 }}>
          Emulator sign-in
          {emulatorSignedIn && <CheckCircleFillIcon size={14} />}
        </h4>
        <p style={{ margin: "0 0 12px", opacity: 0.65, fontSize: "0.875em" }}>
          {emulatorSignedIn
            ? "The emulator is signed in — RALibretro logs into RetroAchievements automatically, no prompt. Re-enter your password to refresh it."
            : "Enter your password once so the emulator (RALibretro) signs in to RetroAchievements automatically and never prompts you. Your password is exchanged for a login token and is not stored."}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="RetroAchievements password"
            spellCheck={false}
            autoComplete="off"
            style={inputStyle}
          />
          <Button
            type="button"
            onClick={handleEmulatorSignIn}
            disabled={isSigningIn || !username.trim() || !password}
          >
            {isSigningIn ? "Signing in…" : "Sign in"}
          </Button>
        </div>
      </div>
    </section>
  );
}
