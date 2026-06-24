import React from "react";

import { HelperText } from "../helper-text/helper-text";
import "./section-heading.scss";

export interface SectionHeadingProps {
  title: React.ReactNode;
  /** Optional muted sub-line rendered beneath the title. */
  hint?: React.ReactNode;
  /** Marks the group as destructive — tints the title with the danger color. */
  danger?: boolean;
  className?: string;
}

/**
 * Consistent settings/onboarding section heading: an `<h3>` plus an optional
 * muted hint line. Standardizes the `<h3>` + ad-hoc `<p style={{opacity}}>`
 * pairs that every settings panel re-implemented by hand.
 */
export function SectionHeading({
  title,
  hint,
  danger,
  className,
}: Readonly<SectionHeadingProps>) {
  return (
    <div className={["section-heading", className].filter(Boolean).join(" ")}>
      <h3
        className={[
          "section-heading__title",
          danger ? "section-heading__title--danger" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {title}
      </h3>
      {hint && <HelperText tone="faint">{hint}</HelperText>}
    </div>
  );
}
