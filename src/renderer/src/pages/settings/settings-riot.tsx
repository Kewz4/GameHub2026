import { useEffect, useState } from "react";
import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import {
  AlertIcon,
  CheckCircleFillIcon,
  PlusIcon,
} from "@primer/octicons-react";

interface RiotGameDef {
  productId: string;
  patchline: string;
  title: string;
}

export function SettingsRiot() {
  const { showSuccessToast, showErrorToast } = useToast();

  const [clientInstalled, setClientInstalled] = useState<boolean | null>(null);
  const [allGames, setAllGames] = useState<RiotGameDef[]>([]);
  const [detected, setDetected] = useState<RiotGameDef[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    window.electron
      .getRiotGames()
      .then(({ installed, detected: det, all }) => {
        setClientInstalled(installed);
        setDetected(det);
        setAllGames(all);
        setSelected(new Set(det.map((g) => g.productId)));
      })
      .catch(() => setClientInstalled(false));
  }, []);

  const toggleGame = (productId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const handleAddToLibrary = async () => {
    if (selected.size === 0) return;
    setIsAdding(true);
    try {
      const result = await window.electron.addRiotGamesToLibrary(
        Array.from(selected)
      );
      showSuccessToast(
        "Riot Games",
        `Added ${result.added} game${result.added !== 1 ? "s" : ""} to your library.`
      );
    } catch {
      showErrorToast("Riot Games", "Failed to add games to library.");
    } finally {
      setIsAdding(false);
    }
  };

  if (clientInstalled === null) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={{ margin: 0, opacity: 0.8 }}>
        Add your Riot Games titles (League of Legends, VALORANT, Legends of
        Runeterra) to the library. Games launch through the Riot Client.
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
          <span>
            Riot Client not detected. Install a Riot game first, then come back
            here.
          </span>
        </div>
      )}

      {clientInstalled && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: "8px",
            }}
          >
            {allGames.map((game) => {
              const isDetected = detected.some(
                (d) => d.productId === game.productId
              );
              const isChecked = selected.has(game.productId);

              return (
                <button
                  key={game.productId}
                  type="button"
                  onClick={() => toggleGame(game.productId)}
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
                    {isDetected && (
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
                    )}
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
