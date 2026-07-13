import type { DiagramControl } from "./controller-tokens";

/**
 * Reactive GameCube controller diagram, transcribed from the user's Illustrator
 * SVG into JSX so the ACTUAL elements react: pressed buttons recolour in place,
 * and the real analog-stick caps translate with the bound deflections (no
 * overlay dots). Highlighting is resolved through the user's bindings by the
 * parent, exactly like the Switch diagram.
 *
 * Button-index semantics are the parent's job; this only knows emulated
 * controls: a, b, x, y, start, l2 (L), r2 (R), up/down/left/right, and the two
 * sticks (visualised, not bound as buttons — GameCube has no stick clicks).
 */

const ACCENT = "var(--color-primary, #7aa2ff)";
const VIEWBOX = "0 0 3827.6 2672.9";
// The control stick cap moves within its big static well (well r≈460, cap
// r≈210 → up to ~230 travel). The C-Stick nub is smaller and moves within the
// static yellow base, so it gets a shorter travel.
const MAIN_TRAVEL = 190;
const C_TRAVEL = 70;

// Base palette from the source SVG.
const C = {
  body: "#bababa",
  bodyDark: "#9e9e9e",
  outerRing: "#9f9f9f",
  innerRing: "#bababa",
  triggerFace: "#c1c1c1",
  purple: "#490094",
  stickBase: "#acacac",
  stickMid: "#d1d1d1",
  cStickDark: "#5f5500",
  cStickYellow: "#ffe400",
  dpad: "#c7c7c7",
  light: "#eaeaea",
  aGreen: "#00bc8e",
  bRed: "red",
  label: "#5f5f5f",
};

export interface GameCubeDiagramProps {
  active: Partial<Record<DiagramControl, boolean>>;
  /** Bound stick deflections, each -1..1: [lx, ly, rx, ry]. */
  stickDeflection: [number, number, number, number];
  activeControl?: DiagramControl | null;
  onHoverControl?: (control: DiagramControl | null) => void;
  onClickControl?: (control: DiagramControl) => void;
}

export function GameCubeDiagram({
  active,
  stickDeflection,
  activeControl,
  onHoverControl,
  onClickControl,
}: Readonly<GameCubeDiagramProps>) {
  const on = (c: DiagramControl) => Boolean(active[c]);
  const clamp = (v: number) => Math.max(-1, Math.min(1, v || 0));
  const lx = clamp(stickDeflection[0]) * MAIN_TRAVEL;
  const ly = clamp(stickDeflection[1]) * MAIN_TRAVEL;
  const rx = clamp(stickDeflection[2]) * C_TRAVEL;
  const ry = clamp(stickDeflection[3]) * C_TRAVEL;

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
      className="gc-diagram-svg"
      role="img"
      aria-label="GameCube controller"
    >
      {/* ── Shoulder triggers L / R ─────────────────────────────────── */}
      <g {...hit("l2")}>
        <ellipse
          cx="705.1"
          cy="460"
          rx="394.3"
          ry="416.6"
          fill={on("l2") ? ACCENT : C.triggerFace}
        />
        <text
          transform="translate(619.7 248.3) scale(.6 1)"
          fontFamily="Arial"
          fontSize="183.6"
          fill={on("l2") ? "#0d0d0d" : C.label}
        >
          L
        </text>
      </g>
      <g {...hit("r2")}>
        <ellipse
          cx="3133.1"
          cy="461"
          rx="394.3"
          ry="416.6"
          fill={on("r2") ? ACCENT : C.triggerFace}
        />
        <text
          transform="translate(3159.9 249.3) scale(.5981 1)"
          fontFamily="Arial"
          fontSize="183.6"
          fill={on("r2") ? "#0d0d0d" : C.label}
        >
          R
        </text>
      </g>
      {/* Z trigger (the purple shoulder above R). GameCube maps Z to the R1
          slot, so it lights when the emulated Z control is active. */}
      <g {...hit("z")}>
        <path
          fill={on("z") ? ACCENT : C.purple}
          d="M3564.9,397.2c-9.2-20.3-141.3-109.8-313-156.1-171.7-46.4-446-75.9-470.5-66.6-24.4,9.3-20.7,96.1-20.7,96.1l755.1,236.4s58.2-89.4,49.1-109.7Z"
        />
        <text
          transform="translate(3120 360) scale(.6 1)"
          fontFamily="Arial"
          fontSize="150"
          fontWeight="bold"
          fill={on("z") ? "#0d0d0d" : "#ffffff"}
        >
          Z
        </text>
      </g>

      {/* ── Body shells ─────────────────────────────────────────────── */}
      <path
        fill={C.body}
        d="M1917.1,0C1149.1,0,413.1,388,413.1,388l460,1390s195-457.4,1044-457.4,1036,437.4,1036,437.4l436-1378S2669.1,0,1917.1,0Z"
      />
      <path
        fill={C.bodyDark}
        d="M65.2,805.8C34.7,929.6-14.8,1592.8,4.2,1942.1c19.1,349.3,53.4,703,282.1,725.1s244-265.3,270.7-371.4c26.7-106.1,163.9-711.8,163.9-711.8,0,0-625.3-901.9-655.8-778.1Z"
      />
      <path
        fill={C.body}
        d="M76.9,830.7C48,951.8,1,1600.2,19,1941.7c18.1,341.5,50.6,687.3,267.7,709,217.1,21.6,231.5-259.4,256.8-363.1,25.3-103.8,155.6-696,155.6-696,0,0-593.3-881.9-622.2-760.8Z"
      />
      <path
        fill={C.bodyDark}
        stroke="#000"
        d="M3760.3,809.8c-31.2-123.8-671.8,778.1-671.8,778.1,0,0,140.6,605.7,168,711.8,27.3,106.1,43,393.5,277.3,371.4s269.5-375.8,289-725.1c19.5-349.3-31.2-1012.5-62.5-1136.3Z"
      />
      <path
        fill={C.body}
        d="M3748.3,834.7c-29.6-121-637.4,760.8-637.4,760.8,0,0,133.4,592.2,159.4,696,25.9,103.8,40.8,384.7,263.1,363.1,222.4-21.6,255.7-367.4,274.2-709,18.5-341.5-29.6-989.9-59.3-1111Z"
      />
      <path
        fill={C.bodyDark}
        d="M1738.3,1617.4c-122.8-188.3-176.9-182.5-252.7-305.8-97.8-158.9,14.5-476-199.6-766.2-174.6-236.7-591.6-384.7-941.2-138.6C-28.3,669.4-11.1,1106.6,169.5,1380.7c189.6,287.8,445.1,264.1,582.9,407.4,86,89.5,101.9,265.1,203.9,370.4,143.8,148.4,380.2,225.3,639.1,61.5,215.7-136.5,255.6-429.6,142.8-602.6Z"
      />
      <path
        fill={C.body}
        d="M1733.1,1636c-111.1-187.2-185.6-195-260-316-96-156-1.5-502.6-192-760-171.8-232.1-571.1-373.1-920-140C-1.2,662-2.9,1088,189.1,1376c188.3,282.5,434.6,257.5,568,400,108.4,115.8,111.8,264.1,196,356,154.8,169,400.2,242.1,644,68,224-160,208.5-441.8,136-564Z"
      />
      <path
        fill={C.bodyDark}
        d="M3478.4,406.8c-349.6-246-766.6-98.1-941.2,138.6-214.1,290.2-101.8,607.3-199.6,766.2-75.8,123.2-130,117.5-252.7,305.8-112.8,173-72.9,466,142.8,602.6,258.9,163.8,495.4,86.9,639.2-61.5,102-105.3,117.9-280.9,203.9-370.4,137.8-143.4,393.2-119.6,582.9-407.4,180.6-274.1,197.9-711.3-175.2-973.9Z"
      />
      <path
        fill={C.body}
        d="M3462.1,420c-348.9-233.1-748.2-92.1-920,140-190.5,257.4-96,604-192,760-74.4,121-148.9,128.8-260,316-72.5,122.2-88,404,136,564,243.8,174.1,489.2,101,644-68,84.2-91.9,87.6-240.2,196-356,133.4-142.5,379.7-117.5,568-400,192-288,190.3-714-172-956Z"
      />

      {/* ── Control stick (well static, cap translates) ─────────────── */}
      <ellipse cx="753" cy="976" rx="475.3" ry="470.4" fill={C.outerRing} />
      <ellipse cx="753" cy="976" rx="463.2" ry="458.4" fill={C.innerRing} />
      <g transform={`translate(${lx} ${ly})`} {...hit("l3")}>
        <path d="M966.5,775.5c-16.5-16.5-172-88.3-210.8-88.3s-189.9,67.7-210.2,88.1c-21.4,21.4-87.4,180.2-88.4,211.2-1,30.3,63.2,186.7,87,210.5,26.2,26.2,171.7,85.5,210.5,86.5,38.8,1,184.9-64.1,209.8-86.1,25.2-22.3,89.3-181.1,89.3-211.3,0-30.1-68.8-192.3-87.2-210.7Z" />
        <path
          fill={C.stickMid}
          d="M960.1,782c-16-16-166.7-85.6-204.4-85.6s-184.1,65.6-203.8,85.4c-20.7,20.7-84.7,174.7-85.7,204.8-1,29.4,61.3,181,84.4,204.1,25.4,25.4,166.5,82.9,204.1,83.8,37.6.9,179.3-62.2,203.4-83.5,24.5-21.6,86.6-175.6,86.6-204.8s-66.7-186.4-84.6-204.2Z"
        />
        <ellipse
          cx="753"
          cy="995.1"
          rx="209.7"
          ry="198"
          fill={on("l3") ? ACCENT : C.stickBase}
        />
      </g>

      {/* ── C-Stick: yellow base STATIC, inner nub translates ───────── */}
      <g {...hit("r3")}>
        {/* Dark octagon socket + yellow base — stay put. */}
        <path d="M2724.5,1624.5c-16.5-16.5-172-88.3-210.8-88.3s-189.9,67.7-210.2,88.1c-21.4,21.4-87.4,180.2-88.4,211.2-1,30.3,63.2,186.7,87,210.5,26.2,26.2,171.7,85.5,210.5,86.5,38.8,1,184.9-64.1,209.8-86.1,25.2-22.3,89.3-181.1,89.3-211.3,0-30.1-68.8-192.3-87.2-210.7Z" />
        <path
          fill={C.cStickYellow}
          d="M2718.1,1630.9c-16-16-166.7-85.6-204.4-85.6s-184.1,65.6-203.8,85.4c-20.7,20.7-84.7,174.7-85.7,204.8-1,29.4,61.3,181,84.4,204.1,25.4,25.4,166.5,82.9,204.1,83.8,37.6.9,179.3-62.2,203.4-83.5,24.5-21.6,86.6-175.6,86.6-204.8,0-29.1-66.7-186.4-84.6-204.2Z"
        />
        {/* Inner nub — the part that moves. */}
        <g transform={`translate(${rx} ${ry})`}>
          <circle
            cx="2513.1"
            cy="1840"
            r="151.1"
            fill={on("r3") ? ACCENT : C.cStickDark}
          />
          <text
            transform="translate(2469.5 1899.8) scale(.7382 1)"
            fontFamily="Arial"
            fontSize="163.5"
            fill={C.cStickYellow}
          >
            C
          </text>
        </g>
      </g>

      {/* ── D-pad (base static, triangles react) ────────────────────── */}
      <ellipse
        cx="1315.5"
        cy="1840.9"
        rx="320.4"
        ry="317.1"
        fill={C.bodyDark}
      />
      <ellipse cx="1315.5" cy="1840.9" rx="312.2" ry="309.1" fill={C.body} />
      <polygon points="1398.6 1765.9 1398.6 1601.1 1234.9 1601.1 1234.9 1763.5 1076.3 1763.5 1076.3 1919.9 1233.8 1921.1 1233.9 2085.9 1396.3 2085.9 1397.5 1918.7 1559.7 1917.5 1559.7 1765.9 1398.6 1765.9" />
      <polygon
        fill={C.light}
        points="1389.9 1775 1389.9 1611.6 1243.3 1611.6 1243.4 1772.7 1085.1 1772.7 1085.1 1911.5 1243.2 1912.7 1243.3 2075.4 1387.2 2075.4 1388.7 1910.4 1549.2 1909.3 1549.2 1775 1389.9 1775"
      />
      <polygon
        {...hit("up")}
        fill={on("up") ? ACCENT : C.dpad}
        points="1316.4 1644.1 1267.7 1726 1363.3 1726 1316.4 1644.1"
      />
      <polygon
        {...hit("down")}
        fill={on("down") ? ACCENT : C.dpad}
        points="1267.7 1967 1316.4 2048.9 1363.3 1967 1267.7 1967"
      />
      <polygon
        {...hit("left")}
        fill={on("left") ? ACCENT : C.dpad}
        points="1113.1 1845.7 1195 1894.3 1195 1798.7 1113.1 1845.7"
      />
      <polygon
        {...hit("right")}
        fill={on("right") ? ACCENT : C.dpad}
        points="1436 1798.7 1436 1894.3 1517.9 1845.7 1436 1798.7"
      />
      <circle cx="1316" cy="1843.4" r="48.6" fill={C.dpad} />

      {/* ── Start / Pause ───────────────────────────────────────────── */}
      <g {...hit("start")}>
        <circle cx="1915.1" cy="1144" r="93" />
        <circle
          cx="1915.1"
          cy="1144"
          r="82"
          fill={on("start") ? ACCENT : C.light}
        />
      </g>
      <text
        transform="translate(1710.6 1012) scale(.7382 1)"
        fontFamily="Arial"
        fontSize="86.4"
        fill={C.label}
      >
        START/PAUSE
      </text>

      {/* ── Face buttons ────────────────────────────────────────────── */}
      <ellipse cx="3092.5" cy="976" rx="475.3" ry="470.4" fill={C.outerRing} />
      <ellipse cx="3092.5" cy="976" rx="463.2" ry="458.4" fill={C.innerRing} />
      <g {...hit("a")}>
        <circle cx="3097.1" cy="968" r="240" />
        <circle
          cx="3097.1"
          cy="968"
          r="224"
          fill={on("a") ? ACCENT : C.aGreen}
        />
        <text
          transform="translate(3040.96 1040.12) scale(.7382 1)"
          fontFamily="Arial"
          fontSize="215.3"
          fill="#0d0d0d"
        >
          A
        </text>
      </g>
      <g {...hit("b")}>
        <circle
          cx="2657.1"
          cy="1200"
          r="130"
          fill={on("b") ? ACCENT : C.bRed}
        />
        <text
          transform="translate(2622.54 1269.32) scale(.5981 1)"
          fontFamily="Arial"
          fontSize="183.6"
          fill="#0d0d0d"
        >
          B
        </text>
      </g>
      <g {...hit("y")}>
        <path
          fill={on("y") ? ACCENT : C.light}
          d="M3176.4,536.7c-8.9-112.4-236.6-62.3-273.9-45.5-37.3,16.8-207.1,96.9-134.7,194.2,83.2,86,136.6-11.2,211.1-46.6,97-37.6,200.9,15.8,197.4-102Z"
        />
        <text
          transform="translate(2930.42 635.32) scale(.5981 1)"
          fontFamily="Arial"
          fontSize="183.6"
          fill={C.label}
        >
          Y
        </text>
      </g>
      <g {...hit("x")}>
        <path
          fill={on("x") ? ACCENT : C.light}
          d="M3586.3,777.1c-16.8-37.3-96.9-207.1-194.2-134.7-86,83.2,11.2,136.6,46.6,211.1,37.6,97-15.8,200.9,102,197.4,112.4-8.9,62.3-236.6,45.5-273.9Z"
        />
        <text
          transform="translate(3472.76 896.32) scale(.5981 1)"
          fontFamily="Arial"
          fontSize="183.6"
          fill={C.label}
        >
          X
        </text>
      </g>
    </svg>
  );
}
