import type { DiagramControl } from "./controller-tokens";
import { DIAGRAM } from "./diagram-theme";

/**
 * Reactive Joy-Con pair diagram, transcribed from the standalone Joy-Con
 * visualizer SVG (viewBox 0 0 400 250) into JSX so the ACTUAL elements react:
 * pressed buttons recolour in place and each analog-stick nub translates with
 * the bound deflection (no overlay dots), exactly like the GameCube diagram.
 *
 * The diagram is purely SEMANTIC: it renders emulated controls ("a", "l3",
 * "up"…) whose activation the parent resolves through the user's bindings, so a
 * physical Xbox Y bound to emulated A lights up A here. Highlighting mirrors the
 * app's other diagrams: face buttons are POSITION-based (a=bottom, b=right,
 * x=left, y=top).
 *
 * The two shell colours are ICONIC — cyan for the left Joy-Con, red for the
 * right — so they stay fixed; every other neutral/outline/label resolves
 * through the shared theme palette.
 */

const ACCENT = DIAGRAM.accent;
const VIEWBOX = "0 0 400 250";

// Both Joy-Con sticks are a static socket with an inner nub that translates;
// the source visualizer moves the nub by axis*10, so full deflection travels
// 10px within the r18 socket (the r14 nub pokes out slightly, like a pushed
// thumbstick — matching the reference).
const STICK_TRAVEL = 10;

// Iconic shell colours — these identify the left/right Joy-Con and never theme.
const LEFT_BODY = "#00C3E3";
const RIGHT_BODY = "#FF3C28";

// Everything else resolves through the shared theme palette.
const C = {
  shoulder: DIAGRAM.bodyRaised, // shoulder corners + top rails (static shell)
  edge: DIAGRAM.well, // inner-edge shadow strip + stick sockets
  btn: DIAGRAM.btn, // pressable neutral faces, idle
  stick: DIAGRAM.stick, // analog-stick nubs, idle
};

export interface JoyConDiagramProps {
  /**
   * Semantic activation per EMULATED control (already resolved through the
   * user's bindings) — the diagram never reads raw button indices.
   */
  active: Partial<Record<DiagramControl, boolean>>;
  /** Bound stick deflections, each -1..1: [lx, ly, rx, ry]. */
  stickDeflection: [number, number, number, number];
  activeControl?: DiagramControl | null;
  onHoverControl?: (control: DiagramControl | null) => void;
  onClickControl?: (control: DiagramControl) => void;
}

export function JoyConDiagram({
  active,
  stickDeflection,
  activeControl,
  onHoverControl,
  onClickControl,
}: Readonly<JoyConDiagramProps>) {
  const on = (c: DiagramControl) => Boolean(active[c]);
  const clamp = (v: number) => Math.max(-1, Math.min(1, v || 0));
  const lx = clamp(stickDeflection[0]) * STICK_TRAVEL;
  const ly = clamp(stickDeflection[1]) * STICK_TRAVEL;
  const rx = clamp(stickDeflection[2]) * STICK_TRAVEL;
  const ry = clamp(stickDeflection[3]) * STICK_TRAVEL;

  // Shared handlers for a pressable control group.
  const hit = (c: DiagramControl) => ({
    onMouseEnter: () => onHoverControl?.(c),
    onMouseLeave: () => onHoverControl?.(null),
    onClick: () => onClickControl?.(c),
    style: {
      cursor: onClickControl ? "pointer" : "default",
      outline: activeControl === c ? `4px solid ${ACCENT}` : undefined,
    },
  });

  return (
    <svg
      viewBox={VIEWBOX}
      className="joycon-diagram-svg"
      role="img"
      aria-label="Joy-Con pair controller"
    >
      {/* ── Left Joy-Con (cyan) ─────────────────────────────────────── */}
      <g transform="translate(60, 25)">
        {/* Shoulder corner (L) + top rail (ZL) — static shell. */}
        <path
          d="M0,30 C0,10 10,0 30,0 L30,-6 C5,-6 -6,5 -6,30 Z"
          fill={C.shoulder}
        />
        <path d="M34,-6 L66,-6 L66,0 L34,0 Z" fill={C.shoulder} />
        {/* Body shell — iconic cyan, static. */}
        <path
          d="M0,40 C0,10 10,0 40,0 L70,0 L70,200 L40,200 C10,200 0,190 0,160 Z"
          fill={LEFT_BODY}
        />
        {/* Inner-edge shadow strip. */}
        <rect x="66" y="10" width="4" height="180" fill={C.edge} />

        {/* SL/SR rail buttons → l1 (upper) / l2 (lower). */}
        <g {...hit("l1")}>
          <rect
            x="68"
            y="40"
            width="4"
            height="40"
            rx="2"
            fill={on("l1") ? ACCENT : C.btn}
          />
        </g>
        <g {...hit("l2")}>
          <rect
            x="68"
            y="120"
            width="4"
            height="40"
            rx="2"
            fill={on("l2") ? ACCENT : C.btn}
          />
        </g>

        {/* Minus → select. */}
        <g {...hit("select")}>
          <rect
            x="44"
            y="18"
            width="12"
            height="4"
            rx="1"
            fill={on("select") ? ACCENT : C.btn}
          />
        </g>

        {/* Left analog stick — socket static, inner nub translates, lights l3. */}
        <g {...hit("l3")}>
          <circle cx="35" cy="60" r="18" fill={C.edge} />
          <g transform={`translate(${lx} ${ly})`}>
            <circle cx="35" cy="60" r="14" fill={on("l3") ? ACCENT : C.stick} />
          </g>
        </g>

        {/* D-pad — 4 circles, POSITION-based. */}
        <g transform="translate(35, 130)">
          <g {...hit("up")}>
            <circle cx="0" cy="-17" r="7" fill={on("up") ? ACCENT : C.btn} />
          </g>
          <g {...hit("left")}>
            <circle cx="-17" cy="0" r="7" fill={on("left") ? ACCENT : C.btn} />
          </g>
          <g {...hit("right")}>
            <circle cx="17" cy="0" r="7" fill={on("right") ? ACCENT : C.btn} />
          </g>
          <g {...hit("down")}>
            <circle cx="0" cy="17" r="7" fill={on("down") ? ACCENT : C.btn} />
          </g>
        </g>

        {/* Capture → capture. */}
        <g {...hit("capture")}>
          <rect
            x="45"
            y="170"
            width="10"
            height="10"
            rx="2"
            fill={on("capture") ? ACCENT : C.btn}
          />
        </g>
      </g>

      {/* ── Right Joy-Con (red) ─────────────────────────────────────── */}
      <g transform="translate(240, 25)">
        {/* Shoulder corner (R) + top rail (ZR) — static shell. */}
        <path
          d="M70,30 C70,10 60,0 40,0 L40,-6 C65,-6 76,5 76,30 Z"
          fill={C.shoulder}
        />
        <path d="M36,-6 L4,-6 L4,0 L36,0 Z" fill={C.shoulder} />
        {/* Body shell — iconic red, static. */}
        <path
          d="M70,40 C70,10 60,0 30,0 L0,0 L0,200 L30,200 C60,200 70,190 70,160 Z"
          fill={RIGHT_BODY}
        />
        {/* Inner-edge shadow strip. */}
        <rect x="0" y="10" width="4" height="180" fill={C.edge} />

        {/* SL/SR rail buttons → r1 (upper) / r2 (lower). */}
        <g {...hit("r1")}>
          <rect
            x="-2"
            y="40"
            width="4"
            height="40"
            rx="2"
            fill={on("r1") ? ACCENT : C.btn}
          />
        </g>
        <g {...hit("r2")}>
          <rect
            x="-2"
            y="120"
            width="4"
            height="40"
            rx="2"
            fill={on("r2") ? ACCENT : C.btn}
          />
        </g>

        {/* Plus → start (two crossed bars). */}
        <g {...hit("start")}>
          <g transform="translate(14, 14)">
            <rect
              x="0"
              y="4"
              width="12"
              height="4"
              rx="1"
              fill={on("start") ? ACCENT : C.btn}
            />
            <rect
              x="4"
              y="0"
              width="4"
              height="12"
              rx="1"
              fill={on("start") ? ACCENT : C.btn}
            />
          </g>
        </g>

        {/* Face buttons — POSITION-based: top=y, left=x, right=b, bottom=a. */}
        <g transform="translate(35, 60)">
          <g {...hit("y")}>
            <circle cx="0" cy="-17" r="7" fill={on("y") ? ACCENT : C.btn} />
          </g>
          <g {...hit("x")}>
            <circle cx="-17" cy="0" r="7" fill={on("x") ? ACCENT : C.btn} />
          </g>
          <g {...hit("b")}>
            <circle cx="17" cy="0" r="7" fill={on("b") ? ACCENT : C.btn} />
          </g>
          <g {...hit("a")}>
            <circle cx="0" cy="17" r="7" fill={on("a") ? ACCENT : C.btn} />
          </g>
        </g>

        {/* Right analog stick — socket static, inner nub translates, lights r3. */}
        <g transform="translate(35, 130)">
          <g {...hit("r3")}>
            <circle cx="0" cy="0" r="18" fill={C.edge} />
            <g transform={`translate(${rx} ${ry})`}>
              <circle cx="0" cy="0" r="14" fill={on("r3") ? ACCENT : C.stick} />
            </g>
          </g>
        </g>

        {/* Home → guide. */}
        <g {...hit("guide")}>
          <circle cx="20" cy="175" r="7" fill={on("guide") ? ACCENT : C.btn} />
        </g>
      </g>
    </svg>
  );
}
