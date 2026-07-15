/**
 * Real controller motion (gyro + accel) over WebHID — the web equivalent of
 * the SDL sensor streams Eden reads. Chromium's Gamepad API never exposes
 * motion for game controllers (`gamepad.pose` stays null), so the gyro cube
 * gets its data here instead: we open the pad's HID device and parse the IMU
 * samples straight out of its input reports.
 *
 * Report layouts and scale factors follow SDL's hidapi drivers
 * (SDL_hidapi_ps4.c / ps5.c / switch.c), which is exactly what Eden consumes:
 *   - DualShock 4  (054C:05C4/09CC)  report 0x01 (USB), 0x11 (BT, +2 offset)
 *     gyro int16[3] @12, accel int16[3] @18 (offsets exclude the report id)
 *     gyro: 1024 LSB per °/s   accel: 8192 LSB per g
 *   - DualSense    (054C:0CE6/0DF2)  report 0x01 (USB), 0x31 (BT, +1 offset)
 *     gyro @15, accel @21 — same scales as DS4
 *   - Switch Pro   (057E:2009)       report 0x30 after a handshake that sets
 *     input mode 0x30 and enables the IMU (subcommands 0x03 / 0x40).
 *     3 IMU frames of accel int16[3] + gyro int16[3] starting @12.
 *     gyro: raw / 14.2842 = °/s   accel: raw / 4096 = g
 */

export interface MotionSample {
  /** rad/s */
  gyro: [number, number, number];
  /** g */
  accel: [number, number, number];
}

const DEG2RAD = Math.PI / 180;

const SONY_VENDOR = 0x054c;
const NINTENDO_VENDOR = 0x057e;

const DS4_PRODUCTS = [0x05c4, 0x09cc];
const DUALSENSE_PRODUCTS = [0x0ce6, 0x0df2];
const SWITCH_PRO_PRODUCT = 0x2009;

export const MOTION_HID_FILTERS = [
  ...DS4_PRODUCTS.map((productId) => ({ vendorId: SONY_VENDOR, productId })),
  ...DUALSENSE_PRODUCTS.map((productId) => ({
    vendorId: SONY_VENDOR,
    productId,
  })),
  { vendorId: NINTENDO_VENDOR, productId: SWITCH_PRO_PRODUCT },
];

function i16(view: DataView, offset: number): number {
  return view.getInt16(offset, true);
}

type Parser = (reportId: number, view: DataView) => MotionSample | null;

function sonySample(
  view: DataView,
  gyroOff: number,
  accelOff: number
): MotionSample {
  return {
    gyro: [
      (i16(view, gyroOff) / 1024) * DEG2RAD,
      (i16(view, gyroOff + 2) / 1024) * DEG2RAD,
      (i16(view, gyroOff + 4) / 1024) * DEG2RAD,
    ],
    accel: [
      i16(view, accelOff) / 8192,
      i16(view, accelOff + 2) / 8192,
      i16(view, accelOff + 4) / 8192,
    ],
  };
}

const parseDs4: Parser = (reportId, view) => {
  // USB full report 0x01; Bluetooth extended report 0x11 carries the same
  // packet two bytes later (SDL reads it at &data[3] including the id byte).
  if (reportId === 0x01 && view.byteLength >= 24)
    return sonySample(view, 12, 18);
  if (reportId === 0x11 && view.byteLength >= 26)
    return sonySample(view, 14, 20);
  return null;
};

const parseDualSense: Parser = (reportId, view) => {
  // USB report 0x01; BT report 0x31 starts one byte later (seq byte first).
  if (reportId === 0x01 && view.byteLength >= 27)
    return sonySample(view, 15, 21);
  if (reportId === 0x31 && view.byteLength >= 28)
    return sonySample(view, 16, 22);
  return null;
};

const parseSwitch: Parser = (reportId, view) => {
  // Full input report 0x30: state @0..11, then 3 IMU frames (5ms apart) of
  // accel XYZ + gyro XYZ int16. Use the newest frame (the first one).
  if (reportId !== 0x30 || view.byteLength < 24) return null;
  const base = 12;
  return {
    accel: [
      i16(view, base) / 4096,
      i16(view, base + 2) / 4096,
      i16(view, base + 4) / 4096,
    ],
    gyro: [
      (i16(view, base + 6) / 14.2842) * DEG2RAD,
      (i16(view, base + 8) / 14.2842) * DEG2RAD,
      (i16(view, base + 10) / 14.2842) * DEG2RAD,
    ],
  };
};

/** Switch Pro needs a handshake: set full-report mode + enable the IMU. */
async function switchHandshake(device: HIDDevice): Promise<void> {
  let packetCounter = 0;
  const subcommand = async (id: number, ...args: number[]) => {
    const buf = new Uint8Array(48);
    buf[0] = packetCounter++ & 0x0f;
    // Neutral rumble so the subcommand is accepted.
    buf.set([0x00, 0x01, 0x40, 0x40, 0x00, 0x01, 0x40, 0x40], 1);
    buf[9] = id;
    buf.set(args, 10);
    await device.sendReport(0x01, buf);
    // The controller acks asynchronously; a small gap keeps it happy.
    await new Promise((r) => setTimeout(r, 60));
  };
  await subcommand(0x40, 0x01); // EnableIMU
  await subcommand(0x03, 0x30); // SetInputReportMode: full reports @60Hz
}

function parserFor(device: HIDDevice): Parser | null {
  if (device.vendorId === SONY_VENDOR) {
    if (DS4_PRODUCTS.includes(device.productId)) return parseDs4;
    if (DUALSENSE_PRODUCTS.includes(device.productId)) return parseDualSense;
  }
  if (
    device.vendorId === NINTENDO_VENDOR &&
    device.productId === SWITCH_PRO_PRODUCT
  ) {
    return parseSwitch;
  }
  return null;
}

export class HidMotionSource {
  private device: HIDDevice | null = null;
  private latest: MotionSample | null = null;
  private onReport = (event: HIDInputReportEvent) => {
    const parser = this.device && parserFor(this.device);
    if (!parser) return;
    const sample = parser(event.reportId, event.data);
    if (sample) this.latest = sample;
  };

  /** Newest sample, or null if no motion-capable device is streaming. */
  read(): MotionSample | null {
    return this.latest;
  }

  get connected(): boolean {
    return this.device !== null;
  }

  get deviceName(): string | null {
    return this.device?.productName ?? null;
  }

  /** Reconnect a previously-granted device without a chooser (no gesture). */
  async connectGranted(): Promise<boolean> {
    const devices = await navigator.hid.getDevices();
    const device = devices.find((d) => parserFor(d));
    return device ? this.open(device) : false;
  }

  /** Ask for a device — must be called from a user gesture (button click). */
  async requestAndConnect(): Promise<boolean> {
    const devices = await navigator.hid.requestDevice({
      filters: MOTION_HID_FILTERS,
    });
    const device = devices.find((d) => parserFor(d));
    return device ? this.open(device) : false;
  }

  private async open(device: HIDDevice): Promise<boolean> {
    try {
      if (!device.opened) await device.open();
      if (
        device.vendorId === NINTENDO_VENDOR &&
        device.productId === SWITCH_PRO_PRODUCT
      ) {
        await switchHandshake(device);
      }
      device.addEventListener("inputreport", this.onReport);
      this.device = device;
      return true;
    } catch (err) {
      console.warn("[hid-motion] failed to open device:", err);
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
