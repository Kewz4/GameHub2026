import type { CSSProperties } from "react";
import type { DiagramControl } from "./controller-tokens";

export type { DiagramControl };

/**
 * Native Switch Pro controller diagram, transcribed from the standalone tester
 * SVG (controllertest.io layout) and re-themed for GameHub's dark UI.
 *
 * The diagram is purely SEMANTIC: it renders emulated controls ("a", "l2",
 * "up"…) whose activation the parent resolves through the user's bindings.
 * It never reads raw Gamepad API indices, so a physical Xbox Y bound to
 * emulated A correctly lights up the A button here. Sticks translate with the
 * bound stick-direction deflections. Hovering a control fires onHoverControl
 * so the parent can show the current binding; clicking starts a rebind.
 */

const STONE = {
  body: "#26221f",
  bodyStroke: "#3f3a35",
  well: "#1c1917",
  wellStroke: "#3f3a35",
  btn: "#403a34",
  btnStroke: "#4f4842",
  label: "#a8a29e",
  stick: "#57534e",
  dpad: "#4f4842",
};

const ACCENT = "var(--color-primary, #7aa2ff)";
const ACCENT_TEXT = "#0d0d0d";
const STICK_TRAVEL = 12; // px the stick cap moves at full deflection

export interface SwitchProDiagramProps {
  /**
   * Semantic activation per EMULATED control (already resolved through the
   * user's bindings) — the diagram never reads raw button indices, so a
   * physical Y bound to emulated A lights up A here.
   */
  active: Partial<Record<DiagramControl, boolean>>;
  /** Bound stick deflections, each -1..1: [lx, ly, rx, ry]. */
  stickDeflection: [number, number, number, number];
  /** Control currently selected for binding (pulses on the diagram). */
  activeControl?: DiagramControl | null;
  onHoverControl?: (control: DiagramControl | null) => void;
  onClickControl?: (control: DiagramControl) => void;
}

export function SwitchProDiagram({
  active,
  stickDeflection,
  activeControl,
  onHoverControl,
  onClickControl,
}: Readonly<SwitchProDiagramProps>) {
  const down = (c: DiagramControl) => Boolean(active[c]);
  const fill = (isActive: boolean) => (isActive ? ACCENT : STONE.btn);
  const clamp = (v: number) => Math.max(-1, Math.min(1, v || 0));

  const lx = clamp(stickDeflection[0]) * STICK_TRAVEL;
  const ly = clamp(stickDeflection[1]) * STICK_TRAVEL;
  const rx = clamp(stickDeflection[2]) * STICK_TRAVEL;
  const ry = clamp(stickDeflection[3]) * STICK_TRAVEL;

  const hover = (c: DiagramControl | null) => () => onHoverControl?.(c);
  const interactive = (
    c: DiagramControl
  ): {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onClick: () => void;
    style: CSSProperties;
  } => ({
    onMouseEnter: hover(c),
    onMouseLeave: hover(null),
    onClick: () => onClickControl?.(c),
    style: { cursor: onClickControl ? "pointer" : "default" },
  });

  const ring = (active: boolean) =>
    active
      ? { stroke: ACCENT, strokeWidth: 2 }
      : { stroke: "transparent", strokeWidth: 0 };

  return (
    <svg
      viewBox="0 0 441 383"
      className="switch-diagram"
      role="img"
      aria-label="Switch Pro controller"
    >
      {/* Body shells */}
      <path
        d="M220.5 294.5C220.5 294.5 195 294.5 150 294.5C105 294.5 81.5 378.5 49.5 378.5C17.5 378.5 4 363.9 4 317.5C4 271.1 43.5 165.5 55 137.5C66.5 109.5 95.5 92 128 92C154 92 200.5 92 220.5 92"
        fill={STONE.body}
        stroke={STONE.bodyStroke}
        strokeWidth={3}
      />
      <path
        d="M220 294.5C220 294.5 245.5 294.5 290.5 294.5C335.5 294.5 359 378.5 391 378.5C423 378.5 436.5 363.9 436.5 317.5C436.5 271.1 397 165.5 385.5 137.5C374 109.5 345 92 312.5 92C286.5 92 240 92 220 92"
        fill={STONE.body}
        stroke={STONE.bodyStroke}
        strokeWidth={3}
      />

      {/* Triggers ZL / ZR */}
      <g {...interactive("l2")}>
        <path
          d="m152.5,52.97c0,4.61 -3.35,8.36 -7.5,8.36l-13,0c-4.14,0 -7.5,-3.74 -7.5,-8.36l0,-22.86c0,-8.62 6.27,-15.61 14,-15.61c7.73,0 14,6.99 14,15.61l0,22.86z"
          fill={fill(down("l2"))}
          stroke={STONE.btnStroke}
          strokeWidth={2}
        />
        <text
          x="138"
          y="45"
          textAnchor="middle"
          fontSize={10}
          fontWeight="bold"
          fill={down("l2") ? ACCENT_TEXT : STONE.label}
        >
          ZL
        </text>
      </g>
      <g {...interactive("r2")}>
        <path
          d="m316.83,53.44c0,4.64 -3.44,8.39 -7.68,8.39l-13.31,0c-4.24,0 -7.68,-3.76 -7.68,-8.39l0,-22.94c0,-8.65 6.42,-15.67 14.33,-15.67c7.92,0 14.33,7.01 14.33,15.67l0,22.94z"
          fill={fill(down("r2"))}
          stroke={STONE.btnStroke}
          strokeWidth={2}
        />
        <text
          x="303"
          y="45"
          textAnchor="middle"
          fontSize={10}
          fontWeight="bold"
          fill={down("r2") ? ACCENT_TEXT : STONE.label}
        >
          ZR
        </text>
      </g>

      {/* Bumpers L / R */}
      <g {...interactive("l1")}>
        <rect
          x="116.8"
          y="66.8"
          width="43.3"
          height="17"
          rx="4"
          fill={fill(down("l1"))}
          stroke={STONE.btnStroke}
          strokeWidth={2}
        />
        <text
          x="138.5"
          y="79"
          textAnchor="middle"
          fontSize={10}
          fontWeight="bold"
          fill={down("l1") ? ACCENT_TEXT : STONE.label}
        >
          L
        </text>
      </g>
      <g {...interactive("r1")}>
        <rect
          x="281.3"
          y="67"
          width="42.6"
          height="17"
          rx="4"
          fill={fill(down("r1"))}
          stroke={STONE.btnStroke}
          strokeWidth={2}
        />
        <text
          x="302.5"
          y="79"
          textAnchor="middle"
          fontSize={10}
          fontWeight="bold"
          fill={down("r1") ? ACCENT_TEXT : STONE.label}
        >
          R
        </text>
      </g>

      {/* Left stick */}
      <circle
        cx="113"
        cy="160"
        r="37.5"
        fill={STONE.well}
        stroke={STONE.wellStroke}
        strokeWidth={2}
      />
      <g transform={`translate(${lx}, ${ly})`} {...interactive("l3")}>
        <circle
          cx="113"
          cy="160"
          r="28"
          fill={down("l3") ? ACCENT : STONE.stick}
          stroke={activeControl === "l3" ? ACCENT : STONE.body}
          strokeWidth={2}
        />
        <circle
          cx="113"
          cy="160"
          r="22"
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={2}
        />
      </g>

      {/* Right stick */}
      <circle
        cx="278"
        cy="238"
        r="37.5"
        fill={STONE.well}
        stroke={STONE.wellStroke}
        strokeWidth={2}
      />
      <g transform={`translate(${rx}, ${ry})`} {...interactive("r3")}>
        <circle
          cx="278"
          cy="238"
          r="28"
          fill={down("r3") ? ACCENT : STONE.stick}
          stroke={activeControl === "r3" ? ACCENT : STONE.body}
          strokeWidth={2}
        />
        <circle
          cx="278"
          cy="238"
          r="22"
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={2}
        />
      </g>

      {/* D-pad */}
      <circle
        cx="166"
        cy="238"
        r="37.5"
        fill={STONE.well}
        stroke={STONE.wellStroke}
        strokeWidth={2}
      />
      <g {...interactive("up")}>
        <path
          d="M166 206 L176 228 L166 238 L156 228 Z"
          fill={fill(down("up"))}
        />
      </g>
      <g {...interactive("down")}>
        <path
          d="M166 270 L156 248 L166 238 L176 248 Z"
          fill={fill(down("down"))}
        />
      </g>
      <g {...interactive("left")}>
        <path
          d="M134 238 L156 228 L166 238 L156 248 Z"
          fill={fill(down("left"))}
        />
      </g>
      <g {...interactive("right")}>
        <path
          d="M198 238 L176 248 L166 238 L176 228 Z"
          fill={fill(down("right"))}
        />
      </g>
      <circle cx="166" cy="238" r="9" fill={STONE.dpad} />

      {/* Face buttons — X(3) top, Y(2) left, B(0) bottom, A(1) right */}
      <circle
        cx="329"
        cy="160"
        r="37.5"
        fill={STONE.well}
        stroke={STONE.wellStroke}
        strokeWidth={2}
      />
      {[
        { c: "x" as const, cx: 329, cy: 140, label: "X" },
        { c: "y" as const, cx: 310, cy: 162, label: "Y" },
        { c: "b" as const, cx: 329, cy: 184, label: "B" },
        { c: "a" as const, cx: 348, cy: 162, label: "A" },
      ].map(({ c, cx, cy, label }) => (
        <g key={c} {...interactive(c)}>
          <circle
            cx={cx}
            cy={cy}
            r="13"
            fill={fill(down(c))}
            {...ring(activeControl === c)}
          />
          <text
            x={cx}
            y={cy + 4}
            textAnchor="middle"
            fontSize={12}
            fontWeight={900}
            fill={down(c) ? ACCENT_TEXT : STONE.label}
            style={{ pointerEvents: "none" }}
          >
            {label}
          </text>
        </g>
      ))}

      {/* Minus / Plus */}
      <g {...interactive("select")}>
        <rect
          x="180"
          y="160"
          width="12"
          height="4"
          rx="1"
          fill={fill(down("select"))}
        />
      </g>
      <g transform="translate(249, 156)" {...interactive("start")}>
        <rect
          x="0"
          y="4"
          width="12"
          height="4"
          rx="1"
          fill={fill(down("start"))}
        />
        <rect
          x="4"
          y="0"
          width="4"
          height="12"
          rx="1"
          fill={fill(down("start"))}
        />
      </g>

      {/* Home / Capture */}
      <g {...interactive("guide")}>
        <rect
          x="214"
          y="175"
          width="14"
          height="14"
          rx="3"
          fill={fill(down("guide"))}
        />
        <circle
          cx="221"
          cy="182"
          r="4"
          fill="none"
          stroke={down("guide") ? ACCENT_TEXT : STONE.label}
          strokeWidth={1.5}
        />
      </g>
      <g {...interactive("capture")}>
        <rect
          x="214"
          y="255"
          width="12"
          height="12"
          rx="2"
          fill={fill(down("capture"))}
        />
      </g>
    </svg>
  );
}
