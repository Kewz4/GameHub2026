import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ControllerProfile,
  EmulatedControllerType,
  EmulatorBinary,
  PadControl,
} from "@types";
import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import { SwitchProDiagram, type DiagramControl } from "./switch-pro-diagram";
import "./controller-mapper.scss";

/** Diagram control → our PadControl (buttons that map 1:1). */
const DIAGRAM_TO_CONTROL: Partial<Record<DiagramControl, PadControl>> = {
  a: "a",
  b: "b",
  x: "x",
  y: "y",
  l1: "l1",
  r1: "r1",
  l2: "l2",
  r2: "r2",
  l3: "l3",
  r3: "r3",
  select: "select",
  start: "start",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
};

/** Emulated-controller kinds offered per emulator that supports several. */
const CONTROLLER_TYPES: Partial<
  Record<EmulatorBinary, { value: EmulatedControllerType; label: string }[]>
> = {
  cemu: [
    { value: "wiiu_gamepad", label: "Wii U GamePad" },
    { value: "wiiu_pro", label: "Wii U Pro Controller" },
    { value: "wiiu_classic", label: "Classic Controller" },
  ],
  dolphin: [
    { value: "gamecube", label: "GameCube Controller" },
    { value: "wiimote", label: "Wii Remote" },
  ],
};

/**
 * Live controller mapper. Detects connected pads via the Gamepad API (XInput /
 * DirectInput on Windows), lets the user remap any control by pressing the
 * physical button/stick ("click detection"), and applies the one profile to
 * every installed emulator via saveControllerProfile.
 */

const CONTROLS: { control: PadControl; label: string }[] = [
  { control: "up", label: "D-Pad Up" },
  { control: "down", label: "D-Pad Down" },
  { control: "left", label: "D-Pad Left" },
  { control: "right", label: "D-Pad Right" },
  { control: "a", label: "A (bottom face)" },
  { control: "b", label: "B (right face)" },
  { control: "x", label: "X (left face)" },
  { control: "y", label: "Y (top face)" },
  { control: "l1", label: "L1 (left shoulder)" },
  { control: "r1", label: "R1 (right shoulder)" },
  { control: "l2", label: "L2 (left trigger)" },
  { control: "r2", label: "R2 (right trigger)" },
  { control: "l3", label: "L3 (left stick click)" },
  { control: "r3", label: "R3 (right stick click)" },
  { control: "select", label: "Select / Back" },
  { control: "start", label: "Start" },
  { control: "lstick_up", label: "Left Stick Up" },
  { control: "lstick_down", label: "Left Stick Down" },
  { control: "lstick_left", label: "Left Stick Left" },
  { control: "lstick_right", label: "Left Stick Right" },
  { control: "rstick_up", label: "Right Stick Up" },
  { control: "rstick_down", label: "Right Stick Down" },
  { control: "rstick_left", label: "Right Stick Left" },
  { control: "rstick_right", label: "Right Stick Right" },
];

// Standard Gamepad API button index → SDL GameController token.
const BUTTON_TOKEN: Record<number, string> = {
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
const AXIS_NAME: Record<number, string> = {
  0: "leftx",
  1: "lefty",
  2: "rightx",
  3: "righty",
};

const AXIS_THRESHOLD = 0.6;

/** Human label for an SDL token, for display. */
function tokenLabel(token: string): string {
  if (!token || token === "none") return "—";
  return token;
}

interface Props {
  /** The emulator this mapper is shown under (for per-console overrides). */
  binary: EmulatorBinary;
}

export function ControllerMappingSection({ binary }: Readonly<Props>) {
  const { showSuccessToast, showErrorToast } = useToast();
  const [profile, setProfile] = useState<ControllerProfile | null>(null);
  const [pads, setPads] = useState<{ index: number; id: string }[]>([]);
  const [selectedPad, setSelectedPad] = useState<number>(0);
  const [capturing, setCapturing] = useState<PadControl | null>(null);
  const [applying, setApplying] = useState(false);
  const [scope, setScope] = useState<"global" | "custom">("global");
  const [controllerType, setControllerType] =
    useState<EmulatedControllerType | null>(null);
  const captureRef = useRef<PadControl | null>(null);
  const rafRef = useRef<number | null>(null);

  // Live input for the diagram + raw-data readout.
  const [livePressed, setLivePressed] = useState<boolean[]>([]);
  const [liveAxes, setLiveAxes] = useState<number[]>([]);
  const [hovered, setHovered] = useState<DiagramControl | null>(null);
  const [rumbling, setRumbling] = useState(false);

  const typeOptions = CONTROLLER_TYPES[binary];

  const loadProfile = useCallback(
    (asBinary: EmulatorBinary | undefined) => {
      window.electron
        .getControllerProfile(asBinary)
        .then((res) => {
          setProfile(res.profile);
          if (res.type) setControllerType(res.type);
          else if (typeOptions) setControllerType(typeOptions[0].value);
        })
        .catch(() => {});
    },
    [typeOptions]
  );

  useEffect(() => {
    // Discover whether this emulator already has a custom override.
    window.electron
      .getControllerProfile(binary)
      .then((res) => {
        setScope(res.isCustom ? "custom" : "global");
        loadProfile(res.isCustom ? binary : undefined);
      })
      .catch(() => loadProfile(undefined));
  }, [binary, loadProfile]);

  // Poll connected controllers so the list stays live.
  useEffect(() => {
    const scan = () => {
      const gps = navigator.getGamepads?.() ?? [];
      const list: { index: number; id: string }[] = [];
      for (const gp of gps) {
        if (gp) list.push({ index: gp.index, id: gp.id });
      }
      setPads(list);
    };
    scan();
    const onConnect = () => scan();
    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onConnect);
    const id = window.setInterval(scan, 1500);
    return () => {
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onConnect);
      window.clearInterval(id);
    };
  }, []);

  // Continuously read the selected pad so the diagram lights up live.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const gp = (navigator.getGamepads?.() ?? [])[selectedPad];
      if (gp) {
        setLivePressed(gp.buttons.map((b) => b.pressed));
        setLiveAxes(Array.from(gp.axes));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selectedPad]);

  const testRumble = useCallback(() => {
    const gp = (navigator.getGamepads?.() ?? [])[selectedPad];
    const actuator = (
      gp as (Gamepad & { vibrationActuator?: GamepadHapticActuator }) | null
    )?.vibrationActuator;
    if (!actuator || typeof actuator.playEffect !== "function") {
      showErrorToast("This controller doesn't expose rumble in the browser.");
      return;
    }
    setRumbling(true);
    actuator
      .playEffect("dual-rumble", {
        duration: 600,
        strongMagnitude: 1,
        weakMagnitude: 0.6,
      })
      .catch(() => {})
      .finally(() => setRumbling(false));
  }, [selectedPad, showErrorToast]);

  const finishCapture = useCallback((control: PadControl, token: string) => {
    captureRef.current = null;
    setCapturing(null);
    setProfile((prev) =>
      prev
        ? { ...prev, bindings: { ...prev.bindings, [control]: token } }
        : prev
    );
  }, []);

  // Capture loop: while capturing, watch the selected pad for the first
  // button press or axis deflection and bind it.
  useEffect(() => {
    if (!capturing) return;
    captureRef.current = capturing;

    const loop = () => {
      const control = captureRef.current;
      if (!control) return;
      const gp = (navigator.getGamepads?.() ?? [])[selectedPad];
      if (gp) {
        for (let i = 0; i < gp.buttons.length; i++) {
          if (gp.buttons[i]?.pressed && BUTTON_TOKEN[i]) {
            finishCapture(control, BUTTON_TOKEN[i]);
            return;
          }
        }
        for (let a = 0; a < gp.axes.length; a++) {
          const v = gp.axes[a];
          if (AXIS_NAME[a] && Math.abs(v) > AXIS_THRESHOLD) {
            const sign = v < 0 ? "-" : "+";
            finishCapture(control, `${sign}${AXIS_NAME[a]}`);
            return;
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [capturing, selectedPad, finishCapture]);

  const save = async () => {
    if (!profile) return;
    setApplying(true);
    try {
      const pad = pads.find((p) => p.index === selectedPad);
      const finalProfile: ControllerProfile = {
        ...profile,
        controllerIndex: selectedPad,
        controllerName: pad?.id ?? profile.controllerName,
      };
      const res =
        scope === "custom"
          ? await window.electron.saveControllerProfile(
              finalProfile,
              binary,
              controllerType ?? undefined
            )
          : await window.electron.saveControllerProfile(finalProfile);
      const okCount = res.applied.filter((a) => a.ok).length;
      showSuccessToast(
        scope === "custom"
          ? okCount > 0
            ? "Custom mapping saved for this console"
            : "Custom mapping saved (emulator not installed yet)"
          : okCount > 0
            ? `Applied to ${okCount} installed emulator(s)`
            : "Saved (no emulators installed yet)"
      );
    } catch {
      showErrorToast("Couldn't save the controller mapping");
    } finally {
      setApplying(false);
    }
  };

  const onScopeChange = (next: "global" | "custom") => {
    setScope(next);
    if (next === "custom") loadProfile(binary);
    else {
      loadProfile(undefined);
      window.electron.useGlobalController(binary).catch(() => {});
    }
  };

  const setMotion = (on: boolean) =>
    setProfile((p) => (p ? { ...p, motion: on } : p));

  if (!profile) {
    return <p className="emulator-detail__muted">Loading controller…</p>;
  }

  const showDiagram = binary === "cemu" || binary === "dolphin";

  // Which diagram control is currently being bound (pulses on the diagram).
  const activeDiagramControl =
    (Object.entries(DIAGRAM_TO_CONTROL).find(
      ([, pad]) => pad === capturing
    )?.[0] as DiagramControl | undefined) ?? null;

  const hoveredControl = hovered ? DIAGRAM_TO_CONTROL[hovered] : undefined;

  const onDiagramClick = (c: DiagramControl) => {
    const control = DIAGRAM_TO_CONTROL[c];
    if (control) setCapturing((cur) => (cur === control ? null : control));
  };

  return (
    <div className="controller-mapper">
      <div className="controller-mapping__toolbar">
        <label className="controller-mapping__pad-select">
          <span>Controller</span>
          <select
            value={selectedPad}
            onChange={(e) => setSelectedPad(Number(e.target.value))}
          >
            {pads.length === 0 && (
              <option value={0}>No controller detected</option>
            )}
            {pads.map((p) => (
              <option key={p.index} value={p.index}>
                #{p.index + 1} — {p.id.slice(0, 40)}
              </option>
            ))}
          </select>
        </label>

        <label className="controller-mapping__pad-select">
          <span>Profile</span>
          <select
            value={scope}
            onChange={(e) =>
              onScopeChange(e.target.value as "global" | "custom")
            }
          >
            <option value="global">Shared (all emulators)</option>
            <option value="custom">Custom for this console</option>
          </select>
        </label>

        {typeOptions && (
          <label className="controller-mapping__pad-select">
            <span>Controller type</span>
            <select
              value={controllerType ?? typeOptions[0].value}
              onChange={(e) =>
                setControllerType(e.target.value as EmulatedControllerType)
              }
            >
              {typeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <Button theme="primary" onClick={save} disabled={applying}>
          {applying
            ? "Saving…"
            : scope === "custom"
              ? "Save for this console"
              : "Apply to all emulators"}
        </Button>
      </div>

      <label className="controller-mapping__motion">
        <input
          type="checkbox"
          checked={Boolean(profile.motion)}
          onChange={(e) => setMotion(e.target.checked)}
        />
        <span>
          Enable motion (gyro/accel) — needs a controller with motion (DualShock
          4, DualSense, Switch Pro) and an emulator that supports it (Dolphin,
          Cemu).
        </span>
      </label>

      {/* Top: controller diagram (left) + binding list (right). */}
      <div className="controller-mapper__main">
        {showDiagram && (
          <div className="controller-mapper__diagram-col">
            <SwitchProDiagram
              pressed={livePressed}
              axes={liveAxes}
              activeControl={activeDiagramControl}
              onHoverControl={setHovered}
              onClickControl={onDiagramClick}
            />
            <p className="controller-mapper__diagram-hint">
              {hovered && hoveredControl
                ? `${hovered.toUpperCase()} → ${tokenLabel(profile.bindings[hoveredControl])}`
                : "Press a control on your controller — it lights up here. Click a button on the diagram (or “Set”) to bind it."}
            </p>
          </div>
        )}

        <div className="controller-mapper__bind-col">
          <div className="controller-mapper__grid">
            {CONTROLS.map(({ control, label }) => {
              const isCapturing = capturing === control;
              const isHovered = hoveredControl === control;
              return (
                <div
                  key={control}
                  className={
                    "controller-mapper__row" +
                    (isCapturing ? " controller-mapper__row--capturing" : "") +
                    (isHovered ? " controller-mapper__row--hovered" : "")
                  }
                >
                  <span className="controller-mapper__control-label">
                    {label}
                  </span>
                  <span className="controller-mapper__binding">
                    {tokenLabel(profile.bindings[control])}
                  </span>
                  <Button
                    theme={isCapturing ? "primary" : "outline"}
                    onClick={() =>
                      setCapturing((c) => (c === control ? null : control))
                    }
                  >
                    {isCapturing ? "Press…" : "Set"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Below: live tester elements — sticks, rumble, raw data. */}
      <div className="controller-mapper__extras">
        <div className="controller-mapper__card">
          <h4>Analog sticks</h4>
          <div className="controller-mapper__sticks">
            {[
              { label: "Left", x: liveAxes[0] ?? 0, y: liveAxes[1] ?? 0 },
              { label: "Right", x: liveAxes[2] ?? 0, y: liveAxes[3] ?? 0 },
            ].map((s) => (
              <div key={s.label} className="controller-mapper__stick">
                <div className="controller-mapper__stick-well">
                  <span
                    className="controller-mapper__stick-dot"
                    style={{
                      transform: `translate(${s.x * 26}px, ${s.y * 26}px)`,
                    }}
                  />
                </div>
                <span className="controller-mapper__stick-label">
                  {s.label} {s.x.toFixed(2)}, {s.y.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="controller-mapper__card">
          <h4>Vibration</h4>
          <Button theme="outline" onClick={testRumble} disabled={rumbling}>
            {rumbling ? "Rumbling…" : "Test rumble"}
          </Button>
        </div>

        <div className="controller-mapper__card controller-mapper__card--raw">
          <h4>Raw data</h4>
          <div className="controller-mapper__raw">
            <div className="controller-mapper__raw-buttons">
              {livePressed.map((p, i) => (
                <span
                  key={i}
                  className={
                    "controller-mapper__raw-btn" +
                    (p ? " controller-mapper__raw-btn--on" : "")
                  }
                >
                  {i}
                </span>
              ))}
              {livePressed.length === 0 && (
                <span className="emulator-detail__muted">
                  No controller detected
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
