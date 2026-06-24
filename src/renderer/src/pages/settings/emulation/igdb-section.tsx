import { useContext, useEffect, useState } from "react";
import { Button } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.04)",
  color: "inherit",
  fontSize: "0.875em",
};

export function IgdbSection() {
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast } = useToast();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setClientId(userPreferences?.igdbClientId ?? "");
    setClientSecret(userPreferences?.igdbClientSecret ?? "");
  }, [userPreferences?.igdbClientId, userPreferences?.igdbClientSecret]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateUserPreferences({
        igdbClientId: clientId.trim() || undefined,
        igdbClientSecret: clientSecret.trim() || undefined,
      });
      showSuccessToast("IGDB credentials saved");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section
      className="settings-emulation__retroachievements"
      style={{ maxWidth: 640, marginBottom: 24 }}
    >
      <h3 style={{ margin: "0 0 4px" }}>IGDB Metadata</h3>
      <p style={{ margin: "0 0 12px", opacity: 0.65, fontSize: "0.875em" }}>
        IGDB enriches imported ROMs with descriptions, release dates, genres and
        developer info. This works out of the box — these fields are{" "}
        <strong>optional</strong> and only needed if you want to use your own
        Twitch application instead of the built-in one. Get credentials at{" "}
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
            window.electron.openExternal("https://dev.twitch.tv/console/apps")
          }
        >
          dev.twitch.tv
        </button>
        .
      </p>

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
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="IGDB Client ID"
          spellCheck={false}
          autoComplete="off"
          style={inputStyle}
        />
        <input
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder="IGDB Client Secret"
          spellCheck={false}
          autoComplete="off"
          style={inputStyle}
        />
      </div>

      <Button
        type="button"
        onClick={handleSave}
        disabled={isSaving || !clientId.trim() || !clientSecret.trim()}
      >
        {isSaving ? "Saving..." : "Save"}
      </Button>
    </section>
  );
}
