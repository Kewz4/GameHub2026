import { Modal, Button } from "@renderer/components";

export interface LibrarySyncResult {
  title: string;
  coverUrl?: string | null;
  what: string; // description of what happened
  isNew?: boolean;
}

interface LibrarySyncModalProps {
  visible: boolean;
  heading: string;
  summary: string;
  results: LibrarySyncResult[];
  onClose: () => void;
}

export function LibrarySyncModal({
  visible,
  heading,
  summary,
  results,
  onClose,
}: Readonly<LibrarySyncModalProps>) {
  return (
    <Modal
      visible={visible}
      title={heading}
      description={summary}
      onClose={onClose}
    >
      <div
        style={{
          maxHeight: 420,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          paddingRight: 4,
        }}
      >
        {results.length === 0 && (
          <p style={{ opacity: 0.55, margin: 0, textAlign: "center" }}>
            Nothing to show.
          </p>
        )}
        {results.map((r, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "8px 10px",
              background: "rgba(255,255,255,0.04)",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            {r.coverUrl ? (
              <img
                src={r.coverUrl}
                alt={r.title}
                style={{
                  width: 50,
                  height: 50,
                  objectFit: "cover",
                  borderRadius: 4,
                  flexShrink: 0,
                }}
              />
            ) : (
              <div
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: 4,
                  flexShrink: 0,
                  background: "rgba(255,255,255,0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.2rem",
                }}
              >
                🎮
              </div>
            )}
            <div style={{ flex: 1, overflow: "hidden" }}>
              <p
                style={{
                  margin: 0,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.title}
              </p>
              <p
                style={{ margin: "2px 0 0", opacity: 0.6, fontSize: "0.8rem" }}
              >
                {r.what}
              </p>
            </div>
            {r.isNew && (
              <span
                style={{
                  fontSize: "0.7rem",
                  padding: "2px 7px",
                  borderRadius: 999,
                  background: "#fff",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                New
              </span>
            )}
          </div>
        ))}
      </div>

      <div
        style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}
      >
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
