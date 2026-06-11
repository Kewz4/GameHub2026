import { useState } from "react";
import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import { PlayniteImportResultModal } from "./playnite-import-result-modal";

type ImportResult = {
  matched: number;
  total: number;
  games: Array<{ title: string; addedHours: number }>;
  unmatched: Array<{ name: string; gameId: string; playtimeHours: number }>;
};

export function SettingsPlayniteImport() {
  const { showSuccessToast, showErrorToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [modalResult, setModalResult] = useState<ImportResult | null>(null);

  const runImport = async (dbPath?: string) => {
    setBusy(true);
    setProgress(0);
    // Simulate progress since the import is async without streaming
    const tick = setInterval(() => {
      setProgress((p) => (p < 85 ? p + 5 : p));
    }, 400);
    try {
      const res = await window.electron.importPlaynitePlaytime(dbPath);
      clearInterval(tick);
      setProgress(100);
      if (res.total === 0) {
        showErrorToast(
          "Playnite Import",
          "No Playnite games with playtime found. Make sure Playnite is installed."
        );
      } else {
        setModalResult(res);
        if (res.matched > 0) {
          showSuccessToast(
            "Playnite Import",
            `Updated playtime for ${res.matched} game${res.matched !== 1 ? "s" : ""}.`
          );
        }
      }
    } catch {
      clearInterval(tick);
      showErrorToast("Playnite Import", "Failed to read Playnite database.");
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(0), 600);
    }
  };

  const handleAutoImport = () => runImport();

  const handleBrowse = async () => {
    const res = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "LiteDB Database", extensions: ["db"] }],
    });
    if (!res || res.canceled || !res.filePaths[0]) return;
    runImport(res.filePaths[0]);
  };

  return (
    <>
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
        {busy && (
          <div
            style={{
              height: "4px",
              background: "rgba(255,255,255,0.12)",
              borderRadius: "2px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress}%`,
                background: "var(--color-primary, #8c67ef)",
                borderRadius: "2px",
                transition: "width 0.35s ease",
              }}
            />
          </div>
        )}
      </div>

      <PlayniteImportResultModal
        visible={modalResult !== null}
        result={modalResult}
        onClose={() => setModalResult(null)}
      />
    </>
  );
}
