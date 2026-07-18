import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ControllerProfile,
  EmulatedControllerType,
  EmulatorBinary,
  PadControl,
} from "@types";
import { Button } from "@renderer/components";
import { SelectField } from "@renderer/components/select-field/select-field";
import { useToast } from "@renderer/hooks";
import { SwitchProDiagram } from "./switch-pro-diagram";
import { GameCubeDiagram } from "./gamecube-diagram";
import { GbaDiagram } from "./gba-diagram";
import { N64Diagram } from "./n64-diagram";
import { GbGbcDiagram } from "./gbgbc-diagram";
import { WiimoteDiagram } from "./wiimote-diagram";
import { Ps1Diagram } from "./ps1-diagram";
import { DualShockDiagram } from "./dualshock-diagram";
import { JoyConDiagram } from "./joycon-diagram";
import {
  AXIS_NAME,
  AXIS_THRESHOLD,
  BUTTON_TOKEN,
  DEFAULT_PAD_BINDINGS,
  parseGamepadVendorProduct,
  synthesizeSdlGuid,
  tokenActivation,
  type DiagramControl,
} from "./controller-tokens";
import {
  layoutFor,
  RETRO_DIAGRAM_CHOICES,
  type ControllerLayout,
} from "./controller-layouts";
import { GyroCube } from "./gyro-cube";
import { useSwitchHidPad } from "./use-switch-hid-pad";
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
  // GameCube's Z button lives in the R1 slot (see controller-layouts).
  z: "r1",
  // N64 C-buttons are conventionally the right analog stick on a RetroPad.
  cup: "rstick_up",
  cdown: "rstick_down",
  cleft: "rstick_left",
  cright: "rstick_right",
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
  eden: [
    { value: "switch_pro", label: "Switch Pro Controller" },
    { value: "joycon_pair", label: "Joy-Con Pair" },
  ],
};

/**
 * Live controller mapper. Detects connected pads via the Gamepad API (XInput /
 * DirectInput on Windows), lets the user remap any control by pressing the
 * physical button/stick ("click detection"), and applies the one profile to
 * every installed emulator via saveControllerProfile.
 */

// Control lists now come from controller-layouts (per emulator/type).

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
  const [pads, setPads] = useState<
    { index: number; id: string; mapping: string }[]
  >([]);
  const [selectedPad, setSelectedPad] = useState<number>(0);
  const [capturing, setCapturing] = useState<PadControl | null>(null);
  const [applying, setApplying] = useState(false);
  // The controller name this emulator's saved profile was mapped with, so we
  // can reselect the same physical pad when it reconnects.
  const savedPadNameRef = useRef<string | null>(null);
  const [controllerType, setControllerType] =
    useState<EmulatedControllerType | null>(null);
  // RALibretro serves many consoles off ONE shared RetroPad mapping, so this
  // only switches which console diagram is shown — it never changes bindings.
  const [retroDiagram, setRetroDiagram] = useState<string>("retropad");
  const captureRef = useRef<PadControl | null>(null);
  const rafRef = useRef<number | null>(null);

  // Nintendo-protocol controllers (Switch Pro / Joy-Con / 8BitDo in Switch mode)
  // are invisible to the Gamepad API — bridge them in over WebHID.
  const hidPad = useSwitchHidPad();

  // Live input for the diagram + raw-data readout.
  const [livePressed, setLivePressed] = useState<boolean[]>([]);
  const [liveAxes, setLiveAxes] = useState<number[]>([]);
  const [hovered, setHovered] = useState<DiagramControl | null>(null);
  const [rumbling, setRumbling] = useState(false);

  const typeOptions = CONTROLLER_TYPES[binary];

  // Load this emulator's own saved profile (seeded from the default on first
  // visit). Each emulator owns its mapping — there is no shared/global scope.
  useEffect(() => {
    window.electron
      .getControllerProfile(binary)
      .then((res) => {
        setProfile(res.profile);
        savedPadNameRef.current = res.profile.controllerName ?? null;
        if (res.type) setControllerType(res.type);
        else if (typeOptions) setControllerType(typeOptions[0].value);
      })
      .catch(() => {});
  }, [binary, typeOptions]);

  // Poll connected controllers so the list stays live. We keep `mapping` so we
  // can tell XInput/standard pads (Gamepad API normalises them) from
  // DirectInput/other pads (mapping === "", raw button order) and surface that.
  useEffect(() => {
    const scan = () => {
      const gps = navigator.getGamepads?.() ?? [];
      const list: { index: number; id: string; mapping: string }[] = [];
      for (const gp of gps) {
        if (gp) list.push({ index: gp.index, id: gp.id, mapping: gp.mapping });
      }
      // Add the WebHID Nintendo controller as a selectable pad. It's decoded in
      // standard order, so mark it "standard" — the diagram trusts the layout.
      if (hidPad.connected) {
        list.push({
          index: hidPad.padIndex,
          id: hidPad.padId ?? "Nintendo Controller (WebHID)",
          mapping: "standard",
        });
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
  }, [hidPad.connected, hidPad.padIndex, hidPad.padId]);

  // When pads (re)connect, reselect the controller this emulator was mapped
  // with — so bindings still line up after unplugging/reconnecting.
  useEffect(() => {
    // Prefer the WebHID Nintendo pad whenever it's connected: it decodes in
    // standard order so the diagram + capture work correctly, whereas the same
    // controller's raw Gamepad-API duplicate (mapping === "") lights the wrong
    // controls. This is why the mapper "didn't respond" to Switch/SDL pads.
    if (hidPad.connected) {
      setSelectedPad(hidPad.padIndex);
      return;
    }
    const savedName = savedPadNameRef.current;
    if (!savedName || pads.length === 0) return;
    const match = pads.find((p) => p.id === savedName);
    if (match) setSelectedPad(match.index);
  }, [pads, hidPad.connected, hidPad.padIndex]);

  // Continuously read the selected pad so the diagram lights up live.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (hidPad.isHidPadIndex(selectedPad)) {
        const snapshot = hidPad.read();
        if (snapshot) {
          setLivePressed(snapshot.pressed);
          setLiveAxes(snapshot.axes);
        }
      } else {
        const gp = (navigator.getGamepads?.() ?? [])[selectedPad];
        if (gp) {
          setLivePressed(gp.buttons.map((b) => b.pressed));
          setLiveAxes(Array.from(gp.axes));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selectedPad, hidPad]);

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
    setProfile((prev) => {
      if (!prev) return prev;
      // No double-binding: one physical input can't drive two emulated controls.
      // Clear any OTHER control currently bound to this exact token first.
      const bindings = { ...prev.bindings };
      if (token && token !== "none") {
        for (const key of Object.keys(bindings) as PadControl[]) {
          if (key !== control && bindings[key] === token) {
            bindings[key] = "none";
          }
        }
      }
      bindings[control] = token;
      return { ...prev, bindings };
    });
  }, []);

  // Capture loop: while capturing, watch the selected pad for the first
  // button press or axis deflection and bind it.
  useEffect(() => {
    if (!capturing) return;
    captureRef.current = capturing;

    const loop = () => {
      const control = captureRef.current;
      if (!control) return;
      // WebHID Nintendo pad and Gamepad-API pad expose the same shape (pressed
      // booleans + axes in standard index order), so capture is identical.
      const isHid = hidPad.isHidPadIndex(selectedPad);
      const snapshot = isHid ? hidPad.read() : null;
      const buttons: boolean[] = isHid
        ? (snapshot?.pressed ?? [])
        : ((navigator.getGamepads?.() ?? [])[selectedPad]?.buttons.map(
            (b) => b.pressed
          ) ?? []);
      const axes: number[] = isHid
        ? (snapshot?.axes ?? [])
        : Array.from(
            (navigator.getGamepads?.() ?? [])[selectedPad]?.axes ?? []
          );

      for (let i = 0; i < buttons.length; i++) {
        if (buttons[i] && BUTTON_TOKEN[i]) {
          finishCapture(control, BUTTON_TOKEN[i]);
          return;
        }
      }
      for (let a = 0; a < axes.length; a++) {
        const v = axes[a];
        if (AXIS_NAME[a] && Math.abs(v) > AXIS_THRESHOLD) {
          const sign = v < 0 ? "-" : "+";
          finishCapture(control, `${sign}${AXIS_NAME[a]}`);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [capturing, selectedPad, finishCapture, hidPad]);

  const save = async () => {
    if (!profile) return;
    setApplying(true);
    try {
      const pad = pads.find((p) => p.index === selectedPad);
      // Derive the SDL GUID from the pad's USB vendor/product so joystick-engine
      // emulators (Azahar, Eden) bind the real device instead of the all-zero
      // GUID fallback. Falls back to the existing GUID when the id has no IDs.
      const vp = pad ? parseGamepadVendorProduct(pad.id) : null;
      // WebHID Nintendo controllers are almost always paired over Bluetooth, so
      // encode the BT bus in their SDL GUID; wired Gamepad-API pads use USB.
      const bus = hidPad.isHidPadIndex(selectedPad) ? "bluetooth" : "usb";
      const guid = vp
        ? synthesizeSdlGuid(vp.vendorId, vp.productId, bus)
        : (profile.controllerGuid ?? null);
      const finalProfile: ControllerProfile = {
        ...profile,
        controllerIndex: selectedPad,
        controllerName: pad?.id ?? profile.controllerName,
        controllerGuid: guid ?? profile.controllerGuid ?? null,
      };
      savedPadNameRef.current = finalProfile.controllerName ?? null;
      const res = await window.electron.saveControllerProfile(
        finalProfile,
        binary,
        controllerType ?? undefined
      );
      const ok = res.applied.some((a) => a.ok);
      showSuccessToast(
        ok
          ? "Controller mapping saved"
          : "Mapping saved (emulator not installed yet)"
      );
    } catch {
      showErrorToast("Couldn't save the controller mapping");
    } finally {
      setApplying(false);
    }
  };

  // Reset every binding to the standard SDL default — the reliable mapping for
  // any controller the emulator's SDL layer recognises (DirectInput/DualShock
  // included), since SDL maps the physical device to these tokens.
  const resetToDefault = () =>
    setProfile((p) =>
      p ? { ...p, bindings: { ...p.bindings, ...DEFAULT_PAD_BINDINGS } } : p
    );

  const setMotion = (on: boolean) =>
    setProfile((p) => (p ? { ...p, motion: on } : p));

  if (!profile) {
    return <p className="emulator-detail__muted">Loading controller…</p>;
  }

  // Per-emulator layout: only the controls this console actually uses, plus
  // the diagram that matches it. RALibretro is the exception — it serves many
  // consoles from one RetroPad map, so the user picks the diagram directly.
  // The selected pad's input type. Standard = XInput (Gamepad API normalises
  // the button order); "" = DirectInput / other (raw order). Both are supported
  // — the emulators map via SDL — but non-standard pads need the note below.
  const selectedPadObj = pads.find((p) => p.index === selectedPad);
  const isNonStandardPad = Boolean(
    selectedPadObj && selectedPadObj.mapping !== "standard"
  );
  const padTypeLabel = selectedPadObj
    ? selectedPadObj.mapping === "standard"
      ? "XInput / standard"
      : "DirectInput / SDL"
    : null;

  const isRetro = binary === "ralibretro";
  const layout: ControllerLayout = isRetro
    ? (RETRO_DIAGRAM_CHOICES.find((c) => c.value === retroDiagram)?.layout ??
      RETRO_DIAGRAM_CHOICES[0].layout)
    : layoutFor(binary, controllerType);
  const showDiagram = layout.diagram !== null;

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

  // Semantic activation for the diagram: resolve each EMULATED control through
  // the user's bindings, so the diagram lights the control being triggered —
  // not the physical button that happens to share its name.
  const diagramActive: Partial<Record<DiagramControl, boolean>> = {};
  for (const [diagramKey, padControl] of Object.entries(DIAGRAM_TO_CONTROL) as [
    DiagramControl,
    PadControl,
  ][]) {
    diagramActive[diagramKey] =
      tokenActivation(profile.bindings[padControl], livePressed, liveAxes) >
      AXIS_THRESHOLD * 0.5;
  }

  // Bound stick deflection: each axis from its two direction bindings
  // (analog magnitude for axis tokens, 0/1 for button tokens).
  const dir = (control: PadControl) =>
    Math.min(
      1,
      tokenActivation(profile.bindings[control], livePressed, liveAxes)
    );
  const stickDeflection: [number, number, number, number] = [
    dir("lstick_right") - dir("lstick_left"),
    dir("lstick_down") - dir("lstick_up"),
    dir("rstick_right") - dir("rstick_left"),
    dir("rstick_down") - dir("rstick_up"),
  ];

  return (
    <div className="controller-mapper">
      <div className="controller-mapping__toolbar">
        <SelectField
          theme="dark"
          className="controller-mapping__field"
          label="Controller"
          value={String(selectedPad)}
          onChange={(e) => setSelectedPad(Number(e.target.value))}
          options={
            pads.length === 0
              ? [{ key: "none", value: "0", label: "No controller detected" }]
              : pads.map((p) => ({
                  key: String(p.index),
                  value: String(p.index),
                  label: `#${p.index + 1} — ${p.id.slice(0, 34)}${
                    p.mapping === "standard" ? "" : " (DirectInput)"
                  }`,
                }))
          }
        />

        {isRetro && (
          <SelectField
            theme="dark"
            className="controller-mapping__field"
            label="Console layout"
            value={retroDiagram}
            onChange={(e) => setRetroDiagram(e.target.value)}
            options={RETRO_DIAGRAM_CHOICES.map((o) => ({
              key: o.value,
              value: o.value,
              label: o.label,
            }))}
          />
        )}

        {typeOptions && (
          <SelectField
            theme="dark"
            className="controller-mapping__field"
            label="Controller type"
            value={controllerType ?? typeOptions[0].value}
            onChange={(e) =>
              setControllerType(e.target.value as EmulatedControllerType)
            }
            options={typeOptions.map((o) => ({
              key: o.value,
              value: o.value,
              label: o.label,
            }))}
          />
        )}

        {!hidPad.connected && (
          <Button
            theme="outline"
            className="controller-mapping__reset"
            onClick={() => hidPad.connect()}
            title="Detect a Nintendo Switch Pro Controller, Joy-Con, or 8BitDo pad in Switch mode over WebHID"
          >
            Connect Switch controller
          </Button>
        )}

        <Button
          theme="outline"
          className="controller-mapping__reset"
          onClick={resetToDefault}
        >
          Reset to default
        </Button>

        <Button
          theme="primary"
          className="controller-mapping__save"
          onClick={save}
          disabled={applying}
        >
          {applying ? "Saving…" : "Save mapping"}
        </Button>
      </div>

      {pads.length === 0 && (
        <p className="controller-mapping__pad-type">
          No controller detected yet.{" "}
          <strong>Press any button on your controller</strong> — browsers
          (including DirectInput/SDL pads) only reveal a gamepad after its first
          input.
        </p>
      )}

      {padTypeLabel && (
        <p className="controller-mapping__pad-type">
          Detected input type: <strong>{padTypeLabel}</strong>
          {isNonStandardPad && (
            <>
              {" "}
              — this DirectInput/SDL controller is supported. GameHub maps it
              through SDL, so <strong>Reset to default</strong> gives a working
              mapping out of the box; the live diagram reflects raw button order
              and may not match until you rebind.
            </>
          )}
        </p>
      )}

      <label className="controller-mapping__motion">
        <input
          type="checkbox"
          checked={Boolean(profile.motion)}
          onChange={(e) => setMotion(e.target.checked)}
        />
        <span>
          Enable motion (gyro/accel) — needs a controller with motion (DualShock
          4, DualSense, Switch Pro) and an emulator that supports it (Dolphin,
          Cemu). In Cemu this only works with the <strong>SDLController</strong>{" "}
          API — motion isn&apos;t exposed by the XInput/DirectInput backends.
        </span>
      </label>

      {/* Top: controller diagram (left) + binding list (right). */}
      <div className="controller-mapper__main">
        {showDiagram && (
          <div className="controller-mapper__diagram-col">
            {(() => {
              const diagramProps = {
                active: diagramActive,
                stickDeflection,
                activeControl: activeDiagramControl,
                onHoverControl: setHovered,
                onClickControl: onDiagramClick,
              };
              switch (layout.diagram) {
                case "gamecube":
                  return <GameCubeDiagram {...diagramProps} />;
                case "gba":
                  return <GbaDiagram {...diagramProps} />;
                case "n64":
                  return <N64Diagram {...diagramProps} />;
                case "gb":
                  return <GbGbcDiagram {...diagramProps} />;
                case "wiimote":
                  return <WiimoteDiagram {...diagramProps} />;
                case "ps1":
                  return <Ps1Diagram {...diagramProps} />;
                case "dualshock":
                  return <DualShockDiagram {...diagramProps} />;
                case "joycon":
                  return <JoyConDiagram {...diagramProps} />;
                default:
                  return <SwitchProDiagram {...diagramProps} />;
              }
            })()}
            <p className="controller-mapper__diagram-hint">
              {hovered && hoveredControl
                ? `${hovered.toUpperCase()} → ${tokenLabel(profile.bindings[hoveredControl])}`
                : "Press a control on your controller — it lights up here. Click a button on the diagram (or “Set”) to bind it."}
            </p>
          </div>
        )}

        <div className="controller-mapper__bind-col">
          <div className="controller-mapper__grid">
            {layout.controls.map(({ control, label }) => {
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

        <GyroCube padIndex={selectedPad} enabled={profile?.motion ?? false} />

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
