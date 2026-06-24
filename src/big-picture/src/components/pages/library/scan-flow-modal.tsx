import { useCallback, useEffect, useState } from "react";
import { Button, Modal } from "../../common";
import {
  XIcon,
  FolderOpenIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";

type ScanMode = "deep" | "selective";
type Stage = "configure" | "scanning" | "approve";

export interface FoundGame {
  title: string;
  executablePath: string;
  key: string;
  isNew?: boolean;
}

interface ScanProgress {
  scanned: number;
  total: number;
  foundCount: number;
  currentTitle: string;
}

interface ScanFlowModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirmed: (approved: FoundGame[]) => void;
}

export function ScanFlowModal({
  visible,
  onClose,
  onConfirmed,
}: Readonly<ScanFlowModalProps>) {
  const [stage, setStage] = useState<Stage>("configure");
  const [mode, setMode] = useState<ScanMode>("deep");
  const [folderPaths, setFolderPaths] = useState<string[]>([]);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [candidates, setCandidates] = useState<FoundGame[]>([]);
  const [approved, setApproved] = useState<Set<string>>(new Set());

  // Reset to configure stage each time the modal opens
  useEffect(() => {
    if (visible) {
      setStage("configure");
      setProgress(null);
      setCandidates([]);
      setApproved(new Set());
    }
  }, [visible]);

  // Re-initialize approval set when candidates arrive
  useEffect(() => {
    setApproved(new Set(candidates.map((g) => g.key)));
  }, [candidates]);

  useEffect(() => {
    if (stage !== "scanning") return;

    const unsubscribe = globalThis.window.electron.onScanProgress((p) => {
      setProgress(p);
    });

    return () => unsubscribe();
  }, [stage]);

  const handleStartScan = useCallback(async () => {
    setStage("scanning");
    setProgress(null);

    try {
      let result;
      if (mode === "selective" && folderPaths.length > 0) {
        result = await globalThis.window.electron.selectiveScanInstalledGames(
          folderPaths,
          true
        );
      } else {
        result = await globalThis.window.electron.scanInstalledGames(true);
      }

      if (result.foundGames.length > 0) {
        setCandidates(result.foundGames);
        setStage("approve");
      } else {
        // Nothing found — show approval stage with empty list so user sees feedback
        setCandidates([]);
        setStage("approve");
      }
    } catch {
      setStage("configure");
    } finally {
      setProgress(null);
    }
  }, [mode, folderPaths]);

  const handleAddFolder = async () => {
    const result = await globalThis.window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      setFolderPaths((prev) => {
        const next = [...prev];
        for (const p of result.filePaths) {
          if (!next.includes(p)) next.push(p);
        }
        return next;
      });
    }
  };

  const toggleApproval = (key: string) => {
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleConfirm = () => {
    onConfirmed(candidates.filter((g) => approved.has(g.key)));
  };

  const title =
    stage === "configure"
      ? "Scan for Games"
      : stage === "scanning"
        ? "Scanning…"
        : `Found ${candidates.length} game${candidates.length !== 1 ? "s" : ""}`;

  const canClose = stage !== "scanning";

  return (
    <Modal
      visible={visible}
      title={title}
      onClose={canClose ? onClose : () => {}}
      closeOnB={canClose}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* ── Stage: configure ─────────────────────────────────────────── */}
        {stage === "configure" && (
          <>
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                type="button"
                onClick={() => setMode("deep")}
                style={{
                  flex: 1,
                  padding: "14px",
                  borderRadius: "8px",
                  border: `2px solid ${mode === "deep" ? "var(--color-primary, #8c67ef)" : "rgba(255,255,255,0.15)"}`,
                  background:
                    mode === "deep"
                      ? "rgba(140,103,239,0.12)"
                      : "rgba(255,255,255,0.04)",
                  color: "inherit",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "4px",
                  }}
                >
                  <MagnifyingGlassIcon size={18} />
                  <strong style={{ fontSize: "0.9rem" }}>Deep Scan</strong>
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.78rem",
                    opacity: 0.6,
                    lineHeight: 1.4,
                  }}
                >
                  Scans your entire PC for games, skipping official store
                  folders.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setMode("selective")}
                style={{
                  flex: 1,
                  padding: "14px",
                  borderRadius: "8px",
                  border: `2px solid ${mode === "selective" ? "var(--color-primary, #8c67ef)" : "rgba(255,255,255,0.15)"}`,
                  background:
                    mode === "selective"
                      ? "rgba(140,103,239,0.12)"
                      : "rgba(255,255,255,0.04)",
                  color: "inherit",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "4px",
                  }}
                >
                  <FolderOpenIcon size={18} />
                  <strong style={{ fontSize: "0.9rem" }}>Selective Scan</strong>
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.78rem",
                    opacity: 0.6,
                    lineHeight: 1.4,
                  }}
                >
                  Choose specific folders to scan.
                </p>
              </button>
            </div>

            {mode === "selective" && (
              <div
                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
              >
                {folderPaths.map((p) => (
                  <div
                    key={p}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "6px 10px",
                      background: "rgba(255,255,255,0.06)",
                      borderRadius: "6px",
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        fontSize: "0.8rem",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setFolderPaths((prev) => prev.filter((f) => f !== p))
                      }
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "inherit",
                        opacity: 0.6,
                        padding: "2px",
                      }}
                    >
                      <XIcon size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => void handleAddFolder()}
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px dashed rgba(255,255,255,0.2)",
                    borderRadius: "6px",
                    padding: "8px",
                    cursor: "pointer",
                    color: "inherit",
                    fontSize: "0.82rem",
                    opacity: 0.8,
                  }}
                >
                  + Add Folder
                </button>
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px",
              }}
            >
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={mode === "selective" && folderPaths.length === 0}
                onClick={() => void handleStartScan()}
              >
                Start Scan
              </Button>
            </div>
          </>
        )}

        {/* ── Stage: scanning ───────────────────────────────────────────── */}
        {stage === "scanning" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "16px",
              padding: "16px 0",
            }}
          >
            <p style={{ margin: 0, opacity: 0.8 }}>
              Scanning your PC for games…
            </p>

            {progress && progress.total > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  width: "100%",
                }}
              >
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
                      width: `${Math.round((progress.scanned / progress.total) * 100)}%`,
                      background: "var(--color-primary, #8c67ef)",
                      borderRadius: "2px",
                      transition: "width 0.2s ease",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: "0.75rem",
                    opacity: 0.55,
                    textAlign: "center",
                  }}
                >
                  {progress.scanned}/{progress.total} — {progress.currentTitle}{" "}
                  ({progress.foundCount} found)
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Stage: approve ────────────────────────────────────────────── */}
        {stage === "approve" && (
          <>
            {candidates.length === 0 ? (
              <p style={{ margin: 0, opacity: 0.6 }}>
                No games were found during the scan.
              </p>
            ) : (
              <>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() =>
                      setApproved(new Set(candidates.map((g) => g.key)))
                    }
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
                    onClick={() => setApproved(new Set())}
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
                    maxHeight: "300px",
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  {candidates.map((g) => (
                    <label
                      key={g.key}
                      aria-label={g.title}
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
                        onChange={() => toggleApproval(g.key)}
                        style={{
                          accentColor: "var(--color-primary, #8c67ef)",
                          width: "16px",
                          height: "16px",
                        }}
                      />
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "2px",
                          overflow: "hidden",
                        }}
                      >
                        <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                          {g.title}
                        </span>
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

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px",
              }}
            >
              <Button
                variant="secondary"
                onClick={() => {
                  setStage("configure");
                  setCandidates([]);
                }}
              >
                Scan Again
              </Button>
              {candidates.length > 0 && (
                <Button variant="primary" onClick={handleConfirm}>
                  Add {approved.size} game{approved.size !== 1 ? "s" : ""} to
                  library
                </Button>
              )}
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
