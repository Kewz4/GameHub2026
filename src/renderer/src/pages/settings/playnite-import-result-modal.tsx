import { useState } from "react";
import { Modal } from "@renderer/components";
import { Button } from "@renderer/components";

interface PlayniteImportResult {
  matched: number;
  total: number;
  cloudSynced: number;
  cloudSyncPending: number;
  games: Array<{
    title: string;
    previousHours: number;
    playniteHours: number;
    changeHours: number;
  }>;
  preserved: Array<{
    title: string;
    existingHours: number;
    playniteHours: number;
  }>;
  unmatched: Array<{ name: string; gameId: string; playtimeHours: number }>;
  cached: Array<{
    title: string;
    playtimeHours: number;
    catalogueMatched: boolean;
  }>;
}

interface Props {
  visible: boolean;
  result: PlayniteImportResult | null;
  onClose: () => void;
}

export function PlayniteImportResultModal({ visible, result, onClose }: Props) {
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [showPreserved, setShowPreserved] = useState(false);

  if (!result) return null;

  return (
    <Modal
      visible={visible}
      title="Playnite Import Results"
      onClose={onClose}
      large
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", gap: "24px" }}>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: "2rem",
                fontWeight: 700,
                color: "var(--color-success, #4caf50)",
              }}
            >
              {result.matched}
            </div>
            <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>updated</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700, opacity: 0.7 }}>
              {result.preserved.length}
            </div>
            <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>protected</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700, opacity: 0.5 }}>
              {result.cached.length}
            </div>
            <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>
              saved for later
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700, opacity: 0.5 }}>
              {result.unmatched.length}
            </div>
            <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>unmatched</div>
          </div>
        </div>

        {result.matched > 0 && (
          <p
            role="status"
            style={{ margin: 0, fontSize: "0.82rem", opacity: 0.72 }}
          >
            {result.cloudSynced} absolute playtime correction
            {result.cloudSynced === 1 ? "" : "s"} confirmed by the Hydra API
            profile service.
            {result.cloudSyncPending > 0
              ? ` ${result.cloudSyncPending} will retry automatically when the cloud connection is available.`
              : ""}
          </p>
        )}

        {result.games.length > 0 && (
          <div>
            <h4 style={{ margin: "0 0 8px", fontSize: "0.9rem" }}>
              Updated games
            </h4>
            <div
              style={{
                maxHeight: "200px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              {result.games.map((g, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.85rem",
                    padding: "4px 8px",
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: "4px",
                  }}
                >
                  <span>{g.title}</span>
                  <span style={{ opacity: 0.7 }}>
                    {g.previousHours}h → {g.playniteHours}h
                    {g.changeHours !== 0
                      ? ` (${g.changeHours > 0 ? "+" : ""}${g.changeHours}h)`
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {result.preserved.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowPreserved((value) => !value)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "inherit",
                opacity: 0.7,
                fontSize: "0.85rem",
                padding: 0,
                textDecoration: "underline",
              }}
            >
              {showPreserved ? "Hide" : "Show"} {result.preserved.length}{" "}
              protected or already-current game
              {result.preserved.length !== 1 ? "s" : ""}
            </button>
            {showPreserved && (
              <div
                style={{
                  maxHeight: "180px",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  marginTop: "8px",
                }}
              >
                {result.preserved.map((game) => (
                  <div
                    key={`${game.title}:${game.existingHours}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "0.82rem",
                      padding: "4px 8px",
                      background: "rgba(255,255,255,0.04)",
                      borderRadius: "4px",
                    }}
                  >
                    <span>{game.title}</span>
                    <span style={{ opacity: 0.7 }}>
                      kept {game.existingHours}h · Playnite {game.playniteHours}
                      h
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {result.cached.length > 0 && (
          <div>
            <h4 style={{ margin: "0 0 4px", fontSize: "0.9rem" }}>
              Saved for later
            </h4>
            <p style={{ margin: "0 0 8px", fontSize: "0.78rem", opacity: 0.6 }}>
              These games aren&apos;t in your library, so they weren&apos;t
              added. Their playtime is saved and will apply automatically if you
              add them later.
            </p>
            <div
              style={{
                maxHeight: "200px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              {result.cached.map((g, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.85rem",
                    padding: "4px 8px",
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: "4px",
                  }}
                >
                  <span>{g.title}</span>
                  <span style={{ opacity: 0.7 }}>
                    {g.playtimeHours}h ·{" "}
                    {g.catalogueMatched ? "catalogue" : "local match pending"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {result.unmatched.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowUnmatched((v) => !v)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "inherit",
                opacity: 0.6,
                fontSize: "0.85rem",
                padding: 0,
                textDecoration: "underline",
              }}
            >
              {showUnmatched ? "Hide" : "Show"} {result.unmatched.length}{" "}
              unmatched game
              {result.unmatched.length !== 1 ? "s" : ""}
            </button>
            {showUnmatched && (
              <div
                style={{
                  maxHeight: "180px",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  marginTop: "8px",
                }}
              >
                {result.unmatched.map((g, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "0.82rem",
                      padding: "4px 8px",
                      background: "rgba(255,255,255,0.04)",
                      borderRadius: "4px",
                      opacity: 0.7,
                    }}
                  >
                    <span>{g.name}</span>
                    <span>{g.playtimeHours}h</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
