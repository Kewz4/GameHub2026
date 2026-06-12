import { useEffect, useState } from "react";
import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import {
  AlertIcon,
  CheckCircleFillIcon,
  PlusIcon,
} from "@primer/octicons-react";

interface EaGameDef {
  offerId: string | null;
  title: string;
  installDir: string | null;
}

export function SettingsEa() {
  const { showSuccessToast, showErrorToast } = useToast();

  const [clientInstalled, setClientInstalled] = useState<boolean | null>(null);
  const [detected, setDetected] = useState<EaGameDef[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    window.electron
      .getEaGames()
      .then(({ installed, detected: det }) => {
        setClientInstalled(installed);
        setDetected(det);
        setSelected(new Set(det.map((g) => g.title)));
      })
      .catch(() => setClientInstalled(false));
  }, []);

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

  if (clientInstalled === null) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={{ margin: 0, opacity: 0.8 }}>
        Detect games installed through the EA app (or Origin) and add them to
        your library. Games launch through the EA app.
      </p>

      {!clientInstalled && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            opacity: 0.7,
          }}
        >
          <AlertIcon size={16} />
          <span>EA app / Origin is not installed on this machine.</span>
        </div>
      )}

      {clientInstalled && detected.length === 0 && (
        <p style={{ margin: 0, fontSize: "0.875em", opacity: 0.6 }}>
          No installed EA games detected.
        </p>
      )}

      {clientInstalled && detected.length > 0 && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: "8px",
            }}
          >
            {detected.map((game) => {
              const isChecked = selected.has(game.title);

              return (
                <button
                  key={game.title}
                  type="button"
                  onClick={() => toggleGame(game.title)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: `1px solid ${isChecked ? "var(--color-accent, #5e81f4)" : "rgba(255,255,255,0.1)"}`,
                    background: isChecked
                      ? "rgba(94,129,244,0.15)"
                      : "rgba(255,255,255,0.03)",
                    cursor: "pointer",
                    textAlign: "left",
                    color: "inherit",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "0.875em",
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {game.title}
                    </div>
                    <div
                      style={{
                        fontSize: "0.75em",
                        opacity: 0.6,
                        display: "flex",
                        alignItems: "center",
                        gap: "3px",
                      }}
                    >
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
