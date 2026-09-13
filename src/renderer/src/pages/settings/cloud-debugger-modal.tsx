import { useEffect, useRef } from "react";
import { XIcon } from "@primer/octicons-react";
import { Button } from "@renderer/components";
import type { DebugIssue, CloudDebugReport } from "@types";
import styles from "./cloud-debugger-modal.module.scss";

interface Props {
  report: CloudDebugReport;
  onClose: () => void;
}

const kindLabel: Record<DebugIssue["kind"], string> = {
  "missing-from-cloud": "Missing from cloud",
  "missing-from-local": "Missing from local",
  "achievement-count-mismatch": "Achievement mismatch",
  "playtime-mismatch": "Playtime mismatch",
};

export function CloudDebuggerModal({ report, onClose }: Readonly<Props>) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const byKind = (kind: DebugIssue["kind"]) =>
    report.issues.filter((i) => i.kind === kind);

  const sections: DebugIssue["kind"][] = [
    "missing-from-cloud",
    "missing-from-local",
    "achievement-count-mismatch",
    "playtime-mismatch",
  ];

  return (
    <div
      ref={backdropRef}
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Cloud Debugger Report</h2>
            <p className={styles.subtitle}>
              {new Date(report.checkedAt).toLocaleString()} &middot;{" "}
              {report.localCount} local &middot; {report.cloudCount} cloud
            </p>
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <XIcon size={16} />
          </button>
        </div>

        {report.error ? (
          <div className={styles.notice}>{report.error}</div>
        ) : report.notLoggedIn ? (
          <div className={styles.notice}>
            You must be logged in to GameHub to run the debugger.
          </div>
        ) : report.issues.length === 0 ? (
          <div className={styles.notice}>
            No issues found — local library and cloud are in sync.
          </div>
        ) : (
          <>
            <div className={styles.summary}>
              <div className={styles.summaryItem}>
                <span className={styles.summaryNum}>
                  {report.issues.length}
                </span>
                <span>issues found</span>
              </div>
              <div className={`${styles.summaryItem} ${styles.summaryFixed}`}>
                <span className={styles.summaryNum}>{report.fixedCount}</span>
                <span>auto-fixed</span>
              </div>
              {report.unfixedCount > 0 && (
                <div className={`${styles.summaryItem} ${styles.summaryError}`}>
                  <span className={styles.summaryNum}>
                    {report.unfixedCount}
                  </span>
                  <span>need attention</span>
                </div>
              )}
            </div>

            <div className={styles.body}>
              {sections.map((kind) => {
                const items = byKind(kind);
                if (!items.length) return null;
                return (
                  <section key={kind} className={styles.section}>
                    <h3 className={styles.sectionTitle}>
                      {kindLabel[kind]}{" "}
                      <span className={styles.sectionCount}>
                        ({items.length})
                      </span>
                    </h3>
                    <ul className={styles.list}>
                      {items.map((issue) => (
                        <li
                          key={`${issue.shop}:${issue.objectId}`}
                          className={styles.row}
                        >
                          <div className={styles.rowMain}>
                            <span className={styles.rowTitle}>
                              {issue.gameTitle}
                            </span>
                            <span className={styles.rowDetail}>
                              {issue.detail}
                            </span>
                          </div>
                          <span
                            className={
                              issue.fixed
                                ? styles.badgeFixed
                                : styles.badgeUnfixed
                            }
                          >
                            {issue.fixed
                              ? "Fixed"
                              : (issue.fixError ?? "Not fixed")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </>
        )}

        <div className={styles.footer}>
          <Button theme="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
