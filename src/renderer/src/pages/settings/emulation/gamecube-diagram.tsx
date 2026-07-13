import type { CSSProperties } from "react";
import type { DiagramControl } from "./controller-tokens";

/**
 * Reactive GameCube controller diagram. The user's own Illustrator SVG is
 * rendered untouched as the base art layer; a second SVG overlay (same
 * viewBox) draws accent highlights when a control is active — resolved through
 * the user's bindings by the parent, exactly like the Switch diagram — plus
 * transparent hotspots for hover/click-to-bind. The two analog sticks show a
 * moving accent dot driven by the bound stick deflections.
 *
 * Adding another controller later is just: paste its SVG into ART and list its
 * control hotspot coordinates in HOTSPOTS.
 */

const ACCENT = "var(--color-primary, #7aa2ff)";
const VIEWBOX = "0 0 3827.6 2672.9";
const STICK_TRAVEL = 90; // svg units the stick dot travels at full deflection

type Shape =
  | { type: "circle"; cx: number; cy: number; r: number }
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { type: "poly"; points: string };

const HOTSPOTS: { control: DiagramControl; shape: Shape }[] = [
  { control: "a", shape: { type: "circle", cx: 3097, cy: 968, r: 224 } },
  { control: "b", shape: { type: "circle", cx: 2657, cy: 1200, r: 130 } },
  { control: "x", shape: { type: "circle", cx: 3500, cy: 880, r: 120 } },
  { control: "y", shape: { type: "circle", cx: 2958, cy: 620, r: 120 } },
  { control: "start", shape: { type: "circle", cx: 1915, cy: 1144, r: 95 } },
  {
    control: "l2",
    shape: { type: "ellipse", cx: 705, cy: 460, rx: 394, ry: 417 },
  },
  {
    control: "r2",
    shape: { type: "ellipse", cx: 3133, cy: 461, rx: 394, ry: 417 },
  },
  {
    control: "up",
    shape: { type: "poly", points: "1316 1644 1268 1726 1363 1726" },
  },
  {
    control: "down",
    shape: { type: "poly", points: "1268 1967 1316 2049 1363 1967" },
  },
  {
    control: "left",
    shape: { type: "poly", points: "1113 1846 1195 1894 1195 1799" },
  },
  {
    control: "right",
    shape: { type: "poly", points: "1436 1799 1436 1894 1518 1846" },
  },
];

// Stick caps (center) — visualized with a moving accent dot, not bound directly.
const STICKS = {
  left: { cx: 753, cy: 995, r: 90 },
  right: { cx: 2513, cy: 1840, r: 70 },
};

export interface GameCubeDiagramProps {
  active: Partial<Record<DiagramControl, boolean>>;
  /** Bound stick deflections, each -1..1: [lx, ly, rx, ry]. */
  stickDeflection: [number, number, number, number];
  activeControl?: DiagramControl | null;
  onHoverControl?: (control: DiagramControl | null) => void;
  onClickControl?: (control: DiagramControl) => void;
}

function ShapeEl({
  shape,
  ...rest
}: { shape: Shape } & React.SVGProps<SVGElement>) {
  if (shape.type === "circle")
    return (
      <circle
        cx={shape.cx}
        cy={shape.cy}
        r={shape.r}
        {...(rest as React.SVGProps<SVGCircleElement>)}
      />
    );
  if (shape.type === "ellipse")
    return (
      <ellipse
        cx={shape.cx}
        cy={shape.cy}
        rx={shape.rx}
        ry={shape.ry}
        {...(rest as React.SVGProps<SVGEllipseElement>)}
      />
    );
  return (
    <polygon
      points={shape.points}
      {...(rest as React.SVGProps<SVGPolygonElement>)}
    />
  );
}

export function GameCubeDiagram({
  active,
  stickDeflection,
  activeControl,
  onHoverControl,
  onClickControl,
}: Readonly<GameCubeDiagramProps>) {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v || 0));
  const lx = clamp(stickDeflection[0]) * STICK_TRAVEL;
  const ly = clamp(stickDeflection[1]) * STICK_TRAVEL;
  const rx = clamp(stickDeflection[2]) * STICK_TRAVEL;
  const ry = clamp(stickDeflection[3]) * STICK_TRAVEL;

  return (
    <div className="gc-diagram">
      <svg
        viewBox={VIEWBOX}
        className="gc-diagram__art"
        role="img"
        aria-label="GameCube controller"
        dangerouslySetInnerHTML={{ __html: GC_ART }}
      />
      <svg viewBox={VIEWBOX} className="gc-diagram__overlay">
        {/* Accent highlight when the control is active. */}
        {HOTSPOTS.map(({ control, shape }) => (
          <ShapeEl
            key={`hl-${control}`}
            shape={shape}
            fill={ACCENT}
            opacity={active[control] ? 0.55 : 0}
            style={{
              transition: "opacity 0.06s linear",
              pointerEvents: "none",
            }}
          />
        ))}

        {/* Moving stick dots. */}
        <circle
          cx={STICKS.left.cx + lx}
          cy={STICKS.left.cy + ly}
          r={STICKS.left.r}
          fill={ACCENT}
          opacity={0.75}
          style={{ pointerEvents: "none" }}
        />
        <circle
          cx={STICKS.right.cx + rx}
          cy={STICKS.right.cy + ry}
          r={STICKS.right.r}
          fill={ACCENT}
          opacity={0.75}
          style={{ pointerEvents: "none" }}
        />

        {/* Transparent hotspots for hover + click-to-bind. */}
        {HOTSPOTS.map(({ control, shape }) => (
          <ShapeEl
            key={`hs-${control}`}
            shape={shape}
            fill="transparent"
            stroke={activeControl === control ? ACCENT : "transparent"}
            strokeWidth={activeControl === control ? 14 : 0}
            style={
              {
                cursor: onClickControl ? "pointer" : "default",
                pointerEvents: "auto",
              } as CSSProperties
            }
            onMouseEnter={() => onHoverControl?.(control)}
            onMouseLeave={() => onHoverControl?.(null)}
            onClick={() => onClickControl?.(control)}
          />
        ))}
      </svg>
    </div>
  );
}

// User-provided GameCube SVG (Illustrator export), rendered as the static art
// layer. Only the outer <svg>/xml wrapper was stripped.
const GC_ART = `<defs><style>
.st0{font-size:183.6px}
.st0,.st1,.st2,.st4{font-family:ArialMT, Arial}
.st5{fill:#00bc8e}.st6{fill:#9f9f9f}.st7{fill:#bababa}.st8{fill:red}
.st1{font-size:163.5px}.st9{fill:#490094}.st2{font-size:215.3px}
.st10{fill:#acacac}.st11{fill:#5f5500}.st4{font-size:86.4px}
.st12,.st13{fill:#9e9e9e}.st14{fill:#c7c7c7}.st15{fill:#c1c1c1}
.st16{fill:#eaeaea}.st17{fill:#ffe400}.st18{fill:#d1d1d1}
.st13{stroke:#000;stroke-miterlimit:10}
</style></defs>
<ellipse class="st15" cx="705.1" cy="460" rx="394.3" ry="416.6"/>
<text class="st0" transform="translate(619.7 248.3) scale(.6 1)"><tspan x="0" y="0">L</tspan></text>
<ellipse class="st15" cx="3133.1" cy="461" rx="394.3" ry="416.6"/>
<text class="st0" transform="translate(3159.8954 249.3193) scale(.5981 1)"><tspan x="0" y="0">R</tspan></text>
<path class="st9" d="M3564.9,397.2c-9.2-20.3-141.3-109.8-313-156.1-171.7-46.4-446-75.9-470.5-66.6-24.4,9.3-20.7,96.1-20.7,96.1l755.1,236.4s58.2-89.4,49.1-109.7Z"/>
<path class="st7" d="M1917.1,0C1149.1,0,413.1,388,413.1,388l460,1390s195-457.4,1044-457.4,1036,437.4,1036,437.4l436-1378S2669.1,0,1917.1,0Z"/>
<path class="st12" d="M65.2,805.8C34.7,929.6-14.8,1592.8,4.2,1942.1c19.1,349.3,53.4,703,282.1,725.1s244-265.3,270.7-371.4c26.7-106.1,163.9-711.8,163.9-711.8,0,0-625.3-901.9-655.8-778.1Z"/>
<path class="st7" d="M76.9,830.7C48,951.8,1,1600.2,19,1941.7c18.1,341.5,50.6,687.3,267.7,709,217.1,21.6,231.5-259.4,256.8-363.1,25.3-103.8,155.6-696,155.6-696,0,0-593.3-881.9-622.2-760.8Z"/>
<path class="st13" d="M3760.3,809.8c-31.2-123.8-671.8,778.1-671.8,778.1,0,0,140.6,605.7,168,711.8,27.3,106.1,43,393.5,277.3,371.4s269.5-375.8,289-725.1c19.5-349.3-31.2-1012.5-62.5-1136.3Z"/>
<path class="st7" d="M3748.3,834.7c-29.6-121-637.4,760.8-637.4,760.8,0,0,133.4,592.2,159.4,696,25.9,103.8,40.8,384.7,263.1,363.1,222.4-21.6,255.7-367.4,274.2-709,18.5-341.5-29.6-989.9-59.3-1111Z"/>
<path class="st12" d="M1738.3,1617.4c-122.8-188.3-176.9-182.5-252.7-305.8-97.8-158.9,14.5-476-199.6-766.2-174.6-236.7-591.6-384.7-941.2-138.6C-28.3,669.4-11.1,1106.6,169.5,1380.7c189.6,287.8,445.1,264.1,582.9,407.4,86,89.5,101.9,265.1,203.9,370.4,143.8,148.4,380.2,225.3,639.1,61.5,215.7-136.5,255.6-429.6,142.8-602.6Z"/>
<path class="st7" d="M1733.1,1636c-111.1-187.2-185.6-195-260-316-96-156-1.5-502.6-192-760-171.8-232.1-571.1-373.1-920-140C-1.2,662-2.9,1088,189.1,1376c188.3,282.5,434.6,257.5,568,400,108.4,115.8,111.8,264.1,196,356,154.8,169,400.2,242.1,644,68,224-160,208.5-441.8,136-564Z"/>
<path class="st12" d="M3478.4,406.8c-349.6-246-766.6-98.1-941.2,138.6-214.1,290.2-101.8,607.3-199.6,766.2-75.8,123.2-130,117.5-252.7,305.8-112.8,173-72.9,466,142.8,602.6,258.9,163.8,495.4,86.9,639.2-61.5,102-105.3,117.9-280.9,203.9-370.4,137.8-143.4,393.2-119.6,582.9-407.4,180.6-274.1,197.9-711.3-175.2-973.9Z"/>
<path class="st7" d="M3462.1,420c-348.9-233.1-748.2-92.1-920,140-190.5,257.4-96,604-192,760-74.4,121-148.9,128.8-260,316-72.5,122.2-88,404,136,564,243.8,174.1,489.2,101,644-68,84.2-91.9,87.6-240.2,196-356,133.4-142.5,379.7-117.5,568-400,192-288,190.3-714-172-956Z"/>
<ellipse class="st6" cx="753" cy="976" rx="475.3" ry="470.4"/>
<ellipse class="st7" cx="753" cy="976" rx="463.2" ry="458.4"/>
<path d="M966.5,775.5c-16.5-16.5-172-88.3-210.8-88.3s-189.9,67.7-210.2,88.1c-21.4,21.4-87.4,180.2-88.4,211.2-1,30.3,63.2,186.7,87,210.5,26.2,26.2,171.7,85.5,210.5,86.5,38.8,1,184.9-64.1,209.8-86.1,25.2-22.3,89.3-181.1,89.3-211.3,0-30.1-68.8-192.3-87.2-210.7Z"/>
<path class="st18" d="M960.1,782c-16-16-166.7-85.6-204.4-85.6s-184.1,65.6-203.8,85.4c-20.7,20.7-84.7,174.7-85.7,204.8-1,29.4,61.3,181,84.4,204.1,25.4,25.4,166.5,82.9,204.1,83.8,37.6.9,179.3-62.2,203.4-83.5,24.5-21.6,86.6-175.6,86.6-204.8s-66.7-186.4-84.6-204.2Z"/>
<ellipse class="st10" cx="753" cy="995.1" rx="209.7" ry="198"/>
<path d="M2724.5,1624.5c-16.5-16.5-172-88.3-210.8-88.3s-189.9,67.7-210.2,88.1c-21.4,21.4-87.4,180.2-88.4,211.2-1,30.3,63.2,186.7,87,210.5,26.2,26.2,171.7,85.5,210.5,86.5,38.8,1,184.9-64.1,209.8-86.1,25.2-22.3,89.3-181.1,89.3-211.3,0-30.1-68.8-192.3-87.2-210.7Z"/>
<path class="st17" d="M2718.1,1630.9c-16-16-166.7-85.6-204.4-85.6s-184.1,65.6-203.8,85.4c-20.7,20.7-84.7,174.7-85.7,204.8-1,29.4,61.3,181,84.4,204.1,25.4,25.4,166.5,82.9,204.1,83.8,37.6.9,179.3-62.2,203.4-83.5,24.5-21.6,86.6-175.6,86.6-204.8,0-29.1-66.7-186.4-84.6-204.2Z"/>
<circle class="st11" cx="2513.1" cy="1840" r="151.1"/>
<text class="st1" transform="translate(2469.5214 1899.7549) scale(.7382 1)"><tspan x="0" y="0">C</tspan></text>
<ellipse class="st12" cx="1315.5" cy="1840.9" rx="320.4" ry="317.1"/>
<ellipse class="st7" cx="1315.5" cy="1840.9" rx="312.2" ry="309.1"/>
<polygon points="1398.6 1765.9 1398.6 1601.1 1234.9 1601.1 1234.9 1763.5 1076.3 1763.5 1076.3 1919.9 1233.8 1921.1 1233.9 2085.9 1396.3 2085.9 1397.5 1918.7 1559.7 1917.5 1559.7 1765.9 1398.6 1765.9"/>
<polygon class="st16" points="1389.9 1775 1389.9 1611.6 1243.3 1611.6 1243.4 1772.7 1085.1 1772.7 1085.1 1911.5 1243.2 1912.7 1243.3 2075.4 1387.2 2075.4 1388.7 1910.4 1549.2 1909.3 1549.2 1775 1389.9 1775"/>
<polygon class="st14" points="1316.4 1644.1 1267.7 1726 1363.3 1726 1316.4 1644.1"/>
<polygon class="st14" points="1267.7 1967 1316.4 2048.9 1363.3 1967 1267.7 1967"/>
<polygon class="st14" points="1113.1 1845.7 1195 1894.3 1195 1798.7 1113.1 1845.7"/>
<polygon class="st14" points="1436 1798.7 1436 1894.3 1517.9 1845.7 1436 1798.7"/>
<circle class="st14" cx="1316" cy="1843.4" r="48.6"/>
<circle cx="1915.1" cy="1144" r="93"/>
<circle class="st16" cx="1915.1" cy="1144" r="82"/>
<text class="st4" transform="translate(1710.619 1012.0312) scale(.7382 1)"><tspan x="0" y="0">START/PAUSE</tspan></text>
<ellipse class="st6" cx="3092.5" cy="976" rx="475.3" ry="470.4"/>
<ellipse class="st7" cx="3092.5" cy="976" rx="463.2" ry="458.4"/>
<circle cx="3097.1" cy="968" r="240"/>
<circle class="st5" cx="3097.1" cy="968" r="224"/>
<text class="st2" transform="translate(3040.9637 1040.1172) scale(.7382 1)"><tspan x="0" y="0">A</tspan></text>
<circle class="st8" cx="2657.1" cy="1200" r="130"/>
<text class="st0" transform="translate(2622.5389 1269.3203) scale(.5981 1)"><tspan x="0" y="0">B</tspan></text>
<path class="st16" d="M3176.4,536.7c-8.9-112.4-236.6-62.3-273.9-45.5-37.3,16.8-207.1,96.9-134.7,194.2,83.2,86,136.6-11.2,211.1-46.6,97-37.6,200.9,15.8,197.4-102Z"/>
<path class="st16" d="M3586.3,777.1c-16.8-37.3-96.9-207.1-194.2-134.7-86,83.2,11.2,136.6,46.6,211.1,37.6,97-15.8,200.9,102,197.4,112.4-8.9,62.3-236.6,45.5-273.9Z"/>
<text class="st0" transform="translate(2930.4159 635.3203) scale(.5981 1)"><tspan x="0" y="0">Y</tspan></text>
<text class="st0" transform="translate(3472.7616 896.3203) scale(.5981 1)"><tspan x="0" y="0">X</tspan></text>`;
