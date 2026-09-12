import type { GbaDiagramProps } from "./gba-diagram";
import type { DiagramControl } from "./controller-tokens";
import { DIAGRAM as palette } from "./diagram-theme";

export type HandheldDiagramKind =
  | "wiiu-gamepad"
  | "wiiu-pro"
  | "classic"
  | "3ds"
  | "ds"
  | "psp";

const LABELS: Record<HandheldDiagramKind, string> = {
  "wiiu-gamepad": "Wii U GamePad",
  "wiiu-pro": "Wii U Pro Controller",
  classic: "Wii Classic Controller",
  "3ds": "New Nintendo 3DS",
  ds: "Nintendo DS",
  psp: "PlayStation Portable",
};

/** Original vector diagrams following the manufacturers' front-view manuals.
 * Button identities use GameHub's logical mapping; stick motion uses the same
 * binding-resolved values as the existing reactive controller diagrams.
 */
export function HandheldControllerDiagram({
  kind,
  active,
  stickDeflection,
  activeControl,
  onHoverControl,
  onClickControl,
}: Readonly<GbaDiagramProps & { kind: HandheldDiagramKind }>) {
  const clamshell = kind === "3ds" || kind === "ds";
  const pad = kind === "wiiu-pro" || kind === "classic";
  const psp = kind === "psp";
  const baseY = clamshell ? 245 : 0;
  const height = clamshell ? 550 : 310;
  const clamp = (value: number) => Math.max(-1, Math.min(1, value || 0));
  const fill = (control: DiagramControl) =>
    active[control] ? palette.accent : palette.btn;
  const handlers = (control: DiagramControl, label: string) => ({
    role: "button" as const,
    tabIndex: onClickControl ? 0 : -1,
    "aria-label": `Map ${label}`,
    "aria-pressed": Boolean(active[control]),
    "data-controller-control": control,
    onMouseEnter: () => onHoverControl?.(control),
    onMouseLeave: () => onHoverControl?.(null),
    onClick: () => onClickControl?.(control),
    onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClickControl?.(control);
      }
    },
  });
  const button = (
    control: DiagramControl,
    label: string,
    x: number,
    y: number,
    radius = 15
  ) => (
    <g key={control} {...handlers(control, label)}>
      <circle
        cx={x}
        cy={y}
        r={radius}
        fill={fill(control)}
        stroke={activeControl === control ? palette.accent : palette.line}
        strokeWidth={activeControl === control ? 3 : 1}
      />
      <text
        x={x}
        y={y + 5}
        textAnchor="middle"
        fontSize="13"
        fontWeight="600"
        fill={active[control] ? palette.accentText : palette.btnLabel}
      >
        {label}
      </text>
    </g>
  );
  const shoulder = (
    control: DiagramControl,
    label: string,
    x: number,
    y: number
  ) => (
    <g key={control} {...handlers(control, label)}>
      <rect
        x={x}
        y={y}
        width="66"
        height="21"
        rx="7"
        fill={fill(control)}
        stroke={palette.line}
      />
      <text
        x={x + 33}
        y={y + 15}
        textAnchor="middle"
        fontSize="12"
        fill={active[control] ? palette.accentText : palette.btnLabel}
      >
        {label}
      </text>
    </g>
  );
  const dpad = (x: number, y: number) => (
    <g transform={`translate(${x} ${y})`}>
      <path
        d="M-12-35H12V-12H35V12H12V35H-12V12H-35V-12H-12Z"
        fill={palette.well}
        stroke={palette.line}
      />
      {(
        [
          ["up", 0, -23, "M-6 3L0-3L6 3"],
          ["right", 23, 0, "M-3-6L3 0L-3 6"],
          ["down", 0, 23, "M-6-3L0 3L6-3"],
          ["left", -23, 0, "M3-6L-3 0L3 6"],
        ] as const
      ).map(([control, dx, dy, path]) => (
        <g
          key={control}
          {...handlers(control, `D-pad ${control}`)}
          transform={`translate(${dx} ${dy})`}
        >
          <rect
            x="-11"
            y="-11"
            width="22"
            height="22"
            rx="2"
            fill={fill(control)}
          />
          <path
            d={path}
            fill="none"
            stroke={active[control] ? palette.accentText : palette.btnLabel}
            strokeWidth="2"
          />
        </g>
      ))}
    </g>
  );
  const stick = (
    side: 0 | 1,
    x: number,
    y: number,
    small = false,
    clickable = true
  ) => {
    const control = side ? "r3" : "l3";
    const travel = small ? 4 : 9;
    return (
      <g
        {...(clickable
          ? handlers(control, `${side ? "Right" : "Left"} stick click`)
          : {})}
      >
        <circle
          cx={x}
          cy={y}
          r={small ? 13 : 31}
          fill={palette.well}
          stroke={palette.line}
        />
        <circle
          cx={x + clamp(stickDeflection[side * 2]) * travel}
          cy={y + clamp(stickDeflection[side * 2 + 1]) * travel}
          r={small ? 9 : 23}
          fill={clickable && active[control] ? palette.accent : palette.stick}
          stroke={activeControl === control ? palette.accent : palette.line}
          strokeWidth="2"
        />
      </g>
    );
  };
  const face = (x: number, y: number) => (
    <g>
      {button(psp ? "y" : "x", psp ? "△" : "X", x, y - 29)}
      {button(psp ? "b" : "a", psp ? "○" : "A", x + 29, y)}
      {button(psp ? "a" : "b", psp ? "×" : "B", x, y + 29)}
      {button(psp ? "x" : "y", psp ? "□" : "Y", x - 29, y)}
    </g>
  );

  return (
    <svg
      viewBox={`0 0 640 ${height}`}
      className="handheld-controller-diagram"
      role="group"
      aria-label={`${LABELS[kind]} controller`}
    >
      <title>{`${LABELS[kind]} — live controller mapping`}</title>
      {clamshell && (
        <g>
          <rect
            x="48"
            y="12"
            width="544"
            height="244"
            rx="27"
            fill={palette.body}
            stroke={palette.line}
            strokeWidth="2"
          />
          <rect
            x={kind === "3ds" ? 128 : 180}
            y="36"
            width={kind === "3ds" ? 384 : 280}
            height="193"
            rx="6"
            fill={palette.well}
            stroke={palette.line}
          />
          <circle cx="320" cy="25" r="4" fill={palette.line} />
          {[83, 553].map((x) => (
            <g key={x} fill={palette.line}>
              {[92, 105, 118].map((y) => (
                <circle key={y} cx={x} cy={y} r="2" />
              ))}
            </g>
          ))}
        </g>
      )}
      <g transform={`translate(0 ${baseY})`}>
        {shoulder("l1", "L", 73, 13)}
        {shoulder("r1", "R", 501, 13)}
        {!psp && kind !== "ds" && (
          <>
            {shoulder("l2", "ZL", 147, 13)}
            {shoulder("r2", "ZR", 427, 13)}
          </>
        )}
        {pad ? (
          <path
            d={
              kind === "classic"
                ? "M122 35H518C583 35 610 77 606 144L594 223C590 259 566 279 539 257L452 213H188L101 257C74 279 50 259 46 223L34 144C30 77 57 35 122 35Z"
                : "M137 35H503C551 35 572 70 583 106L622 238C630 275 599 302 570 285L473 221H167L70 285C41 302 10 275 18 238L57 106C68 70 89 35 137 35Z"
            }
            fill={palette.body}
            stroke={palette.line}
            strokeWidth="2"
          />
        ) : (
          <rect
            x="28"
            y="31"
            width="584"
            height="260"
            rx={psp ? 66 : 29}
            fill={palette.body}
            stroke={palette.line}
            strokeWidth="2"
          />
        )}
        {!pad && (
          <rect
            x={clamshell ? 191 : 169}
            y={clamshell ? 57 : 65}
            width={clamshell ? 258 : 302}
            height={clamshell ? 190 : 170}
            rx="6"
            fill={palette.well}
            stroke={palette.line}
            strokeWidth="2"
          />
        )}
        {kind === "wiiu-gamepad" && (
          <>
            {stick(0, 95, 92)}
            {stick(1, 545, 92)}
            {dpad(95, 191)}
            {face(545, 188)}
            {button("select", "−", 541, 258, 11)}
            {button("start", "+", 577, 238, 11)}
            <circle
              cx="320"
              cy="266"
              r="13"
              fill={palette.btn}
              stroke={palette.line}
            />
            <circle cx="320" cy="47" r="4" fill={palette.line} />
          </>
        )}
        {clamshell && (
          <>
            {kind === "3ds" && (
              <>
                {stick(0, 102, 96, false, false)}
                {stick(1, 533, 70, true, false)}
              </>
            )}
            {dpad(102, kind === "3ds" ? 188 : 146)}
            {face(536, 154)}
            {button("start", "Start", 523, 239, 19)}
            {button("select", "Select", 574, 239, 19)}
            <rect
              x="293"
              y="262"
              width="54"
              height="14"
              rx="6"
              fill={palette.btn}
            />
          </>
        )}
        {psp && (
          <>
            {dpad(103, 115)}
            {stick(0, 103, 214, false, false)}
            {face(538, 142)}
            {button("select", "Select", 480, 265, 19)}
            {button("start", "Start", 531, 265, 19)}
            <text
              x="320"
              y="263"
              fill={palette.label}
              fontSize="15"
              textAnchor="middle"
              letterSpacing="5"
            >
              PSP
            </text>
          </>
        )}
        {pad && (
          <>
            {stick(
              0,
              kind === "classic" ? 230 : 145,
              kind === "classic" ? 194 : 100,
              false,
              kind !== "classic"
            )}
            {stick(
              1,
              kind === "classic" ? 410 : 495,
              kind === "classic" ? 194 : 100,
              false,
              kind !== "classic"
            )}
            {dpad(
              kind === "classic" ? 120 : 205,
              kind === "classic" ? 115 : 179
            )}
            {face(
              kind === "classic" ? 520 : 435,
              kind === "classic" ? 115 : 174
            )}
            {button("select", "−", 285, 133, 12)}
            {button("start", "+", 355, 133, 12)}
            <circle
              cx="320"
              cy="133"
              r="13"
              fill={palette.btn}
              stroke={palette.line}
            />
          </>
        )}
      </g>
    </svg>
  );
}
