/**
 * Reads BUTTON + STICK state from Nintendo-protocol controllers over WebHID —
 * the Switch Pro Controller, Joy-Cons, and 8BitDo pads in Switch mode. These
 * controllers are invisible to Chromium's Gamepad API: they boot sending only
 * Nintendo's "simple" 0x3F report and stream real state in the proprietary
 * vendor report 0x30, which isn't a HID gamepad usage — so `getGamepads()` sees
 * no usable buttons/axes (worst over Bluetooth, where they often don't
 * enumerate at all). WebHID gives raw report access, which is how the mapper can
 * finally see them. `hid-motion.ts` already proves these open over WebHID.
 *
 * The decode produces a snapshot in STANDARD Gamepad-API index order, so the
 * mapper's existing BUTTON_TOKEN / AXIS_NAME tables and diagram light up with no
 * downstream changes.
 *
 * Report 0x30 byte layout (offsets on the WebHID DataView, which EXCLUDES the
 * report-id byte — i.e. dekuNukem's offsets minus 1; matches hid-motion's
 * base=12 IMU read):
 *   d[2] right buttons  0x01 Y 0x02 X 0x04 B 0x08 A 0x40 R 0x80 ZR
 *   d[3] shared buttons 0x01 - 0x02 + 0x04 R3 0x08 L3 0x10 Home 0x20 Capture
 *   d[4] left buttons   0x01 Down 0x02 Up 0x04 Right 0x08 Left 0x40 L 0x80 ZL
 *   d[5..7]  left stick (two packed 12-bit values)
 *   d[8..10] right stick
 * Sources: dekuNukem/Nintendo_Switch_Reverse_Engineering (bluetooth_hid_notes),
 * SDL SDL_hidapi_switch.c.
 */

const NINTENDO_VENDOR = 0x057e;
// Pro Controller (and 8BitDo-in-Switch-mode masquerades as this), Joy-Con L/R,
// and the charging grip.
const SWITCH_PRODUCTS = [0x2009, 0x2006, 0x2007, 0x200e];

export const SWITCH_HID_FILTERS = SWITCH_PRODUCTS.map((productId) => ({
  vendorId: NINTENDO_VENDOR,
  productId,
}));

const isSwitchDevice = (device: HIDDevice): boolean =>
  device.vendorId === NINTENDO_VENDOR &&
  SWITCH_PRODUCTS.includes(device.productId);

/** A Gamepad-API-shaped snapshot: booleans by standard button index, −1..1 axes. */
export interface PadSnapshot {
  pressed: boolean[];
  axes: number[];
}

const STICK_CENTER = 2048;
const STICK_DEADZONE = 0.15;

const norm = (raw: number): number => {
  const v = (raw - STICK_CENTER) / STICK_CENTER;
  return Math.abs(v) < STICK_DEADZONE ? 0 : Math.max(-1, Math.min(1, v));
};

function decodeSwitchReport(view: DataView): PadSnapshot | null {
  if (view.byteLength < 11) return null;
  const d = (i: number) => view.getUint8(i);
  const right = d(2);
  const shared = d(3);
  const left = d(4);

  // Standard Gamepad-API index order (matches BUTTON_TOKEN). Face buttons map by
  // PHYSICAL POSITION, not Nintendo label: south/bottom (Nintendo "B") is index
  // 0, east/right (Nintendo "A") is index 1 — same as XInput, so the diagram is
  // correct regardless of the controller's printed labels.
  const pressed: boolean[] = [
    !!(right & 0x04), // 0 south  (B)
    !!(right & 0x08), // 1 east   (A)
    !!(right & 0x01), // 2 west   (Y)
    !!(right & 0x02), // 3 north  (X)
    !!(left & 0x40), // 4 L  (leftshoulder)
    !!(right & 0x40), // 5 R  (rightshoulder)
    !!(left & 0x80), // 6 ZL (lefttrigger)
    !!(right & 0x80), // 7 ZR (righttrigger)
    !!(shared & 0x01), // 8 minus (back)
    !!(shared & 0x02), // 9 plus  (start)
    !!(shared & 0x08), // 10 L3 (leftstick)
    !!(shared & 0x04), // 11 R3 (rightstick)
    !!(left & 0x02), // 12 dpad up
    !!(left & 0x01), // 13 dpad down
    !!(left & 0x08), // 14 dpad left
    !!(left & 0x04), // 15 dpad right
    !!(shared & 0x10), // 16 home (guide)
  ];

  const lx = d(5) | ((d(6) & 0x0f) << 8);
  const ly = (d(6) >> 4) | (d(7) << 4);
  const rx = d(8) | ((d(9) & 0x0f) << 8);
  const ry = (d(9) >> 4) | (d(10) << 4);

  // Invert Y so down = +1, matching the Gamepad-API axis convention.
  const axes = [norm(lx), -norm(ly), norm(rx), -norm(ry)];

  return { pressed, axes };
}

/** Enable the full 0x30 report (Pro/Joy-Con send only 0x3F until asked). */
async function switchEnableFullReports(device: HIDDevice): Promise<void> {
  let packetCounter = 0;
  const subcommand = async (id: number, ...args: number[]) => {
    const buf = new Uint8Array(48);
    buf[0] = packetCounter++ & 0x0f;
    buf.set([0x00, 0x01, 0x40, 0x40, 0x00, 0x01, 0x40, 0x40], 1);
    buf[9] = id;
    buf.set(args, 10);
    await device.sendReport(0x01, buf);
    await new Promise((r) => setTimeout(r, 60));
  };
  await subcommand(0x03, 0x30); // SetInputReportMode → full 0x30 @60Hz
  await subcommand(0x30, 0x01); // SetPlayerLights → LED1 (nice-to-have)
}

/**
 * Opens one Nintendo controller over WebHID and exposes its live button/stick
 * snapshot. Mirrors HidMotionSource's surface so the mapper can treat it like a
 * pad. WebHID allows only one open handle per device, so don't run this and the
 * gyro cube against the same controller at once.
 */
export class SwitchHidInput {
  private device: HIDDevice | null = null;
  private latest: PadSnapshot | null = null;

  private onReport = (event: HIDInputReportEvent) => {
    if (event.reportId !== 0x30) return; // ignore the 0x3F simple report
    const snapshot = decodeSwitchReport(event.data);
    if (snapshot) this.latest = snapshot;
  };

  read(): PadSnapshot | null {
    return this.latest;
  }

  get connected(): boolean {
    return this.device !== null;
  }

  get deviceName(): string | null {
    return this.device?.productName ?? null;
  }

  get vendorId(): number | null {
    return this.device?.vendorId ?? null;
  }

  get productId(): number | null {
    return this.device?.productId ?? null;
  }

  /** Reconnect a previously-granted device with no chooser (no gesture needed). */
  async connectGranted(): Promise<boolean> {
    const devices = await navigator.hid.getDevices();
    const device = devices.find(isSwitchDevice);
    return device ? this.open(device) : false;
  }

  /** Ask for a device — must be called from a user gesture (button click). */
  async requestAndConnect(): Promise<boolean> {
    const devices = await navigator.hid.requestDevice({
      filters: SWITCH_HID_FILTERS,
    });
    const device = devices.find(isSwitchDevice);
    return device ? this.open(device) : false;
  }

  private async open(device: HIDDevice): Promise<boolean> {
    try {
      if (!device.opened) await device.open();
      await switchEnableFullReports(device);
      device.addEventListener("inputreport", this.onReport);
      this.device = device;
      return true;
    } catch (err) {
      console.warn("[switch-hid-input] failed to open device:", err);
      return false;
    }
  }

  disconnect(): void {
    if (this.device) {
      this.device.removeEventListener("inputreport", this.onReport);
      this.device.close().catch(() => {});
      this.device = null;
    }
    this.latest = null;
  }
}
