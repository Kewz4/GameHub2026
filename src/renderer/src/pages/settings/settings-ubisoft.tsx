import { useEffect, useState } from "react";
import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import {
  AlertIcon,
  CheckCircleFillIcon,
  PlusIcon,
} from "@primer/octicons-react";

interface UbisoftGameDef {
  installId: string;
  title: string;
  installDir: string;
  launchUri: string;
}

export function SettingsUbisoft() {
  const { showSuccessToast, showErrorToast } = useToast();

  const [clientInstalled, setClientInstalled] = useState<boolean | null>(null);
  const [detected, setDetected] = useState<UbisoftGameDef[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    window.electron
      .getUbisoftGames()
      .then(({ installed, detected: det }) => {
        setClientInstalled(installed);
        setDetected(det);
        setSelected(new Set(det.map((g) => g.installId)));
      })
      .catch(() => setClientInstalled(false));
  }, []);

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

  if (clientInstalled === null) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={{ margin: 0, opacity: 0.8 }}>
        Detect games installed through Ubisoft Connect and add them to your
        library. Games launch through the Ubisoft Connect client.
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
          <span>Ubisoft Connect is not installed on this machine.</span>
        </div>
      )}

      {clientInstalled && detected.length === 0 && (
        <p style={{ margin: 0, fontSize: "0.875em", opacity: 0.6 }}>
          No installed Ubisoft games detected.
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
              const isChecked = selected.has(game.installId);

              return (
                <button
                  key={game.installId}
                  type="button"
                  onClick={() => toggleGame(game.installId)}
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
