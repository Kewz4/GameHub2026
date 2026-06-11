import { useState } from "react";
import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";

export function SettingsPlayniteImport() {
  const { showSuccessToast, showErrorToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");

  const handleAutoImport = async () => {
    setBusy(true);
    setResult("");
    try {
      const res = await window.electron.importPlaynitePlaytime();
      if (res.matched === 0) {
        setResult(
          res.total === 0
            ? "No Playnite games with playtime found. Make sure Playnite is installed."
            : `No matching games found (${res.total} Playnite games scanned).`
        );
      } else {
        setResult(
          `Imported playtime for ${res.matched} game${res.matched !== 1 ? "s" : ""}.`
        );
        showSuccessToast(
          "Playnite Import",
          `Updated playtime for ${res.matched} game${res.matched !== 1 ? "s" : ""}.`
        );
      }
    } catch {
      showErrorToast("Playnite Import", "Failed to read Playnite database.");
    } finally {
      setBusy(false);
    }
  };

  const handleBrowse = async () => {
    const res = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "LiteDB Database", extensions: ["db"] }],
    });
    if (!res || res.canceled || !res.filePaths[0]) return;
    setBusy(true);
    setResult("");
    try {
      const importRes = await window.electron.importPlaynitePlaytime(
        res.filePaths[0]
      );
      if (importRes.matched === 0) {
        setResult(
          importRes.total === 0
            ? "No Playnite games with playtime found."
            : `No matching games found (${importRes.total} Playnite games scanned).`
        );
      } else {
        setResult(
          `Imported playtime for ${importRes.matched} game${importRes.matched !== 1 ? "s" : ""}.`
        );
        showSuccessToast(
          "Playnite Import",
          `Updated playtime for ${importRes.matched} game${importRes.matched !== 1 ? "s" : ""}.`
        );
      }
    } catch {
      showErrorToast("Playnite Import", "Failed to read Playnite database.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <p style={{ margin: 0, fontSize: "0.875rem", opacity: 0.7 }}>
        Import your playtime hours from Playnite. Auto-detect reads from{" "}
        <code style={{ fontSize: "0.78rem" }}>
          %AppData%\Playnite\library\games.db
        </code>
        .
      </p>
      <div style={{ display: "flex", gap: "8px" }}>
        <Button type="button" onClick={handleAutoImport} disabled={busy}>
          {busy ? "Importing…" : "Auto-detect & Import"}
        </Button>
        <Button
          type="button"
          theme="outline"
          onClick={handleBrowse}
          disabled={busy}
        >
          Browse…
        </Button>
      </div>
      {result && (
        <p style={{ margin: 0, fontSize: "0.82rem", opacity: 0.75 }}>
          {result}
        </p>
      )}
    </div>
  );
}
