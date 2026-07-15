import type { DiagramControl } from "./controller-tokens";

/**
 * Reactive Wii Remote + Nunchuk diagram, transcribed from the user's
 * Illustrator SVG into JSX so the ACTUAL elements react: pressed buttons
 * recolour in place, and the real Nunchuk stick nub translates with the bound
 * deflection (no overlay dots). Highlighting is resolved through the user's
 * bindings by the parent, exactly like the GameCube/Switch diagrams.
 *
 * Control mapping (physical → emulated DiagramControl):
 *   D-pad Up/Down/Left/Right → up/down/left/right
 *   A → a          B (underside trigger) → b
 *   1 → x          2 → y
 *   − → select     + → start        Home (H) → r3
 *   Nunchuk stick  → l3 (nub translates with [lx, ly])
 *   Nunchuk C → l1     Nunchuk Z → l2
 */

const ACCENT = "var(--color-primary, #7aa2ff)";
const VIEWBOX = "0 0 66.147 100.2";
// The Nunchuk nub (r≈4.48) sits inside the hex socket (half-width ≈6.5), so it
// has ~2 units of room in each direction before touching the socket wall.
const STICK_TRAVEL = 2.2;

// Base palette from the source SVG.
const C = {
  body: "#000",
  buttonFace: "#fff",
  stroke: "#000",
};

export interface WiimoteDiagramProps {
  active: Partial<Record<DiagramControl, boolean>>;
  /** Bound stick deflections, each -1..1: [lx, ly, rx, ry]. */
  stickDeflection: [number, number, number, number];
  activeControl?: DiagramControl | null;
  onHoverControl?: (control: DiagramControl | null) => void;
  onClickControl?: (control: DiagramControl) => void;
}

export function WiimoteDiagram({
  active,
  stickDeflection,
  activeControl,
  onHoverControl,
  onClickControl,
}: Readonly<WiimoteDiagramProps>) {
  const on = (c: DiagramControl) => Boolean(active[c]);
  const clamp = (v: number) => Math.max(-1, Math.min(1, v || 0));
  const lx = clamp(stickDeflection[0]) * STICK_TRAVEL;
  const ly = clamp(stickDeflection[1]) * STICK_TRAVEL;

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
      className="wiimote-diagram-svg"
      role="img"
      aria-label="Wii Remote and Nunchuk controller"
    >
      {/* ── Wii Remote body shell (static) ──────────────────────────── */}
      <path
        fill={C.body}
        d="M20.404,0H4.203C1.883.003.003,1.883,0,4.203v91.793c.003,2.32,1.883,4.2,4.203,4.203h16.201c2.32-.003,4.2-1.883,4.203-4.203V4.203c-.003-2.32-1.883-4.2-4.203-4.203ZM24.093,4.203v91.793c-.003,2.036-1.653,3.686-3.688,3.688H4.203c-2.036-.003-3.686-1.653-3.688-3.688V4.203c.003-2.036,1.653-3.685,3.688-3.687h16.201c2.036.002,3.686,1.652,3.688,3.687Z"
      />

      {/* ── D-pad: cross outline + ticks STATIC, arms react ─────────── */}
      <path
        fill={C.body}
        d="M5.98,14.834v3.077c0,.404.327.731.73.731h3.117c.119,0,.216.096.216.215v3.117c0,.404.328.731.731.731h3.077c.403,0,.73-.328.73-.731v-3.117c0-.119.097-.215.216-.215h3.117c.404,0,.73-.328.73-.731v-3.077c0-.404-.327-.731-.73-.731h-3.117c-.119,0-.216-.096-.216-.215v-3.117c0-.403-.327-.731-.73-.731h-3.077c-.404,0-.731.327-.731.731v3.117c0,.119-.097.215-.216.215h-3.117c-.404,0-.73.328-.73.731ZM14.799,14.618h3.117c.119,0,.216.097.216.216v3.077c0,.119-.097.216-.216.216h-3.117c-.403,0-.73.328-.73.731v3.117c0,.119-.097.215-.216.215h-3.077c-.119,0-.216-.096-.217-.215v-3.117c0-.403-.327-.731-.73-.731h-3.117c-.119,0-.216-.097-.216-.216v-3.077c0-.119.097-.216.216-.216h3.117c.403,0,.73-.328.73-.731v-3.117c0-.119.098-.215.217-.215h3.077c.119,0,.216.096.216.215v3.117c0,.403.327.73.73.731h0Z"
      />
      <rect x="12.066" y="11.578" width=".515" height="2.488" fill={C.body} />
      <rect x="12.057" y="18.679" width=".515" height="2.488" fill={C.body} />
      <rect x="7.628" y="16.115" width="2.487" height=".516" fill={C.body} />
      <rect x="14.729" y="16.154" width="2.487" height=".516" fill={C.body} />
      {/* Arm hit/highlight overlays — transparent until active. */}
      <rect
        {...hit("up")}
        x="10.043"
        y="10.04"
        width="4.538"
        height="4.063"
        fill={on("up") ? ACCENT : "transparent"}
      />
      <rect
        {...hit("down")}
        x="10.043"
        y="18.642"
        width="4.538"
        height="4.063"
        fill={on("down") ? ACCENT : "transparent"}
      />
      <rect
        {...hit("left")}
        x="5.98"
        y="14.103"
        width="4.063"
        height="4.539"
        fill={on("left") ? ACCENT : "transparent"}
      />
      <rect
        {...hit("right")}
        x="14.581"
        y="14.103"
        width="4.063"
        height="4.539"
        fill={on("right") ? ACCENT : "transparent"}
      />

      {/* ── B button (underside trigger, right of remote) ───────────── */}
      <g {...hit("b")}>
        <rect
          x="27.202"
          y="13.741"
          width="7.66"
          height="11.557"
          rx="1.676"
          ry="1.676"
          fill={on("b") ? ACCENT : "none"}
          stroke={C.stroke}
          strokeMiterlimit="10"
          strokeWidth=".5"
        />
      </g>
      <path
        fill={C.body}
        d="M30.249,18.189c.147-.031.38-.055.616-.055.337,0,.555.059.717.19.136.101.218.256.218.461,0,.252-.167.473-.442.574v.008c.248.062.539.267.539.655,0,.225-.089.396-.221.523-.183.167-.478.244-.903.244-.232,0-.411-.016-.523-.031v-2.569ZM30.586,19.258h.307c.356,0,.565-.186.565-.438,0-.306-.232-.426-.573-.426-.155,0-.244.012-.299.023v.841ZM30.586,20.51c.066.012.163.016.283.016.349,0,.671-.128.671-.508,0-.356-.307-.504-.675-.504h-.279v.996Z"
      />

      {/* ── Nunchuk C button ────────────────────────────────────────── */}
      <g {...hit("l1")}>
        <rect
          x="58.994"
          y="39.721"
          width="5.611"
          height="8.21"
          rx="1.209"
          ry="1.209"
          transform="translate(17.973 105.625) rotate(-90)"
          fill={on("l1") ? ACCENT : "none"}
          stroke={C.stroke}
          strokeMiterlimit="10"
          strokeWidth=".485"
        />
      </g>
      <path
        fill={C.body}
        d="M62.684,44.931c-.124.062-.372.124-.689.124-.736,0-1.291-.465-1.291-1.321,0-.818.555-1.372,1.364-1.372.326,0,.531.07.62.116l-.081.275c-.128-.062-.31-.108-.527-.108-.612,0-1.02.392-1.02,1.078,0,.64.368,1.05,1.004,1.05.206,0,.415-.042.551-.108l.069.267Z"
      />

      {/* ── Nunchuk Z button ────────────────────────────────────────── */}
      <g {...hit("l2")}>
        <rect
          x="58.994"
          y="47.484"
          width="5.611"
          height="8.21"
          rx="1.209"
          ry="1.209"
          transform="translate(10.21 113.388) rotate(-90)"
          fill={on("l2") ? ACCENT : "none"}
          stroke={C.stroke}
          strokeMiterlimit="10"
          strokeWidth=".485"
        />
      </g>
      <path
        fill={C.body}
        d="M60.777,52.905l1.449-2.12v-.011h-1.325v-.283h1.763v.206l-1.441,2.112v.012h1.461v.283h-1.906v-.198Z"
      />

      {/* ── Nunchuk body + hex socket (static) ──────────────────────── */}
      <path
        d="M42.107,36.426c-6.117,0-11.076,3.299-11.076,15.85s4.959,29.597,11.076,29.597,11.075-17.048,11.075-29.597-4.959-15.85-11.075-15.85ZM48.881,53.161c0,.409-.218.788-.573.992l-5.628,3.249c-.177.102-.375.153-.573.153s-.396-.052-.573-.153l-5.627-3.249c-.355-.205-.573-.583-.573-.992v-6.498c0-.409.218-.788.573-.992l5.627-3.249c.354-.204.792-.204,1.146,0l5.628,3.249c.355.205.573.583.573.992v6.498Z"
        fill="none"
        stroke={C.stroke}
        strokeMiterlimit="10"
        strokeWidth=".5"
      />

      {/* ── Nunchuk analog stick: socket STATIC, nub translates ─────── */}
      <g {...hit("l3")}>
        <g transform={`translate(${lx} ${ly})`}>
          <path
            d="M37.626,49.911v.002c0,1.601.854,3.08,2.24,3.881h0c1.387.801,3.095.801,4.482,0h0c1.386-.801,2.241-2.28,2.241-3.881h0c0-1.602-.854-3.082-2.241-3.882h0c-1.387-.801-3.095-.801-4.482,0h0c-1.386.801-2.24,2.28-2.24,3.881Z"
            fill={on("l3") ? ACCENT : "none"}
            stroke={C.stroke}
            strokeMiterlimit="10"
            strokeWidth=".5"
          />
        </g>
      </g>

      {/* ── A button ────────────────────────────────────────────────── */}
      <g {...hit("a")}>
        <circle
          cx="12.514"
          cy="31.458"
          r="3.871"
          fill={on("a") ? ACCENT : C.buttonFace}
          stroke={C.stroke}
          strokeMiterlimit="10"
          strokeWidth=".5"
        />
      </g>
      <path
        fill={C.body}
        d="M12.046,31.737l-.271.822h-.349l.888-2.612h.407l.891,2.612h-.36l-.279-.822h-.926ZM12.903,31.474l-.256-.752c-.058-.171-.097-.326-.136-.477h-.008c-.039.155-.082.314-.132.473l-.256.756h.787Z"
      />

      {/* ── − (minus) → select ──────────────────────────────────────── */}
      <g {...hit("select")}>
        <circle
          cx="5.675"
          cy="47.922"
          r="2.177"
          fill={on("select") ? ACCENT : C.buttonFace}
          stroke={C.stroke}
          strokeMiterlimit="10"
          strokeWidth=".281"
        />
      </g>
      <path fill={C.body} d="M6.246,47.857v.3h-1.142v-.3h1.142Z" />

      {/* ── Home (H) → r3 ───────────────────────────────────────────── */}
      <g {...hit("r3")}>
        <circle
          cx="12.304"
          cy="47.922"
          r="2.177"
          fill={on("r3") ? ACCENT : C.buttonFace}
          stroke={C.stroke}
          strokeMiterlimit="10"
          strokeWidth=".281"
        />
      </g>
      <path
        fill={C.body}
        d="M11.993,47.071v.615h.711v-.615h.192v1.471h-.192v-.689h-.711v.689h-.189v-1.471h.189Z"
      />

      {/* ── + (plus) → start ────────────────────────────────────────── */}
      <g {...hit("start")}>
        <circle
          cx="19.142"
          cy="47.922"
          r="2.177"
          fill={on("start") ? ACCENT : C.buttonFace}
          stroke={C.stroke}
          strokeMiterlimit="10"
          strokeWidth=".281"
        />
      </g>
      <path
        fill={C.body}
        d="M19.348,47.158v.609h.586v.156h-.586v.615h-.166v-.615h-.587v-.156h.587v-.609h.166Z"
      />

      {/* ── 1 button → x ────────────────────────────────────────────── */}
      <g {...hit("x")}>
        <circle
          cx="12.467"
          cy="73.853"
          r="2.262"
          fill={on("x") ? ACCENT : C.buttonFace}
          stroke={C.stroke}
          strokeMiterlimit="10"
          strokeWidth=".292"
        />
      </g>
      <path
        fill={C.body}
        d="M12.344,72.867h-.008l-.438.236-.066-.26.551-.295h.291v2.52h-.33v-2.201Z"
      />

      {/* ── 2 button → y ────────────────────────────────────────────── */}
      <g {...hit("y")}>
        <circle
          cx="12.467"
          cy="82.665"
          r="2.262"
          fill={on("y") ? ACCENT : C.buttonFace}
          stroke={C.stroke}
          strokeMiterlimit="10"
          strokeWidth=".292"
        />
      </g>
      <path
        fill={C.body}
        d="M11.677,83.918v-.209l.268-.26c.644-.612.934-.938.938-1.317,0-.256-.124-.492-.5-.492-.229,0-.418.116-.535.213l-.108-.24c.174-.147.422-.256.713-.256.542,0,.771.372.771.732,0,.465-.337.841-.869,1.353l-.202.187v.008h1.132v.282h-1.608Z"
      />
    </svg>
  );
}
