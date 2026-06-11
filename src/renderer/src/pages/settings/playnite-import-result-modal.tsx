import { useState } from "react";
import { Modal } from "@renderer/components";
import { Button } from "@renderer/components";

interface PlayniteImportResult {
  matched: number;
  total: number;
  games: Array<{ title: string; addedHours: number }>;
  unmatched: Array<{ name: string; gameId: string; playtimeHours: number }>;
}

interface Props {
  visible: boolean;
  result: PlayniteImportResult | null;
  onClose: () => void;
}

export function PlayniteImportResultModal({ visible, result, onClose }: Props) {
  const [showUnmatched, setShowUnmatched] = useState(false);

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
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--color-success, #4caf50)" }}>
              {result.matched}
            </div>
            <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>matched</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700, opacity: 0.5 }}>
              {result.unmatched.length}
            </div>
            <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>unmatched</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700, opacity: 0.5 }}>
              {result.total}
            </div>
            <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>total with playtime</div>
          </div>
        </div>

        {result.games.length > 0 && (
          <div>
            <h4 style={{ margin: "0 0 8px", fontSize: "0.9rem" }}>Updated games</h4>
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
                  <span style={{ opacity: 0.7 }}>+{g.addedHours}h</span>
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
              {showUnmatched ? "Hide" : "Show"} {result.unmatched.length} unmatched game
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
