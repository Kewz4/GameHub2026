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
  | "z"
  // N64 C-buttons — conventionally the right analog stick on a RetroPad.
  | "cup"
  | "cdown"
  | "cleft"
  | "cright";

/**
 * The standard SDL GameController mapping (matches the main process
 * DEFAULT_CONTROLLER_PROFILE). This is the reliable out-of-the-box mapping for
 * ANY controller the emulator's SDL layer recognises — including DirectInput /
 * DualShock pads — because SDL maps the physical device to these tokens via its
 * gamecontrollerdb. Used by the mapper's "reset to default" action.
 */
export const DEFAULT_PAD_BINDINGS: Record<string, string> = {
  up: "dpup",
  down: "dpdown",
  left: "dpleft",
  right: "dpright",
  a: "a",
  b: "b",
  x: "x",
  y: "y",
  l1: "leftshoulder",
  r1: "rightshoulder",
  l2: "lefttrigger",
  r2: "righttrigger",
  l3: "leftstick",
  r3: "rightstick",
  select: "back",
  start: "start",
  lstick_up: "-lefty",
  lstick_down: "+lefty",
  lstick_left: "-leftx",
  lstick_right: "+leftx",
  rstick_up: "-righty",
  rstick_down: "+righty",
  rstick_left: "-rightx",
  rstick_right: "+rightx",
};

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

/**
 * Synthesize the 32-char SDL joystick GUID for a controller from its USB
 * vendor/product IDs, matching SDL's own `SDL_CreateJoystickGUID` layout so the
 * value we write lines up with what SDL reports inside the emulator.
 *
 * Layout (16 bytes, each 16-bit field little-endian):
 *   bus(=USB 0x03) · crc16(0) · vendor · 0 · product · 0 · version(0) · driver(0)
 *
 * e.g. a DualShock 4 (vendor 054c, product 09cc) →
 *   "030000004c050000cc09000000000000" — the exact GUID SDL emits for it.
 *
 * The joystick-engine emulators (Azahar, Eden) bind by GUID, so without this
 * they fall back to an all-zero GUID that never matches a real device and the
 * pad silently fails to bind. XInput pads are unaffected — they bind by
 * SDL GameController token/index, not GUID.
 */
export function synthesizeSdlGuid(
  vendorId: number,
  productId: number
): string | null {
  if (!vendorId || !productId) return null;
  const le16 = (n: number) => {
    const lo = (n & 0xff).toString(16).padStart(2, "0");
    const hi = ((n >> 8) & 0xff).toString(16).padStart(2, "0");
    return lo + hi;
  };
  const BUS_USB = "0300"; // bus type 0x0003, little-endian
  return (
    BUS_USB +
    "0000" + // crc16 (unknown → 0)
    le16(vendorId) +
    "0000" +
    le16(productId) +
    "0000" +
    "0000" + // version (unknown → 0)
    "0000" // driver signature/data
  );
}

/**
 * Extract USB vendor/product IDs from a Gamepad API `id` string. Chromium
 * formats non-standard pads as "… (Vendor: 054c Product: 09cc)" and standard
 * ones as "… (STANDARD GAMEPAD Vendor: 045e Product: 028e)". Returns null when
 * the id carries no IDs (some drivers omit them).
 */
export function parseGamepadVendorProduct(
  id: string
): { vendorId: number; productId: number } | null {
  const m = /vendor:\s*([0-9a-f]{4}).*?product:\s*([0-9a-f]{4})/i.exec(id);
  if (!m) return null;
  return { vendorId: parseInt(m[1], 16), productId: parseInt(m[2], 16) };
}
