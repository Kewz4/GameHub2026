import { useState } from "react";
import { Modal, Button } from "@renderer/components";

export interface ScannedGame {
  title: string;
  executablePath: string;
  key: string;
}

interface Props {
  visible: boolean;
  foundGames: ScannedGame[];
  onConfirm: (approved: ScannedGame[]) => void;
  onClose: () => void;
}

export function ScanApprovalModal({ visible, foundGames, onConfirm, onClose }: Props) {
  const [approved, setApproved] = useState<Set<string>>(() => new Set(foundGames.map((g) => g.key)));

  const toggle = (key: string) => {
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const approveAll = () => setApproved(new Set(foundGames.map((g) => g.key)));
  const denyAll = () => setApproved(new Set());

  const handleConfirm = () => {
    onConfirm(foundGames.filter((g) => approved.has(g.key)));
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      title={`Scan Results — ${foundGames.length} game${foundGames.length !== 1 ? "s" : ""} found`}
      onClose={onClose}
      large
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {foundGames.length === 0 ? (
          <p style={{ opacity: 0.6, margin: 0 }}>No games were found during the scan.</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={approveAll}
                style={{
                  background: "none",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "4px",
                  padding: "4px 10px",
                  cursor: "pointer",
                  color: "inherit",
                  fontSize: "0.8rem",
                }}
              >
                Approve All
              </button>
              <button
                type="button"
                onClick={denyAll}
                style={{
                  background: "none",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "4px",
                  padding: "4px 10px",
                  cursor: "pointer",
                  color: "inherit",
                  fontSize: "0.8rem",
                  opacity: 0.7,
                }}
              >
                Deny All
              </button>
            </div>
            <div
              style={{
                maxHeight: "320px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              {foundGames.map((g) => (
                <label
                  key={g.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "8px 10px",
                    background: approved.has(g.key)
                      ? "rgba(255,255,255,0.07)"
                      : "rgba(255,255,255,0.02)",
                    borderRadius: "6px",
                    cursor: "pointer",
                    opacity: approved.has(g.key) ? 1 : 0.45,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={approved.has(g.key)}
                    onChange={() => toggle(g.key)}
                    style={{ accentColor: "var(--color-primary, #8c67ef)", width: "16px", height: "16px" }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", overflow: "hidden" }}>
                    <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>{g.title}</span>
                    <span
                      style={{
                        fontSize: "0.74rem",
                        opacity: 0.5,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {g.executablePath}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <Button type="button" theme="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm}>
            Add {approved.size} game{approved.size !== 1 ? "s" : ""} to library
          </Button>
        </div>
      </div>
    </Modal>
  );
}
