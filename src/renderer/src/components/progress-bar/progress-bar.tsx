import "./progress-bar.scss";

export interface ProgressBarProps {
  /** Current progress value. */
  current: number;
  /** Total to reach 100%. Guarded against 0. */
  total: number;
  /** Optional trailing label. When `true`, renders `current/total`; a string
   * renders verbatim; omit for a bare bar. */
  label?: string | boolean;
  /** Thickness in px. Defaults to 4. */
  height?: number;
  className?: string;
}

/**
 * Thin determinate progress bar. Replaces the inline bar/fill/label markup that
 * was copy-pasted across settings (metadata, dedup) and onboarding (scan,
 * import). Theme-aware: the fill uses --color-text-bright.
 */
export function ProgressBar({
  current,
  total,
  label,
  height = 4,
  className,
}: Readonly<ProgressBarProps>) {
  const pct =
    total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  const labelText =
    label === true
      ? `${current}/${total}`
      : typeof label === "string"
        ? label
        : null;

  return (
    <div className={["progress-bar", className].filter(Boolean).join(" ")}>
      <div className="progress-bar__track" style={{ height }}>
        <div className="progress-bar__fill" style={{ width: `${pct}%` }} />
      </div>
      {labelText !== null && (
        <span className="progress-bar__label">{labelText}</span>
      )}
    </div>
  );
}
