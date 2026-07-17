import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ControllerProfile,
  EmulatedControllerType,
  EmulatorBinary,
  PadControl,
} from "@types";

// Reactive controller diagrams (pure SVG React components) + the desktop
// mapper's shared token/layout logic. These import fine into Big Picture via
// the @renderer alias and MUST NOT be modified here.
import { SwitchProDiagram } from "@renderer/pages/settings/emulation/switch-pro-diagram";
import { GameCubeDiagram } from "@renderer/pages/settings/emulation/gamecube-diagram";
import { GbaDiagram } from "@renderer/pages/settings/emulation/gba-diagram";
import { N64Diagram } from "@renderer/pages/settings/emulation/n64-diagram";
import { GbGbcDiagram } from "@renderer/pages/settings/emulation/gbgbc-diagram";
import { WiimoteDiagram } from "@renderer/pages/settings/emulation/wiimote-diagram";
import { Ps1Diagram } from "@renderer/pages/settings/emulation/ps1-diagram";
import { DualShockDiagram } from "@renderer/pages/settings/emulation/dualshock-diagram";
import { JoyConDiagram } from "@renderer/pages/settings/emulation/joycon-diagram";
import {
  AXIS_NAME,
  AXIS_THRESHOLD,
  BUTTON_TOKEN,
  DEFAULT_PAD_BINDINGS,
  parseGamepadVendorProduct,
  synthesizeSdlGuid,
  tokenActivation,
  type DiagramControl,
} from "@renderer/pages/settings/emulation/controller-tokens";
import { useSwitchHidPad } from "@renderer/pages/settings/emulation/use-switch-hid-pad";
import {
  layoutFor,
  RETRO_DIAGRAM_CHOICES,
  type ControllerLayout,
} from "@renderer/pages/settings/emulation/controller-layouts";

import {
  Button,
  DropdownSelect,
  FocusItem,
  Modal,
  VerticalFocusGroup,
} from "../../../../components";
import { useBigPictureToast, useNavigation } from "../../../../hooks";

import "./controller.scss";

/**
 * Diagram control → our PadControl (buttons that map 1:1). Ported verbatim from
 * the desktop controller-mapping-section so the diagram lights the emulated
 * control the user bound, not the physical button that shares its name.
 */
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

/** Human label for an SDL token, for display. */
function tokenLabel(token: string | undefined): string {
  if (!token || token === "none") return "—";
  return token;
}

const CONTROLLER_MAPPER_SAVE_FOCUS_ID = "controller-mapper-save";

interface Props {
  visible: boolean;
  binary: EmulatorBinary;
  emulatorLabel: string;
  onClose: () => void;
}

/**
 * Big Picture (couch mode) controller mapper. Every interactive element is a
 * focusable BP primitive so a gamepad can drive the whole screen. The
 * live-capture + diagram-activation logic is ported verbatim from the desktop
 * ControllerMappingSection: it reads navigator.getGamepads directly on a
 * requestAnimationFrame loop, which works regardless of DOM focus.
 */
export function ControllerMapperModal({
  visible,
  binary,
  emulatorLabel,
  onClose,
}: Readonly<Props>) {
  const { setFocus } = useNavigation();
  const { showSuccessToast, showErrorToast } = useBigPictureToast();

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

  // Live input for the diagram.
  const [livePressed, setLivePressed] = useState<boolean[]>([]);
  const [liveAxes, setLiveAxes] = useState<number[]>([]);
  const [hovered, setHovered] = useState<DiagramControl | null>(null);

  const typeOptions = CONTROLLER_TYPES[binary];

  // Load this emulator's own saved profile (seeded from the default on first
  // visit). Each emulator owns its mapping — there is no shared/global scope.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    globalThis.window.electron
      .getControllerProfile(binary)
      .then((res) => {
        if (cancelled) return;
        setProfile(res.profile);
        savedPadNameRef.current = res.profile.controllerName ?? null;
        if (res.type) setControllerType(res.type);
        else if (typeOptions) setControllerType(typeOptions[0].value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visible, binary, typeOptions]);

  // Poll connected controllers so the list stays live. We keep `mapping` so we
  // can tell XInput/standard pads (Gamepad API normalises them) from
  // DirectInput/other pads (mapping === "", raw button order) and surface that.
  useEffect(() => {
    if (!visible) return;
    const scan = () => {
      const gps = navigator.getGamepads?.() ?? [];
      const list: { index: number; id: string; mapping: string }[] = [];
      for (const gp of gps) {
        if (gp) list.push({ index: gp.index, id: gp.id, mapping: gp.mapping });
      }
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
    globalThis.window.addEventListener("gamepadconnected", onConnect);
    globalThis.window.addEventListener("gamepaddisconnected", onConnect);
    const id = globalThis.window.setInterval(scan, 1500);
    return () => {
      globalThis.window.removeEventListener("gamepadconnected", onConnect);
      globalThis.window.removeEventListener("gamepaddisconnected", onConnect);
      globalThis.window.clearInterval(id);
    };
  }, [visible, hidPad.connected, hidPad.padIndex, hidPad.padId]);

  // When pads (re)connect, reselect the controller this emulator was mapped
  // with — so bindings still line up after unplugging/reconnecting.
  useEffect(() => {
    const savedName = savedPadNameRef.current;
    if (!savedName || pads.length === 0) return;
    const match = pads.find((p) => p.id === savedName);
    if (match) setSelectedPad(match.index);
  }, [pads]);

  // Continuously read the selected pad so the diagram lights up live.
  useEffect(() => {
    if (!visible) return;
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
  }, [visible, selectedPad, hidPad]);

  const finishCapture = useCallback((control: PadControl, token: string) => {
    captureRef.current = null;
    setCapturing(null);
    setProfile((prev) => {
      if (!prev) return prev;
      // No double-binding: clear any other control already bound to this token.
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
  // button press or axis deflection and bind it. Identical to the desktop.
  useEffect(() => {
    if (!capturing) return;
    captureRef.current = capturing;

    const loop = () => {
      const control = captureRef.current;
      if (!control) return;
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

  useEffect(() => {
    if (!visible) return;
    const frame = globalThis.window.requestAnimationFrame(() => {
      setFocus(CONTROLLER_MAPPER_SAVE_FOCUS_ID);
    });
    return () => globalThis.window.cancelAnimationFrame(frame);
  }, [visible, setFocus]);

  const save = useCallback(async () => {
    if (!profile) return;
    setApplying(true);
    try {
      const pad = pads.find((p) => p.index === selectedPad);
      // Derive the SDL GUID from USB vendor/product so joystick-engine emulators
      // (Azahar, Eden) bind the real device instead of the all-zero fallback.
      const vp = pad ? parseGamepadVendorProduct(pad.id) : null;
      // WebHID Nintendo controllers are almost always Bluetooth-paired.
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
      const res = await globalThis.window.electron.saveControllerProfile(
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
  }, [
    profile,
    pads,
    selectedPad,
    binary,
    controllerType,
    showSuccessToast,
    showErrorToast,
    hidPad,
  ]);

  // Reset every binding to the standard SDL default — the reliable mapping for
  // any controller the emulator's SDL layer recognises.
  const resetToDefault = useCallback(
    () =>
      setProfile((p) =>
        p ? { ...p, bindings: { ...p.bindings, ...DEFAULT_PAD_BINDINGS } } : p
      ),
    []
  );

  if (!visible) return null;

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

  const onDiagramClick = (c: DiagramControl) => {
    const control = DIAGRAM_TO_CONTROL[c];
    if (control) setCapturing((cur) => (cur === control ? null : control));
  };

  // Semantic activation for the diagram: resolve each EMULATED control through
  // the user's bindings, so the diagram lights the control being triggered —
  // not the physical button that happens to share its name.
  const diagramActive: Partial<Record<DiagramControl, boolean>> = {};
  if (profile) {
    for (const [diagramKey, padControl] of Object.entries(
      DIAGRAM_TO_CONTROL
    ) as [DiagramControl, PadControl][]) {
      diagramActive[diagramKey] =
        tokenActivation(profile.bindings[padControl], livePressed, liveAxes) >
        AXIS_THRESHOLD * 0.5;
    }
  }

  // Bound stick deflection: each axis from its two direction bindings.
  const dir = (control: PadControl) =>
    profile
      ? Math.min(
          1,
          tokenActivation(profile.bindings[control], livePressed, liveAxes)
        )
      : 0;
  const stickDeflection: [number, number, number, number] = [
    dir("lstick_right") - dir("lstick_left"),
    dir("lstick_down") - dir("lstick_up"),
    dir("rstick_right") - dir("rstick_left"),
    dir("rstick_down") - dir("rstick_up"),
  ];

  const hoveredControl = hovered ? DIAGRAM_TO_CONTROL[hovered] : undefined;

  const diagramProps = {
    active: diagramActive,
    stickDeflection,
    activeControl: activeDiagramControl,
    onHoverControl: setHovered,
    onClickControl: onDiagramClick,
  };

  const renderDiagram = () => {
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
  };

  const padOptions =
    pads.length === 0
      ? [{ value: "0", label: "No controller detected" }]
      : pads.map((p) => ({
          value: String(p.index),
          label: `#${p.index + 1} — ${p.id.slice(0, 34)}${
            p.mapping === "standard" ? "" : " (DirectInput)"
          }`,
        }));

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={`${emulatorLabel} controller`}
      description="Map your controller for this emulator."
      className="bp-controller-mapper-modal"
    >
      <VerticalFocusGroup
        regionId="bp-controller-mapper-region"
        className="bp-controller-mapper"
      >
        <div className="bp-controller-mapper__toolbar">
          <DropdownSelect
            label="Controller"
            focusId="controller-mapper-pad"
            value={String(selectedPad)}
            options={padOptions}
            onValueChange={(v) => setSelectedPad(Number(v))}
          />

          {isRetro && (
            <DropdownSelect
              label="Console layout"
              focusId="controller-mapper-retro"
              value={retroDiagram}
              options={RETRO_DIAGRAM_CHOICES.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
              onValueChange={(v) => setRetroDiagram(v)}
            />
          )}

          {typeOptions && (
            <DropdownSelect
              label="Controller type"
              focusId="controller-mapper-type"
              value={controllerType ?? typeOptions[0].value}
              options={typeOptions.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
              onValueChange={(v) =>
                setControllerType(v as EmulatedControllerType)
              }
            />
          )}
        </div>

        {padTypeLabel && (
          <p className="bp-controller-mapper__pad-type">
            Detected input type: <strong>{padTypeLabel}</strong>
            {isNonStandardPad && (
              <>
                {" "}
                — this DirectInput/SDL controller is supported. GameHub maps it
                through SDL, so <strong>Reset to default</strong> gives a
                working mapping; the live diagram reflects raw button order and
                may not match until you rebind.
              </>
            )}
          </p>
        )}

        {!profile && (
          <p className="bp-controller-mapper__loading">Loading controller…</p>
        )}

        {profile && (
          <div className="bp-controller-mapper__main">
            {showDiagram && (
              <div className="bp-controller-mapper__diagram-col">
                {renderDiagram()}
                <p className="bp-controller-mapper__diagram-hint">
                  {hovered && hoveredControl
                    ? `${hovered.toUpperCase()} → ${tokenLabel(
                        profile.bindings[hoveredControl]
                      )}`
                    : "Press a control on your controller — it lights up here. Choose “Set” to rebind."}
                </p>
              </div>
            )}

            <VerticalFocusGroup
              regionId="bp-controller-mapper-binds"
              className="bp-controller-mapper__bind-col"
            >
              {layout.controls.map(({ control, label }) => {
                const isCapturing = capturing === control;
                return (
                  <FocusItem
                    key={control}
                    id={`controller-mapper-bind-${control}`}
                    actions={{
                      primary: () =>
                        setCapturing((c) => (c === control ? null : control)),
                    }}
                    asChild
                  >
                    <button
                      type="button"
                      className={
                        "bp-controller-mapper__row" +
                        (isCapturing
                          ? " bp-controller-mapper__row--capturing"
                          : "")
                      }
                      onClick={() =>
                        setCapturing((c) => (c === control ? null : control))
                      }
                    >
                      <span className="bp-controller-mapper__control-label">
                        {label}
                      </span>
                      <span className="bp-controller-mapper__binding">
                        {isCapturing
                          ? "Press a button…"
                          : tokenLabel(profile.bindings[control])}
                      </span>
                      <span className="bp-controller-mapper__set">
                        {isCapturing ? "Cancel" : "Set"}
                      </span>
                    </button>
                  </FocusItem>
                );
              })}
            </VerticalFocusGroup>
          </div>
        )}

        <div className="bp-controller-mapper__footer">
          {!hidPad.connected && (
            <Button variant="secondary" onClick={() => hidPad.connect()}>
              Connect Switch controller
            </Button>
          )}
          <Button variant="secondary" onClick={resetToDefault}>
            Reset to default
          </Button>
          <Button
            focusId={CONTROLLER_MAPPER_SAVE_FOCUS_ID}
            disabled={applying || !profile}
            onClick={save}
          >
            {applying ? "Saving…" : "Save mapping"}
          </Button>
        </div>
      </VerticalFocusGroup>
    </Modal>
  );
}
