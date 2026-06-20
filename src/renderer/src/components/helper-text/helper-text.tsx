import React from "react";

import "./helper-text.scss";

export interface HelperTextProps
  extends React.HTMLAttributes<HTMLParagraphElement> {
  /** Visual emphasis of the muted text. `muted` (default) is the standard
   * secondary copy; `faint` is for the lowest-priority hints. */
  tone?: "muted" | "faint" | "danger";
  children: React.ReactNode;
}

/**
 * Standard secondary/helper paragraph. Replaces the dozens of ad-hoc
 * `<p style={{ opacity: 0.xx, fontSize: "0.8xrem" }}>` clones scattered across
 * onboarding and settings with one consistent, theme-aware element.
 */
export function HelperText({
  tone = "muted",
  className,
  children,
  ...rest
}: Readonly<HelperTextProps>) {
  return (
    <p
      className={["helper-text", `helper-text--${tone}`, className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </p>
  );
}
