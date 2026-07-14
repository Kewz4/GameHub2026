import fs from "node:fs";
import path from "node:path";
import type {
  ControllerProfile,
  EmulatedControllerType,
  PadControl,
} from "@types";

/**
 * One controller profile → every emulator's native controller config.
 *
 * The profile is physical-position centric (`a` = bottom face button, `b` =
 * right, `x` = left, `y` = top) and each control is bound to an SDL
 * GameController token. Every emulator we target consumes SDL under the hood,
 * so each writer just translates the shared profile into that emulator's config
 * syntax (verified from each emulator's source). Writing once and applying to
 * all is how one XInput pad gets set up everywhere.
 */

/** The default standard mapping for a modern XInput/SDL pad (controller 0). */
export const DEFAULT_CONTROLLER_PROFILE: ControllerProfile = {
  controllerName: null,
  controllerIndex: 0,
  controllerGuid: null,
  bindings: {
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
  },
};

const bind = (p: ControllerProfile, c: PadControl): string => p.bindings[c];

// ─── RALibretro (RALibretro.json "bindings", SDL tokens) ──────────────────────
// RALibretro uses SNES-style face labels: its A = right face, B = bottom,
// X = top, Y = left. Map our physical positions accordingly (matches the
// hand-tuned config the user shipped).
export function ralibretroBindings(
  p: ControllerProfile
): Record<string, string> {
  const j = `J${p.controllerIndex}`;
  const tok = (c: PadControl) => `${j} ${bind(p, c)}`;
  return {
    J0_UP: tok("up"),
    J0_DOWN: tok("down"),
    J0_LEFT: tok("left"),
    J0_RIGHT: tok("right"),
    J0_A: tok("b"), // RA "A" = right face
    J0_B: tok("a"), // RA "B" = bottom face
    J0_X: tok("y"), // RA "X" = top face
    J0_Y: tok("x"), // RA "Y" = left face
    J0_L: tok("l1"),
    J0_R: tok("r1"),
    J0_L2: tok("l2"),
    J0_R2: tok("r2"),
    J0_L3: tok("l3"),
    J0_R3: tok("r3"),
    J0_SELECT: tok("select"),
    J0_START: tok("start"),
    J0_LSTICK_LEFT: tok("lstick_left"),
    J0_LSTICK_RIGHT: tok("lstick_right"),
    J0_LSTICK_UP: tok("lstick_up"),
    J0_LSTICK_DOWN: tok("lstick_down"),
    J0_RSTICK_LEFT: tok("rstick_left"),
    J0_RSTICK_RIGHT: tok("rstick_right"),
    J0_RSTICK_UP: tok("rstick_up"),
    J0_RSTICK_DOWN: tok("rstick_down"),
  };
}

export function writeRalibretro(
  installDir: string,
  p: ControllerProfile
): boolean {
  const file = path.join(installDir, "RALibretro.json");
  let json: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    try {
      json = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      json = {};
    }
  }
  const existing = (json.bindings as Record<string, string>) ?? {};
  json.bindings = { ...existing, ...ralibretroBindings(p) };
  fs.writeFileSync(file, JSON.stringify(json));
  return true;
}

// ─── PCSX2 (inis/PCSX2.ini [Pad1], SDL-0/ tokens) ─────────────────────────────
// Translate an SDL token to PCSX2's SDL token vocabulary (v2.x stable).
const PCSX2_TOKEN: Record<string, string> = {
  a: "A",
  b: "B",
  x: "X",
  y: "Y",
  dpup: "DPadUp",
  dpdown: "DPadDown",
  dpleft: "DPadLeft",
  dpright: "DPadRight",
  leftshoulder: "LeftShoulder",
  rightshoulder: "RightShoulder",
  lefttrigger: "+LeftTrigger",
  righttrigger: "+RightTrigger",
  leftstick: "LeftStick",
  rightstick: "RightStick",
  back: "Back",
  start: "Start",
  "-leftx": "-LeftX",
  "+leftx": "+LeftX",
  "-lefty": "-LeftY",
  "+lefty": "+LeftY",
  "-rightx": "-RightX",
  "+rightx": "+RightX",
  "-righty": "-RightY",
  "+righty": "+RightY",
};

export function pcsx2PadSection(p: ControllerProfile): string {
  const d = `SDL-${p.controllerIndex}`;
  const v = (c: PadControl) => `${d}/${PCSX2_TOKEN[bind(p, c)] ?? bind(p, c)}`;
  const lines = [
    "[Pad1]",
    "Type = DualShock2",
    `Up = ${v("up")}`,
    `Right = ${v("right")}`,
    `Down = ${v("down")}`,
    `Left = ${v("left")}`,
    `Cross = ${v("a")}`,
    `Circle = ${v("b")}`,
    `Square = ${v("x")}`,
    `Triangle = ${v("y")}`,
    `Start = ${v("start")}`,
    `Select = ${v("select")}`,
    `L1 = ${v("l1")}`,
    `R1 = ${v("r1")}`,
    `L2 = ${v("l2")}`,
    `R2 = ${v("r2")}`,
    `L3 = ${v("l3")}`,
    `R3 = ${v("r3")}`,
    `LUp = ${v("lstick_up")}`,
    `LDown = ${v("lstick_down")}`,
    `LLeft = ${v("lstick_left")}`,
    `LRight = ${v("lstick_right")}`,
    `RUp = ${v("rstick_up")}`,
    `RDown = ${v("rstick_down")}`,
    `RLeft = ${v("rstick_left")}`,
    `RRight = ${v("rstick_right")}`,
  ];
  return lines.join("\n");
}

// ─── RPCS3 (config/input_configs/global/Default.yml, XInput handler) ──────────
const RPCS3_XINPUT: Record<string, string> = {
  a: "A",
  b: "B",
  x: "X",
  y: "Y",
  dpup: "Up",
  dpdown: "Down",
  dpleft: "Left",
  dpright: "Right",
  leftshoulder: "LB",
  rightshoulder: "RB",
  lefttrigger: "LT",
  righttrigger: "RT",
  leftstick: "LS",
  rightstick: "RS",
  back: "Back",
  start: "Start",
  "-leftx": "LS X-",
  "+leftx": "LS X+",
  "-lefty": "LS Y+", // SDL Y is down-positive; RPCS3 "up" = Y+
  "+lefty": "LS Y-",
  "-rightx": "RS X-",
  "+rightx": "RS X+",
  "-righty": "RS Y+",
  "+righty": "RS Y-",
};

export function rpcs3Yaml(p: ControllerProfile): string {
  const t = (c: PadControl) => RPCS3_XINPUT[bind(p, c)] ?? "";
  return [
    "Player 1 Input:",
    "  Handler: XInput",
    `  Device: XInput Pad #${p.controllerIndex + 1}`,
    "  Config:",
    `    Left Stick Left: ${t("lstick_left")}`,
    `    Left Stick Down: ${t("lstick_down")}`,
    `    Left Stick Right: ${t("lstick_right")}`,
    `    Left Stick Up: ${t("lstick_up")}`,
    `    Right Stick Left: ${t("rstick_left")}`,
    `    Right Stick Down: ${t("rstick_down")}`,
    `    Right Stick Right: ${t("rstick_right")}`,
    `    Right Stick Up: ${t("rstick_up")}`,
    `    Start: ${t("start")}`,
    `    Select: ${t("select")}`,
    "    PS Button: Guide",
    `    Square: ${t("x")}`,
    `    Cross: ${t("a")}`,
    `    Circle: ${t("b")}`,
    `    Triangle: ${t("y")}`,
    `    Left: ${t("left")}`,
    `    Down: ${t("down")}`,
    `    Right: ${t("right")}`,
    `    Up: ${t("up")}`,
    `    R1: ${t("r1")}`,
    `    R2: ${t("r2")}`,
    `    R3: ${t("r3")}`,
    `    L1: ${t("l1")}`,
    `    L2: ${t("l2")}`,
    `    L3: ${t("l3")}`,
  ].join("\n");
}

// ─── Dolphin (Config/GCPadNew.ini [GCPad1], SDL named tokens) ─────────────────
const DOLPHIN_TOKEN: Record<string, string> = {
  a: "Button A",
  b: "Button B",
  x: "Button X",
  y: "Button Y",
  dpup: "Pad N",
  dpdown: "Pad S",
  dpleft: "Pad W",
  dpright: "Pad E",
  leftshoulder: "Shoulder L",
  rightshoulder: "Shoulder R",
  lefttrigger: "Trigger L",
  righttrigger: "Trigger R",
  leftstick: "Thumb L",
  rightstick: "Thumb R",
  back: "Button Back",
  start: "Button Start",
  "-leftx": "Left X-",
  "+leftx": "Left X+",
  "-lefty": "Left Y-",
  "+lefty": "Left Y+",
  "-rightx": "Right X-",
  "+rightx": "Right X+",
  "-righty": "Right Y-",
  "+righty": "Right Y+",
};

export function dolphinGcPadSection(p: ControllerProfile): string {
  const q = (c: PadControl) => `\`${DOLPHIN_TOKEN[bind(p, c)] ?? bind(p, c)}\``;
  return [
    "[GCPad1]",
    `Device = SDL/${p.controllerIndex}/Controller`,
    `Buttons/A = ${q("a")}`,
    `Buttons/B = ${q("b")}`,
    `Buttons/X = ${q("x")}`,
    `Buttons/Y = ${q("y")}`,
    `Buttons/Z = ${q("r1")}`,
    `Buttons/Start = ${q("start")}`,
    `D-Pad/Up = ${q("up")}`,
    `D-Pad/Down = ${q("down")}`,
    `D-Pad/Left = ${q("left")}`,
    `D-Pad/Right = ${q("right")}`,
    `Main Stick/Up = ${q("lstick_up")}`,
    `Main Stick/Down = ${q("lstick_down")}`,
    `Main Stick/Left = ${q("lstick_left")}`,
    `Main Stick/Right = ${q("lstick_right")}`,
    `C-Stick/Up = ${q("rstick_up")}`,
    `C-Stick/Down = ${q("rstick_down")}`,
    `C-Stick/Left = ${q("rstick_left")}`,
    `C-Stick/Right = ${q("rstick_right")}`,
    `Triggers/L = ${q("l1")}`,
    `Triggers/R = ${q("r1")}`,
    `Triggers/L-Analog = ${q("l2")}`,
    `Triggers/R-Analog = ${q("r2")}`,
  ].join("\n");
}

/** Dolphin Wii Remote (sideways-Wiimote button mapping + optional motion). */
export function dolphinWiimoteSection(p: ControllerProfile): string {
  const q = (c: PadControl) => `\`${DOLPHIN_TOKEN[bind(p, c)] ?? bind(p, c)}\``;
  const lines = [
    "[Wiimote1]",
    "Source = 1",
    `Device = SDL/${p.controllerIndex}/Controller`,
    `Buttons/A = ${q("a")}`,
    `Buttons/B = ${q("b")}`,
    `Buttons/1 = ${q("x")}`,
    `Buttons/2 = ${q("y")}`,
    `Buttons/- = ${q("select")}`,
    `Buttons/+ = ${q("start")}`,
    `Buttons/Home = ${q("r3")}`,
    `D-Pad/Up = ${q("up")}`,
    `D-Pad/Down = ${q("down")}`,
    `D-Pad/Left = ${q("left")}`,
    `D-Pad/Right = ${q("right")}`,
  ];
  if (p.motion) {
    // Native SDL controller gyro/accel (DualShock4/DualSense/Switch pads).
    lines.push(
      "IMUGyroscope/Pitch Up = `Gyro Pitch Up`",
      "IMUGyroscope/Pitch Down = `Gyro Pitch Down`",
      "IMUGyroscope/Roll Left = `Gyro Roll Left`",
      "IMUGyroscope/Roll Right = `Gyro Roll Right`",
      "IMUGyroscope/Yaw Left = `Gyro Yaw Left`",
      "IMUGyroscope/Yaw Right = `Gyro Yaw Right`",
      "IMUAccelerometer/Up = `Accel Up`",
      "IMUAccelerometer/Down = `Accel Down`",
      "IMUAccelerometer/Left = `Accel Left`",
      "IMUAccelerometer/Right = `Accel Right`",
      "IMUAccelerometer/Forward = `Accel Forward`",
      "IMUAccelerometer/Backward = `Accel Backward`"
    );
  }
  return lines.join("\n");
}

// ─── Cemu (controllerProfiles/controllerN.xml) ────────────────────────────────
// SDL GameController token → Cemu physical control id (Buttons2 enum). Digital
// buttons use the SDL3 button index (identity); analog directions use the
// dedicated half-axis ids 38–49.
const CEMU_BUTTON: Record<string, number> = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  back: 4,
  guide: 5,
  start: 6,
  leftstick: 7,
  rightstick: 8,
  leftshoulder: 9,
  rightshoulder: 10,
  dpup: 11,
  dpdown: 12,
  dpleft: 13,
  dpright: 14,
  lefttrigger: 42, // kTriggerXP
  righttrigger: 43, // kTriggerYP
  "+leftx": 38, // kAxisXP (right)
  "-leftx": 44, // kAxisXN (left)
  "+lefty": 39, // kAxisYP (down)
  "-lefty": 45, // kAxisYN (up)
  "+rightx": 40,
  "-rightx": 46,
  "+righty": 41,
  "-righty": 47,
};

const CEMU_TYPE_STRING: Record<string, string> = {
  wiiu_gamepad: "Wii U GamePad",
  wiiu_pro: "Wii U Pro Controller",
  wiiu_classic: "Wii U Classic Controller",
};

// Wii U GamePad emulated-button ids (VPADController::ButtonId) → our control.
const CEMU_VPAD_MAP: [number, PadControl][] = [
  [1, "a"],
  [2, "b"],
  [3, "x"],
  [4, "y"],
  [5, "l1"],
  [6, "r1"],
  [7, "l2"],
  [8, "r2"],
  [9, "start"],
  [10, "select"],
  [11, "up"],
  [12, "down"],
  [13, "left"],
  [14, "right"],
  [15, "l3"],
  [16, "r3"],
  [17, "lstick_up"],
  [18, "lstick_down"],
  [19, "lstick_left"],
  [20, "lstick_right"],
  [21, "rstick_up"],
  [22, "rstick_down"],
  [23, "rstick_left"],
  [24, "rstick_right"],
];

export function cemuControllerXml(
  p: ControllerProfile,
  type: EmulatedControllerType = "wiiu_gamepad"
): string {
  const uuid = `${p.controllerIndex}_${p.controllerGuid ?? "0".repeat(32)}`;
  const entries = CEMU_VPAD_MAP.map(([mapping, control]) => {
    const btn = CEMU_BUTTON[bind(p, control)];
    if (btn === undefined) return "";
    return `      <entry><mapping>${mapping}</mapping><button>${btn}</button></entry>`;
  })
    .filter(Boolean)
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<emulated_controller>",
    `  <type>${CEMU_TYPE_STRING[type] ?? "Wii U GamePad"}</type>`,
    "  <controller>",
    "    <api>SDLController</api>",
    `    <uuid>${uuid}</uuid>`,
    "    <display_name>Controller 1</display_name>",
    `    <motion>${p.motion ? "true" : "false"}</motion>`,
    "    <axis><deadzone>0.25</deadzone><range>1</range></axis>",
    "    <rotation><deadzone>0.25</deadzone><range>1</range></rotation>",
    "    <trigger><deadzone>0.25</deadzone><range>1</range></trigger>",
    "    <mappings>",
    entries,
    "    </mappings>",
    "  </controller>",
    "</emulated_controller>",
  ].join("\n");
}

// ─── Azahar / Citra (qt-config.ini [Controls]) ───────────────────────────────
// SDL GameController token → SDL2 joystick button index (standard layout).
const AZAHAR_BUTTON: Record<string, number> = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  leftshoulder: 4,
  rightshoulder: 5,
  back: 6,
  start: 7,
  leftstick: 8,
  rightstick: 9,
  guide: 10,
};

export function azaharControls(p: ControllerProfile): string {
  const guid = p.controllerGuid ?? "0".repeat(32);
  const port = p.controllerIndex;
  const btn = (c: PadControl) => {
    const tok = bind(p, c);
    const i = AZAHAR_BUTTON[tok];
    return i === undefined
      ? ""
      : `engine:sdl,guid:${guid},port:${port},button:${i}`;
  };
  const hat = (dir: string) =>
    `engine:sdl,guid:${guid},port:${port},hat:0,direction:${dir}`;
  const axisBtn = (axis: number, sign: string) =>
    `engine:sdl,guid:${guid},port:${port},axis:${axis},direction:${sign},threshold:${sign === "+" ? "0.5" : "-0.5"}`;
  const stick = (ax: number, ay: number) =>
    `engine:sdl,guid:${guid},port:${port},axis_x:${ax},axis_y:${ay}`;
  const q = (v: string) => `"${v}"`;

  return [
    "[Controls]",
    "profiles\\size=1",
    "profiles\\1\\name=GameHub",
    `profiles\\1\\button_a=${q(btn("a"))}`,
    `profiles\\1\\button_b=${q(btn("b"))}`,
    `profiles\\1\\button_x=${q(btn("x"))}`,
    `profiles\\1\\button_y=${q(btn("y"))}`,
    `profiles\\1\\button_up=${q(hat("up"))}`,
    `profiles\\1\\button_down=${q(hat("down"))}`,
    `profiles\\1\\button_left=${q(hat("left"))}`,
    `profiles\\1\\button_right=${q(hat("right"))}`,
    `profiles\\1\\button_l=${q(btn("l1"))}`,
    `profiles\\1\\button_r=${q(btn("r1"))}`,
    `profiles\\1\\button_zl=${q(axisBtn(2, "+"))}`,
    `profiles\\1\\button_zr=${q(axisBtn(5, "+"))}`,
    `profiles\\1\\button_start=${q(btn("start"))}`,
    `profiles\\1\\button_select=${q(btn("select"))}`,
    `profiles\\1\\circle_pad=${q(stick(0, 1))}`,
    `profiles\\1\\c_stick=${q(stick(3, 4))}`,
  ].join("\n");
}

// ─── Eden / Yuzu (qt-config.ini [Controls]) ──────────────────────────────────
// Eden (Yuzu/Sudachi derivative) uses ParamPackage strings in qt-config.ini
// [Controls] section, same format as Azahar/Citra but with different key names
// (player_N_button_a, player_N_lstick, etc.) and SDL3 button indices.
const EDEN_BUTTON: Record<string, number> = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  leftshoulder: 4,
  rightshoulder: 5,
  lefttrigger: 6,
  righttrigger: 7,
  back: 8,
  start: 9,
  leftstick: 10,
  rightstick: 11,
  dpup: 12,
  dpdown: 13,
  dpleft: 14,
  dpright: 15,
  guide: 16,
};

export function edenControls(p: ControllerProfile): string {
  const guid = p.controllerGuid ?? "0".repeat(32);
  const port = p.controllerIndex;
  const q = (v: string) => `"${v}"`;

  const btn = (c: PadControl) => {
    const tok = bind(p, c);
    const i = EDEN_BUTTON[tok];
    return i === undefined
      ? ""
      : `engine:sdl,guid:${guid},port:${port},button:${i}`;
  };
  const hat = (dir: string) =>
    `engine:sdl,guid:${guid},port:${port},hat:0,direction:${dir}`;
  const axisBtn = (axis: number, sign: string) =>
    `engine:sdl,guid:${guid},port:${port},axis:${axis},direction:${sign},threshold:${sign === "+" ? "0.5" : "-0.5"}`;
  const stick = (ax: number, ay: number) =>
    `engine:sdl,guid:${guid},port:${port},axis_x:${ax},axis_y:${ay}`;

  // Motion binding (CemuhookUDP on localhost:26760 for SteamDeckGyroDSU,
  // or SDL motion if the controller supports it).
  const motion = p.motion
    ? `engine:sdl,guid:${guid},port:${port},motion:0`
    : "engine:sdl,motion:0";

  return [
    "[Controls]",
    `player_0_connected=true`,
    `player_0_type=0`,
    `player_0_button_a=${q(btn("a"))}`,
    `player_0_button_b=${q(btn("b"))}`,
    `player_0_button_x=${q(btn("x"))}`,
    `player_0_button_y=${q(btn("y"))}`,
    `player_0_button_up=${q(hat("up"))}`,
    `player_0_button_down=${q(hat("down"))}`,
    `player_0_button_left=${q(hat("left"))}`,
    `player_0_button_right=${q(hat("right"))}`,
    `player_0_button_l=${q(btn("l1"))}`,
    `player_0_button_r=${q(btn("r1"))}`,
    `player_0_button_zl=${q(btn("l2"))}`,
    `player_0_button_zr=${q(btn("r2"))}`,
    `player_0_button_plus=${q(btn("start"))}`,
    `player_0_button_minus=${q(btn("select"))}`,
    `player_0_button_lstick=${q(btn("l3"))}`,
    `player_0_button_rstick=${q(btn("r3"))}`,
    `player_0_button_home=${q(btn("start"))}`,
    `player_0_button_screenshot=${q(btn("select"))}`,
    `player_0_lstick=${q(stick(0, 1))}`,
    `player_0_rstick=${q(stick(2, 3))}`,
    `player_0_motionleft=${q(motion)}`,
    `player_0_motionright=${q(motion)}`,
    `player_0_vibration_enabled=true`,
    `player_0_vibration_strength=100`,
  ].join("\n");
}
