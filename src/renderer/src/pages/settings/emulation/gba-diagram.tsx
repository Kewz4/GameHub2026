import type { DiagramControl } from "./controller-tokens";
import { DIAGRAM } from "./diagram-theme";

/**
 * Reactive Game Boy Advance diagram, transcribed from the user's Illustrator
 * SVG into JSX so the ACTUAL elements react: pressed buttons recolour in place.
 * Highlighting is resolved through the user's bindings by the parent, exactly
 * like the GameCube diagram.
 *
 * The GBA has no analog stick, so `stickDeflection` is accepted for interface
 * parity but ignored. Reactive controls: up/down/left/right (D-pad arrows),
 * a, b, l1 (L shoulder), r1 (R shoulder), start, select. The body shell, the
 * screen bezel, and the D-pad cross are static, themed via DIAGRAM.
 */

const ACCENT = DIAGRAM.accent;
const VIEWBOX = "0 0 150.613 86.616";

export interface GbaDiagramProps {
  active: Partial<Record<DiagramControl, boolean>>;
  /** GBA has no sticks — accepted for parity but ignored. */
  stickDeflection: [number, number, number, number];
  activeControl?: DiagramControl | null;
  onHoverControl?: (control: DiagramControl | null) => void;
  onClickControl?: (control: DiagramControl) => void;
}

export function GbaDiagram({
  active,
  stickDeflection,
  activeControl,
  onHoverControl,
  onClickControl,
}: Readonly<GbaDiagramProps>) {
  void stickDeflection; // GBA has no analog sticks.
  const on = (c: DiagramControl) => Boolean(active[c]);

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
      className="gba-diagram-svg"
      role="img"
      aria-label="Game Boy Advance controller"
    >
      {/* ── Shoulder shells L / R (reactive) ────────────────────────── */}
      <g {...hit("l1")}>
        <path
          fill={on("l1") ? ACCENT : DIAGRAM.btn}
          d="M38.631,19.558c0,3.728-24.276,1-28.625,1s-7.875-3.022-7.875-6.75,3.526-6.75,7.875-6.75c1.943,0,26.972-3.647,28.346-2.647,1.7,1.238.279,13.084.279,15.147Z"
        />
      </g>
      <g {...hit("r1")}>
        <path
          fill={on("r1") ? ACCENT : DIAGRAM.btn}
          data-paper-data='{"index":null}'
          d="M110.966,4.162c1.373-1,26.402,2.647,28.346,2.647,4.349,0,7.875,3.022,7.875,6.75s-3.526,6.75-7.875,6.75-28.625,2.728-28.625-1c0-2.062-1.421-13.908.279-15.147Z"
        />
      </g>

      {/* ── Body shell (static, themed) ─────────────────────────────── */}
      <path
        fill={DIAGRAM.body}
        d="M4.107,15.283c1.239-3.67,11.355-1.162,18-4S30.924,1.748,38.44.95c7.516-.798,66.418-1.94,74.667.667,5.221,1.65,8.738,5.96,15,8.333s17.214,2.128,19.667,8.333c2.452,6.205,3.567,26.971,2.333,47.333-.224,3.697.04,5.312-9,9-4.599,1.876-12.739,5.424-21.333,7.333-8.594,1.91-32.667,4.667-32.667,4.667l-26-1s-15.27-1.078-25.333-2.667c-10.063-1.589-30-8.333-30-8.333l-5-7.333S-2.399,34.549,4.107,15.283ZM39.274,66.95s19.936,6.653,29.873,6.286c13.205-.487,42.377-5.452,42.377-5.452l.5-48.833-71.583-1.917-1.167,49.917Z"
      />

      {/* ── START / SELECT buttons (reactive) ───────────────────────── */}
      <g {...hit("start")}>
        <path
          fill={on("start") ? ACCENT : DIAGRAM.btnRaised}
          d="M32.427,59.337c0,1.473-1.231,2.667-2.75,2.667s-2.75-1.194-2.75-2.667,1.231-2.667,2.75-2.667,2.75,1.194,2.75,2.667Z"
        />
      </g>
      <g {...hit("select")}>
        <path
          fill={on("select") ? ACCENT : DIAGRAM.btnRaised}
          d="M32.427,67.98c0,1.473-1.231,2.667-2.75,2.667s-2.75-1.194-2.75-2.667,1.231-2.667,2.75-2.667,2.75,1.194,2.75,2.667Z"
        />
      </g>

      {/* ── Screen bezel (static) ───────────────────────────────────── */}
      <path
        fill={DIAGRAM.well}
        stroke={DIAGRAM.line}
        strokeLinecap="round"
        strokeMiterlimit="10"
        strokeWidth=".5"
        d="M36.881,17.558s2.741-3.286,4.25-3.5,32.75-1.75,32.75-1.75c0,0,11.224-1.485,25.75.5s14.5,5,14.5,5l2.25,50s-2.179,5.405-5.25,6.25-34.75,4.75-34.75,4.75c0,0-16.409,1.252-30.25-2.5s-11.25-8.75-11.25-8.75l2-50ZM43.131,62.308l65.75.25.5-42.55-66.9.25.65,42.05Z"
      />

      {/* ── D-pad: raised cross static, arrows react ────────────────── */}
      <path
        fill={DIAGRAM.btnRaised}
        d="M27.816,35.751h-6.637v-6.635c0-.383-.312-.695-.694-.695h-3.782c-.383,0-.695.312-.695.695v6.635h-6.637c-.383,0-.695.312-.695.695v3.782c0,.384.312.695.695.695h6.637v6.635c0,.383.312.694.695.694h3.782c.383,0,.694-.311.694-.694v-6.635h6.637c.383,0,.694-.312.694-.695v-3.782c0-.383-.311-.695-.694-.695Z"
      />
      <polygon
        {...hit("left")}
        fill={on("left") ? ACCENT : DIAGRAM.well}
        points="10.664 38.342 12.987 39.683 12.987 37.001 10.664 38.342"
      />
      <polygon
        {...hit("right")}
        fill={on("right") ? ACCENT : DIAGRAM.well}
        points="26.523 38.342 24.2 39.683 24.2 37.001 26.523 38.342"
      />
      <polygon
        {...hit("up")}
        fill={on("up") ? ACCENT : DIAGRAM.well}
        points="18.575 30.435 19.916 32.758 17.234 32.758 18.575 30.435"
      />
      <polygon
        {...hit("down")}
        fill={on("down") ? ACCENT : DIAGRAM.well}
        points="18.575 46.365 17.234 44.043 19.916 44.043 18.575 46.365"
      />

      {/* ── Face buttons A / B (reactive) ───────────────────────────── */}
      <g {...hit("a")}>
        <circle
          cx="125.481"
          cy="40.766"
          r="5.53"
          fill={on("a") ? ACCENT : DIAGRAM.btnRaised}
        />
      </g>
      <g {...hit("b")}>
        <circle
          cx="139.564"
          cy="35.516"
          r="5.53"
          fill={on("b") ? ACCENT : DIAGRAM.btnRaised}
        />
      </g>

      {/* ── START label glyphs (static) ─────────────────────────────── */}
      <g fill={DIAGRAM.label}>
        <path d="M16.648,57.557c.12.117.308.232.521.279.317.069.539-.057.592-.299.049-.225-.05-.382-.348-.576-.361-.226-.559-.481-.484-.82.082-.374.453-.584.919-.481.246.054.412.15.505.233l-.141.234c-.069-.059-.214-.166-.431-.214-.328-.071-.496.097-.531.261-.049.225.073.367.376.567.372.247.535.487.458.841-.081.369-.426.63-.992.506-.231-.051-.469-.174-.579-.287l.135-.244Z" />
        <path d="M19.286,56.291l-.729-.16.058-.263,1.777.39-.058.264-.733-.161-.469,2.138-.313-.068.469-2.139Z" />
        <path d="M20.416,57.988l-.416.701-.32-.071,1.342-2.222.374.082.292,2.581-.332-.073-.09-.812-.852-.187ZM21.255,57.919l-.083-.743c-.019-.168-.023-.318-.029-.465h-.007c-.066.133-.138.271-.216.406l-.388.643.723.159Z" />
        <path d="M22.557,56.768c.164.002.393.033.606.08.332.072.532.181.651.349.098.134.129.312.089.497-.069.317-.315.483-.587.514l-.002.011c.171.104.244.3.246.562.005.352.011.597.041.7l-.32-.071c-.025-.076-.033-.295-.035-.607.002-.348-.1-.5-.378-.572l-.292-.064-.228,1.04-.31-.068.52-2.368ZM22.626,57.929l.317.069c.331.072.581-.062.641-.337.068-.311-.126-.495-.454-.569-.149-.033-.259-.043-.312-.04l-.192.877Z" />
        <path d="M24.907,57.525l-.729-.16.058-.264,1.777.391-.058.263-.733-.161-.469,2.138-.313-.068.469-2.138Z" />
      </g>

      {/* ── SELECT label glyphs (static) ────────────────────────────── */}
      <g fill={DIAGRAM.label}>
        <path d="M14.604,66.086c.12.117.308.232.521.279.316.069.538-.057.592-.299.049-.225-.051-.382-.348-.576-.361-.226-.559-.481-.484-.82.082-.374.453-.584.919-.481.246.054.412.15.505.233l-.141.234c-.069-.059-.214-.166-.431-.214-.328-.071-.496.097-.531.261-.05.225.072.367.376.567.371.247.535.487.457.841-.081.369-.426.63-.992.506-.231-.051-.469-.174-.578-.287l.135-.244Z" />
        <path d="M17.807,66.006l-.934-.205-.19.865,1.041.229-.058.26-1.35-.296.526-2.401,1.297.285-.058.26-.986-.216-.167.758.934.205-.056.257Z" />
        <path d="M18.593,64.842l.31.067-.47,2.141,1.025.226-.057.26-1.336-.293.527-2.4Z" />
        <path d="M21.233,66.758l-.934-.205-.189.865,1.04.229-.058.261-1.35-.297.527-2.4,1.296.284-.057.261-.987-.217-.166.758.934.205-.057.257Z" />
        <path d="M23.188,68.284c-.127.032-.367.038-.659-.025-.677-.148-1.092-.688-.919-1.475.165-.752.786-1.149,1.53-.985.299.065.474.171.547.231l-.131.236c-.104-.083-.263-.162-.463-.206-.562-.123-1.016.154-1.153.785-.13.588.126,1.04.71,1.168.189.041.39.045.528.011l.01.26Z" />
        <path d="M24.579,66.432l-.729-.16.058-.264,1.776.39-.058.264-.733-.161-.469,2.138-.313-.068.469-2.138Z" />
      </g>

      {/* ── Face-button labels A / B and shoulder labels L / R (static) */}
      <path
        fill={on("a") ? DIAGRAM.accentText : DIAGRAM.label}
        d="M124.504,41.425l-.564,1.711h-.727l1.848-5.44h.848l1.856,5.44h-.75l-.581-1.711h-1.93ZM126.288,40.876l-.533-1.566c-.121-.355-.201-.678-.282-.993h-.017c-.08.323-.169.654-.274.985l-.532,1.574h1.639Z"
      />
      <path
        fill={on("b") ? DIAGRAM.accentText : DIAGRAM.label}
        d="M138.303,32.519c.307-.065.791-.113,1.283-.113.703,0,1.154.121,1.494.396.282.21.451.533.451.961,0,.524-.347.984-.92,1.194v.016c.517.129,1.122.557,1.122,1.364,0,.468-.186.823-.46,1.09-.38.347-.993.508-1.881.508-.484,0-.855-.032-1.09-.064v-5.352ZM139.005,34.746h.638c.743,0,1.179-.387,1.179-.912,0-.638-.484-.888-1.194-.888-.323,0-.509.024-.622.048v1.751ZM139.005,37.354c.138.024.339.032.59.032.727,0,1.396-.266,1.396-1.058,0-.742-.638-1.049-1.405-1.049h-.581v2.075Z"
      />
      <path
        fill={on("r1") ? DIAGRAM.accentText : DIAGRAM.label}
        d="M142.568,9.788c.188-.039.457-.06.713-.06.397,0,.654.073.833.235.146.128.227.325.227.547,0,.38-.239.632-.542.735v.013c.222.077.354.282.423.581.094.402.162.679.222.791h-.385c-.047-.081-.11-.329-.191-.688-.086-.397-.24-.547-.577-.56h-.351v1.248h-.371v-2.841ZM142.939,11.1h.381c.396,0,.648-.218.648-.547,0-.372-.269-.534-.662-.539-.179,0-.308.017-.367.034v1.051Z"
      />
      <path
        fill={on("l1") ? DIAGRAM.accentText : DIAGRAM.label}
        d="M5.64,9.75h.371v2.568h1.23v.312h-1.602v-2.88Z"
      />
    </svg>
  );
}
