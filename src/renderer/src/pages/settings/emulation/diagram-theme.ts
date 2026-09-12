/**
 * Shared, theme-aware palette for ALL controller diagrams.
 *
 * Every neutral surface, outline and label resolves through CSS variables
 * defined in controller-mapper.scss from the app's theme channels
 * (--fg-rgb/--bg-rgb), so the diagrams stay readable in light AND dark mode
 * and follow custom themes automatically. Only console-iconic button colours
 * (GameCube green A / red B, N64 blue A / green B, GB red pills…) stay fixed —
 * they carry meaning, everything else is themed.
 *
 * The fallbacks are the dark-mode values so a diagram rendered outside the
 * mapper (tests, storybook-style renders) still looks right.
 */
export const DIAGRAM = {
  /** Outlines / line-work (N64 & Wiimote bodies are drawn with strokes). */
  line: "var(--diagram-line, #8a857e)",
  /** Main body/shell surface. */
  body: "var(--diagram-body, #2e2a26)",
  /** Raised/secondary shell surface (grips, rings, trigger faces). */
  bodyRaised: "var(--diagram-body-raised, #3b3631)",
  /** Recessed areas: stick wells, screen bezels, d-pad sockets. */
  well: "var(--diagram-well, #1c1917)",
  /** Neutral button faces (d-pads, start/select, shoulders). */
  btn: "var(--diagram-btn, #4a443d)",
  /** Lighter neutral button face / highlight surface. */
  btnRaised: "var(--diagram-btn-raised, #5a534b)",
  /** Analog stick caps/nubs. */
  stick: "var(--diagram-stick, #57534e)",
  /** Text labels engraved on the body (START, SELECT…). */
  label: "var(--diagram-label, #a8a29e)",
  /** Text ON a neutral button face. */
  btnLabel: "var(--diagram-btn-label, #d6d3d1)",
  /** Active/bound highlight — the app's primary colour. */
  accent: "var(--color-text-bright, #fafafa)",
  /** Text on top of the accent (must contrast in both modes). */
  accentText: "var(--color-background, #0d0d0d)",
} as const;
