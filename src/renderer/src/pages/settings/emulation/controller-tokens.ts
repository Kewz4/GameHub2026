/**
 * SDL GameController token ↔ Web Gamepad API translation, shared by the
 * mapper UI and the diagram's binding-resolved highlighting.
 */

/** Emulated controls a diagram can render/highlight (superset across pads). */
export type DiagramControl =
  | "a"
  | "b"
  | "x"
  | "y"
  | "l1"
  | "r1"
  | "l2"
  | "r2"
  | "l3"
  | "r3"
  | "select"
  | "start"
  | "up"
  | "down"
  | "left"
  | "right"
  | "guide"
  | "capture"
  | "z";

// Standard Gamepad API button index → SDL GameController token.
export const BUTTON_TOKEN: Record<number, string> = {
  0: "a",
  1: "b",
  2: "x",
  3: "y",
  4: "leftshoulder",
  5: "rightshoulder",
  6: "lefttrigger",
  7: "righttrigger",
  8: "back",
  9: "start",
  10: "leftstick",
  11: "rightstick",
  12: "dpup",
  13: "dpdown",
  14: "dpleft",
  15: "dpright",
  16: "guide",
};

// Standard Gamepad API axis index → SDL axis name.
export const AXIS_NAME: Record<number, string> = {
  0: "leftx",
  1: "lefty",
  2: "rightx",
  3: "righty",
};

export const AXIS_THRESHOLD = 0.6;

// Reverse of BUTTON_TOKEN: SDL token → Gamepad API button index.
export const TOKEN_BUTTON: Record<string, number> = Object.fromEntries(
  Object.entries(BUTTON_TOKEN).map(([idx, token]) => [token, Number(idx)])
);

// SDL axis name → Gamepad API axis index.
export const AXIS_INDEX: Record<string, number> = {
  leftx: 0,
  lefty: 1,
  rightx: 2,
  righty: 3,
};

/**
 * Analog activation (0–1) of one SDL binding token against live pad state.
 * This is what makes the diagram highlight the EMULATED control the user
 * bound, not the physical button with the same name: pressing physical Y on
 * an Xbox pad bound to emulated A lights A on the diagram.
 *   - button tokens ("a", "leftshoulder"…) → pressed ? 1 : 0
 *   - signed axis tokens ("+leftx", "-lefty"…) → deflection in that direction
 */
export function tokenActivation(
  token: string | undefined,
  pressed: boolean[],
  axes: number[]
): number {
  if (!token || token === "none") return 0;

  const sign = token[0] === "+" || token[0] === "-" ? token[0] : null;
  if (sign) {
    const axisIdx = AXIS_INDEX[token.slice(1)];
    if (axisIdx === undefined) return 0;
    const v = axes[axisIdx] ?? 0;
    return Math.max(0, sign === "+" ? v : -v);
  }

  const btnIdx = TOKEN_BUTTON[token];
  if (btnIdx === undefined) return 0;
  return pressed[btnIdx] ? 1 : 0;
}
