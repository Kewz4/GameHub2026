import { useCallback, useEffect, useRef, useState } from "react";
import { SwitchHidInput, type PadSnapshot } from "./switch-hid-input";

/**
 * Synthetic pad index for the WebHID Nintendo controller, kept far above any
 * real `navigator.getGamepads()` slot so the two never collide in the mapper's
 * pad dropdown.
 */
export const SWITCH_HID_PAD_INDEX = 1000;

export interface SwitchHidPad {
  /** True once a Nintendo controller is open over WebHID. */
  connected: boolean;
  deviceName: string | null;
  /** The dropdown index the mapper uses to select this pad. */
  padIndex: number;
  /** A Gamepad-style id string so parseGamepadVendorProduct can build the GUID. */
  padId: string | null;
  /** Prompt for + open a controller. MUST be called from a user gesture. */
  connect: () => Promise<boolean>;
  /** Live button/stick snapshot in standard Gamepad-API order, or null. */
  read: () => PadSnapshot | null;
  isHidPadIndex: (index: number) => boolean;
}

/**
 * Bridges a Nintendo-protocol controller (Switch Pro / Joy-Con / 8BitDo in
 * Switch mode) into the controller mapper via WebHID, because Chromium's Gamepad
 * API can't read these. Auto-reconnects a previously-granted device silently on
 * mount; the first-time pairing needs the `connect()` user gesture.
 */
export function useSwitchHidPad(): SwitchHidPad {
  const sourceRef = useRef<SwitchHidInput | null>(null);
  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [padId, setPadId] = useState<string | null>(null);

  const syncState = useCallback((source: SwitchHidInput) => {
    setConnected(source.connected);
    setDeviceName(source.deviceName);
    if (source.connected && source.vendorId && source.productId) {
      const vendor = source.vendorId.toString(16).padStart(4, "0");
      const product = source.productId.toString(16).padStart(4, "0");
      setPadId(
        `${source.deviceName ?? "Nintendo Controller"} (Vendor: ${vendor} Product: ${product})`
      );
    } else {
      setPadId(null);
    }
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.hid) return;
    const source = new SwitchHidInput();
    sourceRef.current = source;

    // Silent reconnect of an already-granted controller (no chooser).
    source
      .connectGranted()
      .then(() => syncState(source))
      .catch(() => {});

    // WebHID fires connect/disconnect when a controller is paired/unpaired.
    const onConnect = () => {
      if (!source.connected) {
        source.connectGranted().then(() => syncState(source));
      }
    };
    const onDisconnect = () => {
      if (source.connected && !source.deviceName) return;
      source.disconnect();
      syncState(source);
    };
    navigator.hid.addEventListener("connect", onConnect);
    navigator.hid.addEventListener("disconnect", onDisconnect);

    return () => {
      navigator.hid.removeEventListener("connect", onConnect);
      navigator.hid.removeEventListener("disconnect", onDisconnect);
      source.disconnect();
      sourceRef.current = null;
    };
  }, [syncState]);

  const connect = useCallback(async () => {
    const source = sourceRef.current;
    if (!source) return false;
    const ok = await source.requestAndConnect().catch(() => false);
    syncState(source);
    return ok;
  }, [syncState]);

  const read = useCallback(() => sourceRef.current?.read() ?? null, []);

  const isHidPadIndex = useCallback(
    (index: number) => index === SWITCH_HID_PAD_INDEX,
    []
  );

  return {
    connected,
    deviceName,
    padIndex: SWITCH_HID_PAD_INDEX,
    padId,
    connect,
    read,
    isHidPadIndex,
  };
}
