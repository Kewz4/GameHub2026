import fs from "node:fs";
import path from "node:path";
import type { ControllerProfile, PadControl } from "@types";

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
