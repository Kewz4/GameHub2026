import type {
  EmulatedControllerType,
  EmulatorBinary,
  PadControl,
} from "@types";

/**
 * Per-emulator / per-emulated-controller control layouts.
 *
 * The audit of controller-writers.ts showed the consoles are NOT
 * interchangeable — a GameCube pad has no Select or stick clicks, a Wii Remote
 * is a different layout entirely, etc. Each layout lists only the controls that
 * console actually uses (so users don't bind buttons the emulator ignores) and
 * which visual diagram to show.
 */

export type DiagramKind = "switch-pro" | "gamecube" | null;

export interface ControlDef {
  control: PadControl;
  label: string;
}

export interface ControllerLayout {
  diagram: DiagramKind;
  controls: ControlDef[];
}

const DPAD: ControlDef[] = [
  { control: "up", label: "D-Pad Up" },
  { control: "down", label: "D-Pad Down" },
  { control: "left", label: "D-Pad Left" },
  { control: "right", label: "D-Pad Right" },
];

const L_STICK: ControlDef[] = [
  { control: "lstick_up", label: "Left Stick Up" },
  { control: "lstick_down", label: "Left Stick Down" },
  { control: "lstick_left", label: "Left Stick Left" },
  { control: "lstick_right", label: "Left Stick Right" },
];

const R_STICK: ControlDef[] = [
  { control: "rstick_up", label: "Right Stick Up" },
  { control: "rstick_down", label: "Right Stick Down" },
  { control: "rstick_left", label: "Right Stick Left" },
  { control: "rstick_right", label: "Right Stick Right" },
];

// Full modern twin-stick pad (Switch Pro / Wii U Pro / DualShock / RetroPad).
const FULL: ControllerLayout = {
  diagram: "switch-pro",
  controls: [
    ...DPAD,
    { control: "a", label: "A (bottom face)" },
    { control: "b", label: "B (right face)" },
    { control: "x", label: "X (left face)" },
    { control: "y", label: "Y (top face)" },
    { control: "l1", label: "L / L1 (shoulder)" },
    { control: "r1", label: "R / R1 (shoulder)" },
    { control: "l2", label: "ZL / L2 (trigger)" },
    { control: "r2", label: "ZR / R2 (trigger)" },
    { control: "l3", label: "L3 (left stick click)" },
    { control: "r3", label: "R3 (right stick click)" },
    { control: "select", label: "Select / Minus" },
    { control: "start", label: "Start / Plus" },
    ...L_STICK,
    ...R_STICK,
  ],
};

// GameCube: no Select, no stick clicks. L/R are analog triggers, plus a Z
// button (Dolphin maps Z to the R1 slot). Right stick = the C-Stick.
const GAMECUBE: ControllerLayout = {
  diagram: "gamecube",
  controls: [
    ...DPAD,
    { control: "a", label: "A" },
    { control: "b", label: "B" },
    { control: "x", label: "X" },
    { control: "y", label: "Y" },
    { control: "l2", label: "L (analog trigger)" },
    { control: "r2", label: "R (analog trigger)" },
    { control: "r1", label: "Z" },
    { control: "start", label: "Start / Pause" },
    ...L_STICK.map((c) => ({
      ...c,
      label: c.label.replace("Left", "Control"),
    })),
    ...R_STICK.map((c) => ({ ...c, label: c.label.replace("Right", "C-") })),
  ],
};

// Wii Remote (sideways): a distinct layout, no bespoke diagram yet.
const WIIMOTE: ControllerLayout = {
  diagram: null,
  controls: [
    ...DPAD,
    { control: "a", label: "A" },
    { control: "b", label: "B (trigger)" },
    { control: "x", label: "1" },
    { control: "y", label: "2" },
    { control: "select", label: "Minus" },
    { control: "start", label: "Plus" },
    { control: "r3", label: "Home" },
  ],
};

/** Resolve the layout for an emulator + selected emulated controller type. */
export function layoutFor(
  binary: EmulatorBinary,
  type: EmulatedControllerType | null
): ControllerLayout {
  if (binary === "dolphin") {
    if (type === "wiimote") return WIIMOTE;
    if (type === "gamecube") return GAMECUBE;
  }
  // Cemu (Wii U GamePad/Pro/Classic), PCSX2, RPCS3, Azahar, RALibretro all use
  // a full twin-stick layout with the Switch Pro diagram as the closest match.
  return FULL;
}
