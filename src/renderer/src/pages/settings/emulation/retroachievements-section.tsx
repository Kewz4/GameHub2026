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
  const { showSuccessToast } = useToast();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);

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

  const handleDisconnect = async () => {
    setUsername("");
    setApiKey("");
    await updateUserPreferences({
      retroAchievementsUsername: undefined,
      retroAchievementsApiKey: undefined,
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
            color: "var(--color-accent)",
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

      <div style={{ display: "flex", gap: 8 }}>
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
    </section>
  );
}
