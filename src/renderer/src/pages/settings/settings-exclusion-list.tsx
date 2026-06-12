import { useCallback, useEffect, useState } from "react";
import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { ExcludedGame } from "@types";

export function SettingsExclusionList() {
  const { showSuccessToast, showErrorToast } = useToast();
  const [excludedGames, setExcludedGames] = useState<ExcludedGame[]>([]);
  const [loading, setLoading] = useState(true);

  const loadList = useCallback(async () => {
    try {
      const list = await window.electron.getExclusionList();
      setExcludedGames(list);
    } catch {
      setExcludedGames([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const handleRemove = async (game: ExcludedGame) => {
    try {
      const updated = await window.electron.removeGameFromExclusionList(
        game.shop as never,
        game.objectId
      );
      setExcludedGames(updated);
      showSuccessToast(
        "Exclusion List",
        `"${game.title}" can be imported again on the next sync.`
      );
    } catch {
      showErrorToast("Exclusion List", "Failed to remove game from list.");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <p style={{ margin: 0, fontSize: "0.875rem", opacity: 0.7 }}>
        Games on this list are skipped by platform syncs and installed-game
        scans. Removing a synced game from your library adds it here
        automatically so it doesn't come back.
      </p>

      {loading ? (
        <p style={{ margin: 0, fontSize: "0.875rem", opacity: 0.5 }}>
          Loading…
        </p>
      ) : excludedGames.length === 0 ? (
        <p style={{ margin: 0, fontSize: "0.875rem", opacity: 0.5 }}>
          No excluded games.
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {excludedGames.map((game) => (
            <li
              key={`${game.shop}:${game.objectId}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                padding: "8px 12px",
                background: "rgba(255,255,255,0.05)",
                borderRadius: "6px",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.875rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {game.title}
                </p>
                <p style={{ margin: 0, fontSize: "0.75rem", opacity: 0.5 }}>
                  {game.shop.toUpperCase()} · excluded{" "}
                  {new Date(game.excludedAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                type="button"
                theme="outline"
                onClick={() => handleRemove(game)}
              >
                Allow again
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
