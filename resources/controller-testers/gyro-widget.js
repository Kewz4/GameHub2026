(function() {
'use strict';

// ============ GYRO WIDGET ============

const STATE = {
  device: null,
  usbDevice: null,
  connected: false,
  usingUSB: false,
  animFrame: null,
  reportCount: 0,
  lastRateTime: 0,
  timer: 0,
  calibCount: 0,
  gyroBias: { x: 0, y: 0, z: 0 },
  orientation: { roll: 0, pitch: 0, yaw: 0 },
  logs: [],
  usbEndpoint: null,
  usbIface: null,
  lastReportTime: 0
};

const ALPHA = 0.96;
let logEl = null;

const FILTERS = [
  { vendorId: 0x054C, productId: 0x0CE6 },
  { vendorId: 0x054C, productId: 0x0DF2 },
  { vendorId: 0x054C, productId: 0x09CC },
  { vendorId: 0x054C, productId: 0x0BA0 },
  { vendorId: 0x057E, productId: 0x2009 },
  { vendorId: 0x057E, productId: 0x2006 },
  { vendorId: 0x057E, productId: 0x2007 },
  { vendorId: 0x2DC8 },
  { vendorId: 0x20D6 },
];

function log(msg) {
  STATE.logs.push(msg);
  if (logEl) {
    const d = document.createElement('div');
    d.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
    while (logEl.children.length > 50) logEl.removeChild(logEl.firstChild);
  }
}

function updateUI() {
  const badge = document.getElementById('gyro-status');
  if (badge) {
    badge.textContent = STATE.connected ? 'Connected' : 'Disconnected';
    badge.className = 'gyro-status ' + (STATE.connected ? 'gyro-connected' : 'gyro-disconnected');
  }
  const btn = document.getElementById('gyro-connect-btn');
  if (btn) btn.disabled = STATE.connected;
  const discBtn = document.getElementById('gyro-disconnect-btn');
  if (discBtn) discBtn.disabled = !STATE.connected;
}

function detectProtocol(dev) {
  const vid = dev.vendorId;
  const pid = dev.productId;
  return (vid === 0x054C && (pid === 0x0CE6 || pid === 0x0DF2)) ? 'dualsense'
    : (vid === 0x054C && (pid === 0x09CC || pid === 0x0BA0)) ? 'ds4'
    : (vid === 0x057E && pid === 0x2009) ? 'switch_pro'
    : (vid === 0x057E && (pid === 0x2006 || pid === 0x2007)) ? 'joycon'
    : (vid === 0x2DC8) ? '8bitdo'
    : 'unknown';
}

function setNum(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setBar(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.min(100, Math.max(0, pct)) + '%';
}

// ============ CORE REPORT PARSING (shared by WebHID and WebUSB) ============

function onInputReportCommon(reportId, data, blen) {
  STATE.reportCount++;

  const protocol = STATE.connected ? detectProtocol(STATE.device || STATE.usbDevice) : 'unknown';

  // Log first 10 reports with ALL bytes
  if (STATE.reportCount <= 10) {
    const bytes = [];
    for (let i = 0; i < blen; i++) bytes.push(data.getUint8(i));
    log('Report #' + STATE.reportCount + ' ID=0x' + reportId.toString(16) + ' len=' + blen + ' proto=' + protocol + ' bytes=[' + bytes.join(',') + ']');
  }

  // Retry IMU init after 10 reports if still no 0x30
  if ((protocol === 'switch_pro' || protocol === '8bitdo' || protocol === 'joycon') && STATE.reportCount === 10) {
    log('Still no IMU data after 10 reports, re-sending IMU init...');
    initSwitchProIMU();
  }

  let gx, gy, gz, ax, ay, az;
  let found = false;

  // DualSense / DS4
  if ((protocol === 'dualsense' || protocol === 'ds4') && blen >= 31) {
    gx = data.getInt16(19, true); gy = data.getInt16(21, true); gz = data.getInt16(23, true);
    ax = data.getInt16(25, true); ay = data.getInt16(27, true); az = data.getInt16(29, true);
    if (Math.abs(gx) > 10 || Math.abs(gy) > 10 || Math.abs(gz) > 10 || Math.abs(ax) > 100 || Math.abs(ay) > 100) found = true;
    if (!found && reportId === 0x31 && blen >= 78) {
      gx = data.getInt16(20, true); gy = data.getInt16(22, true); gz = data.getInt16(24, true);
      ax = data.getInt16(26, true); ay = data.getInt16(28, true); az = data.getInt16(30, true);
      found = true;
    }
  }

  // Switch Pro / 8BitDo / Joy-Con: report ID 0x30 has IMU
  // 8BitDo in Switch mode sends 64-byte HID reports (1 ID + 63 data) vs
  // Switch Pro 63-byte (1 ID + 62 data).  The extra byte shifts IMU by 1.
  // Correct offsets: 17 (8BitDo 63-data), 16 (Switch Pro 62-data), 13, 3 (Joy-Con)
  if (!found && (protocol === 'switch_pro' || protocol === '8bitdo' || protocol === 'joycon')) {
    if (reportId === 0x30 && blen >= 49) {
      const offsets = protocol === 'joycon' ? [3, 15, 13]
        : protocol === '8bitdo' ? [17, 16, 15, 13, 3]
        : [16, 15, 13, 3];
      for (const off of offsets) {
        if (off + 11 >= blen) continue;
        ax = (data.getUint8(off+1) << 8) | data.getUint8(off);
        ay = (data.getUint8(off+3) << 8) | data.getUint8(off+2);
        az = (data.getUint8(off+5) << 8) | data.getUint8(off+4);
        gx = (data.getUint8(off+7) << 8) | data.getUint8(off+6);
        gy = (data.getUint8(off+9) << 8) | data.getUint8(off+8);
        gz = (data.getUint8(off+11) << 8) | data.getUint8(off+10);
        ax = ax > 32767 ? ax - 65536 : ax;
        ay = ay > 32767 ? ay - 65536 : ay;
        az = az > 32767 ? az - 65536 : az;
        gx = gx > 32767 ? gx - 65536 : gx;
        gy = gy > 32767 ? gy - 65536 : gy;
        gz = gz > 32767 ? gz - 65536 : gz;
        // Verify: gyro values should be small (0-200) when still, not random large numbers
        if (Math.abs(gx) < 5000 && Math.abs(gy) < 5000 && Math.abs(gz) < 5000 &&
            Math.abs(ax) < 5000 && Math.abs(ay) < 5000 && Math.abs(az) < 5000) {
          if (STATE.reportCount <= 3) log('IMU found at offset ' + off);
          found = true;
          break;
        }
      }
    } else if (reportId === 0x21) {
      if (STATE.reportCount <= 5) log('Simple report (0x21) - waiting for IMU...');
    } else if (reportId === 0x01 && blen < 30) {
      if (STATE.reportCount <= 5) log('Standard HID report (0x01) - controller not in Switch Pro mode.');
    }
  }

  if (!found) {
    // Even with WebUSB, if IMU init hasn't worked, the controller won't send 0x30 reports.
    // Try to detect IMU data at offset 19-30 (DualSense-like) as a fallback
    if (blen >= 31) {
      gx = data.getInt16(19, true); gy = data.getInt16(21, true); gz = data.getInt16(23, true);
      ax = data.getInt16(25, true); ay = data.getInt16(27, true); az = data.getInt16(29, true);
      if (Math.abs(gx) > 100 || Math.abs(gy) > 100 || Math.abs(gz) > 100 || Math.abs(ax) > 1000) {
        if (STATE.reportCount <= 5) log('Found possible sensor data at DualSense offsets (19-30)');
        found = true;
      }
    }
    // Try 8BitDo extended report offset (bytes 48-59 of a 64-byte report)
    if (!found && blen >= 60) {
      for (let off = 48; off + 11 < blen; off += 6) {
        gx = data.getInt16(off, true);
        gy = data.getInt16(off + 2, true);
        gz = data.getInt16(off + 4, true);
        if (Math.abs(gx) > 50 || Math.abs(gy) > 50 || Math.abs(gz) > 50) {
          ax = data.getInt16(off + 6, true);
          ay = data.getInt16(off + 8, true);
          az = data.getInt16(off + 10, true);
          if (STATE.reportCount <= 5) log('Found possible IMU at offset ' + off);
          found = true;
          break;
        }
      }
    }
  }

  if (!found) {
    if (STATE.reportCount <= 5) {
      log('No gyro data (ID=0x' + reportId.toString(16) + ' len=' + blen + ')');
      if (protocol === '8bitdo') {
        log('Tip: Use WebUSB (second button). Set controller to Switch mode (Home+Y).');
      }
    }
    return;
  }

  const now = performance.now();
  const dt = STATE.lastReportTime ? Math.min((now - STATE.lastReportTime) / 1000, 0.05) : 1/60;
  STATE.lastReportTime = now;
  updateSensors(gx, gy, gz, ax, ay, az, protocol, dt);
}

// ============ WebHID HANDLER ============

function onInputReport(event) {
  if (!STATE.connected || STATE.usingUSB) return;
  onInputReportCommon(event.reportId, event.data, event.data.byteLength);
}

// ============ WebUSB IMPLEMENTATION ============

async function connectUSB() {
  if (!navigator.usb) {
    log('WebUSB not available. Use Chrome or Edge.');
    return;
  }

  log('Requesting USB device...');
  try {
    const devices = await navigator.usb.requestDevice({
      filters: [
        { vendorId: 0x2DC8 },
        { vendorId: 0x057E, productId: 0x2009 },
        { vendorId: 0x057E, productId: 0x2006 },
        { vendorId: 0x057E, productId: 0x2007 },
      ]
    });
    if (!devices.length) { log('No device selected'); return; }

    const dev = devices[0];
    const protocol = detectProtocol(dev);
    log('Opening: ' + dev.productName + ' (' + protocol + ') [VID:0x' + dev.vendorId.toString(16) + ' PID:0x' + dev.productId.toString(16) + ']');

    await dev.open();
    log('USB device opened');

    // Select configuration
    if (dev.configuration === null) {
      await dev.selectConfiguration(1);
    }

    // Find HID interface (class 3) with interrupt IN endpoint
    let iface = null;
    let inEp = null;

    for (const cfg of dev.configurations) {
      for (const iface_ of cfg.interfaces) {
        const alt = iface_.alternate;
        // Prefer HID class, fall back to any interface with interrupt IN
        if (alt.interfaceClass === 3 || alt.interfaceClass === 0) {
          for (const ep of alt.endpoints) {
            if (ep.direction === 'in' && ep.type === 'interrupt') {
              iface = iface_;
              inEp = ep.endpointNumber;
              break;
            }
          }
          if (iface) break;
        }
      }
      if (iface) break;
    }

    if (!iface || !inEp) {
      log('No suitable USB interface found (need interrupt IN endpoint)');
      await dev.close();
      return;
    }

    log('Using interface ' + iface.interfaceNumber + ' (class=' + iface.alternate.interfaceClass + '), EP IN=' + inEp);

    // Detach kernel driver (Windows)
    try {
      await dev.detachKernelDriver(iface.interfaceNumber);
      log('Kernel driver detached');
    } catch(e) {
      log('Note: Could not detach kernel driver: ' + e.message);
    }

    // Claim interface
    try {
      await dev.claimInterface(iface.interfaceNumber);
    } catch(e) {
      log('Failed to claim interface: ' + e.message);
      log('Tip: Close other apps using the controller (Steam, 8BitDo software, browser tabs)');
      log('Tip: On Windows, you may need to install WinUSB driver via Zadig tool');
      await dev.close();
      return;
    }

    // Store state
    STATE.usbDevice = dev;
    STATE.usbEndpoint = inEp;
    STATE.usbIface = iface;
    STATE.usingUSB = true;
    STATE.connected = true;
    STATE.reportCount = 0;
    STATE.calibCount = 0;
    STATE.gyroBias = { x: 0, y: 0, z: 0 };
    updateUI();

    const infoEl = document.getElementById('gyro-device-info');
    if (infoEl) infoEl.textContent = dev.productName + ' (' + protocol + ') via USB';

    // Send IMU init
    await initSwitchProIMU_USB(dev, iface);

    // Start reading
    log('Listening for sensor data via WebUSB...');
    readLoopUSB(dev, inEp);

  } catch(e) {
    log('USB connect error: ' + e.message);
    console.error('USB connect error:', e);
  }
}

async function initSwitchProIMU_USB(dev, iface) {
  log('Initializing IMU via WebUSB...');
  const protocol = detectProtocol(dev);

  // Try both report ID 0x01 (standard) and 0x00 (raw)
  for (const rid of [0x01, 0x00]) {
    try {
      // 49-byte output report (includes report ID at byte 0 for USB raw access)
      const data = new Uint8Array(49);
      data[0] = rid;
      data[1] = STATE.timer = (STATE.timer + 1) & 0xFF;

      // Subcommand 0x40: Enable IMU
      data[10] = 0x40;
      data[11] = 0x01;

      await dev.controlTransferOut({
        requestType: 'class',
        recipient: 'interface',
        request: 0x09, // SET_REPORT
        value: (0x03 << 8) | rid, // Output report type
        index: iface.interfaceNumber
      }, data);
      log('IMU enable (SET_REPORT 0x' + rid.toString(16) + ')');

      await new Promise(r => setTimeout(r, 100));

      // Subcommand 0x41: Sensitivity
      data[10] = 0x41;
      data[11] = 0x28;
      data[12] = 0x08;
      data[13] = 0x01;
      data[14] = 0x01;

      await dev.controlTransferOut({
        requestType: 'class',
        recipient: 'interface',
        request: 0x09,
        value: (0x03 << 8) | rid,
        index: iface.interfaceNumber
      }, data);
      log('IMU sensitivity (SET_REPORT 0x' + rid.toString(16) + ')');

      await new Promise(r => setTimeout(r, 100));

    } catch(e) {
      log('USB SET_REPORT 0x' + rid.toString(16) + ' failed: ' + e.message);
    }
  }
}

async function readLoopUSB(dev, ep) {
  while (STATE.connected && STATE.usingUSB) {
    try {
      const result = await dev.transferIn(ep, 64);
      if (result.data && result.data.byteLength > 0) {
        const raw = result.data;
        const reportId = raw.getUint8(0);
        // DataView starting after report ID byte
        const dataView = new DataView(raw.buffer, raw.byteOffset + 1, raw.byteLength - 1);
        onInputReportCommon(reportId, dataView, raw.byteLength - 1);
      }
    } catch(e) {
      if (STATE.connected) {
        log('USB read error: ' + e.message);
        disconnect();
      }
      break;
    }
  }
}

// ============ WebHID CONNECT ============

async function connect() {
  try {
    log('Requesting HID device...');
    log('For 8BitDo, use the "Connect via USB (WebUSB)" button instead (the blue one).');
    const devices = await navigator.hid.requestDevice({ filters: FILTERS });
    if (!devices.length) { log('No device selected'); return; }

    STATE.device = devices[0];
    const dev = STATE.device;
    const protocol = detectProtocol(dev);
    log('Opening: ' + dev.productName + ' (' + protocol + ') [VID:0x' + dev.vendorId.toString(16) + ' PID:0x' + dev.productId.toString(16) + ']');

    await dev.open();
    log('Device opened');

    STATE.connected = true;
    STATE.usingUSB = false;
    STATE.reportCount = 0;
    STATE.calibCount = 0;
    STATE.gyroBias = { x: 0, y: 0, z: 0 };
    updateUI();

    const infoEl = document.getElementById('gyro-device-info');
    if (infoEl) infoEl.textContent = dev.productName + ' (' + protocol + ')';

    // Init IMU for Switch Pro / 8BitDo / Joy-Con
    if (protocol === 'switch_pro' || protocol === '8bitdo' || protocol === 'joycon') {
      await initSwitchProIMU_HID(dev);
    }

    // Set up report listener
    dev.addEventListener('inputreport', onInputReport);
    dev.addEventListener('disconnect', () => { log('Device disconnected'); disconnect(); });

    // Start rendering
    STATE.lastRateTime = performance.now();
    if (STATE.animFrame) cancelAnimationFrame(STATE.animFrame);
    renderLoop();

    log('Listening for sensor data...');

  } catch(e) {
    log('Connect error: ' + e.message);
    console.error('Gyro connect error:', e);
  }
}

async function initSwitchProIMU_HID(dev) {
  const protocol = detectProtocol(dev);
  log('Initializing IMU via HID... (' + dev.productName + ' proto=' + protocol + ')');

  // WebHID sendReport(reportId, data) automatically prepends the report ID byte.
  // The data buffer must NOT include the report ID (48 bytes for Switch Pro).
  const subcmdBuf = new Uint8Array(48);
  subcmdBuf[0] = STATE.timer = (STATE.timer + 1) & 0xFF; // timer/counter

  for (const rid of [0x01, 0x00]) {
    try {
      subcmdBuf[9] = 0x40; // subcommand: enable IMU
      subcmdBuf[10] = 0x01;
      await dev.sendReport(rid, subcmdBuf);
      log('IMU enable via HID report 0x' + rid.toString(16));
      await new Promise(r => setTimeout(r, 100));

      subcmdBuf[9] = 0x41; // sensitivity
      subcmdBuf[10] = 0x28;
      subcmdBuf[11] = 0x08;
      subcmdBuf[12] = 0x01;
      subcmdBuf[13] = 0x01;
      await dev.sendReport(rid, subcmdBuf);
      log('IMU sensitivity via HID report 0x' + rid.toString(16));
      await new Promise(r => setTimeout(r, 100));
    } catch(e) {
      log('HID sendReport 0x' + rid.toString(16) + ' failed: ' + e.message);
    }
  }
}

async function disconnect() {
  if (STATE.animFrame) { cancelAnimationFrame(STATE.animFrame); STATE.animFrame = null; }
  if (STATE.usingUSB && STATE.usbDevice) {
    try {
      if (STATE.usbIface) await STATE.usbDevice.releaseInterface(STATE.usbIface.interfaceNumber);
      await STATE.usbDevice.close();
    } catch(e) {}
    STATE.usbDevice = null;
    STATE.usbEndpoint = null;
    STATE.usbIface = null;
  }
  if (STATE.device) {
    try {
      STATE.device.removeEventListener('inputreport', onInputReport);
      await STATE.device.close();
    } catch(e) {}
    STATE.device = null;
  }
  STATE.connected = false;
  STATE.usingUSB = false;
  updateUI();
  log('Disconnected');
}

function renderLoop() {
  if (!STATE.connected) return;
  const now = performance.now();
  const elapsed = now - STATE.lastRateTime;
  if (elapsed >= 1000) {
    const rate = Math.round(STATE.reportCount / (elapsed / 1000));
    const el = document.getElementById('gyro-rate');
    if (el) el.textContent = rate + ' Hz';
    STATE.reportCount = 0;
    STATE.lastRateTime = now;
  }
  STATE.animFrame = requestAnimationFrame(renderLoop);
}

function updateSensors(gx, gy, gz, ax, ay, az, protocol, dt) {
  let gyroScale, accelScale;
  if (protocol === 'switch_pro' || protocol === '8bitdo' || protocol === 'joycon') {
    gyroScale = 14.2842;
    accelScale = 4096;
  } else {
    gyroScale = 86;
    accelScale = 8192;
  }

  const rawGX = gx / gyroScale;
  const rawGY = gy / gyroScale;
  const rawGZ = gz / gyroScale;
  const rawAX = ax / accelScale;
  const rawAY = ay / accelScale;
  const rawAZ = az / accelScale;

  // Auto-calibrate (first 30 samples at rest)
  if (STATE.calibCount < 30) {
    STATE.gyroBias.x += rawGX;
    STATE.gyroBias.y += rawGY;
    STATE.gyroBias.z += rawGZ;
    STATE.calibCount++;
    if (STATE.calibCount === 30) {
      STATE.gyroBias.x /= 30;
      STATE.gyroBias.y /= 30;
      STATE.gyroBias.z /= 30;
      log('Calibrated! Bias: (' + STATE.gyroBias.x.toFixed(2) + ', ' + STATE.gyroBias.y.toFixed(2) + ', ' + STATE.gyroBias.z.toFixed(2) + ')');
    }
    return;
  }

  const wGX = rawGX - STATE.gyroBias.x;
  const wGY = rawGY - STATE.gyroBias.y;
  const wGZ = rawGZ - STATE.gyroBias.z;

  setNum('gyro-gx', wGX.toFixed(2));
  setNum('gyro-gy', wGY.toFixed(2));
  setNum('gyro-gz', wGZ.toFixed(2));
  setNum('gyro-ax', rawAX.toFixed(2));
  setNum('gyro-ay', rawAY.toFixed(2));
  setNum('gyro-az', rawAZ.toFixed(2));

  setBar('gyro-gx-bar', (wGX / 500 + 1) * 50);
  setBar('gyro-gy-bar', (wGY / 500 + 1) * 50);
  setBar('gyro-gz-bar', (wGZ / 500 + 1) * 50);
  setBar('gyro-ax-bar', (rawAX / 2 + 1) * 50);
  setBar('gyro-ay-bar', (rawAY / 2 + 1) * 50);
  setBar('gyro-az-bar', (rawAZ / 2 + 1) * 50);

  const radGX = wGX * Math.PI / 180;
  const radGY = wGY * Math.PI / 180;
  const radGZ = wGZ * Math.PI / 180;

  const accelPitch = Math.atan2(-rawAX, Math.sqrt(rawAY * rawAY + rawAZ * rawAZ));
  const accelRoll = Math.atan2(rawAY, rawAZ);

  // GX = rotation around X (right) → roll; GY = rotation around Y (forward) → pitch; GZ = rotation around Z (up) → yaw
  STATE.orientation.roll  += radGX * dt;
  STATE.orientation.pitch += radGY * dt;
  STATE.orientation.yaw   += radGZ * dt;

  STATE.orientation.pitch = ALPHA * STATE.orientation.pitch + (1 - ALPHA) * accelPitch;
  STATE.orientation.roll  = ALPHA * STATE.orientation.roll  + (1 - ALPHA) * accelRoll;

  const pitchDeg = STATE.orientation.pitch * 180 / Math.PI;
  const rollDeg  = STATE.orientation.roll  * 180 / Math.PI;
  const yawDeg   = STATE.orientation.yaw   * 180 / Math.PI;

  setNum('gyro-pitch', pitchDeg.toFixed(1));
  setNum('gyro-roll', rollDeg.toFixed(1));
  setNum('gyro-yaw', yawDeg.toFixed(1));

  const cube = document.getElementById('gyro-cube');
  if (cube) {
    cube.style.transform = 'rotateX(' + pitchDeg.toFixed(1) + 'deg) rotateY(' + yawDeg.toFixed(1) + 'deg) rotateZ(' + (-rollDeg).toFixed(1) + 'deg)';
  }
}

function zeroOrientation() {
  STATE.orientation = { roll: 0, pitch: 0, yaw: 0 };
  STATE.calibCount = 0;
  STATE.gyroBias = { x: 0, y: 0, z: 0 };
  const cube = document.getElementById('gyro-cube');
  if (cube) cube.style.transform = 'rotateX(0deg) rotateY(0deg) rotateZ(0deg)';
  log('Orientation reset, re-calibrating...');
}

// ============ BUILD UI ============

function buildWidget(containerId) {
  const container = document.getElementById(containerId) || document.body;
  const wrap = document.createElement('div');
  wrap.id = 'gyro-widget';
  wrap.innerHTML = `
<style>
.gyro-wdg{background:#fff;border-radius:24px;border:1px solid #e7e5e4;padding:24px;margin-bottom:24px}
.gyro-wdg h2{font-size:16px;font-weight:700;margin:0 0 16px;display:flex;align-items:center;gap:8px;color:#44403c}
.gyro-row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}
.gyro-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border-radius:12px;border:none;font-size:13px;font-weight:700;cursor:pointer;transition:all .2s;white-space:nowrap;font-family:inherit}
.gyro-btn-pri{background:#6366f1;color:#fff}
.gyro-btn-pri:hover{background:#4f46e5}
.gyro-btn-pri:disabled{background:#a5b4fc;cursor:not-allowed}
.gyro-btn-sec{background:#f5f5f4;color:#44403c;border:1px solid #e7e5e4}
.gyro-btn-sec:hover{background:#e7e5e4}
.gyro-btn-sec:disabled{opacity:.4;cursor:not-allowed}
.gyro-btn-usb{background:#059669;color:#fff}
.gyro-btn-usb:hover{background:#047857}
.gyro-status{padding:6px 14px;border-radius:8px;font-size:12px;font-weight:700;display:inline-flex;align-items:center}
.gyro-disconnected{background:#fef2f2;color:#dc2626}
.gyro-connected{background:#f0fdf4;color:#059669}
.gyro-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:768px){.gyro-grid{grid-template-columns:1fr}}
.gyro-scene{display:flex;align-items:center;justify-content:center;min-height:280px;perspective:600px}
.gyro-cube-wrap{width:180px;height:180px;perspective:600px}
.gyro-cube{width:180px;height:180px;position:relative;transform-style:preserve-3d;transition:transform .05s linear}
.gyro-face{position:absolute;width:180px;height:180px;border:2px solid #6366f1;background:rgba(99,102,241,.08);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#6366f1;backface-visibility:hidden;border-radius:10px}
.gyro-f1{transform:translateZ(90px)}
.gyro-f2{transform:rotateY(180deg) translateZ(90px)}
.gyro-f3{transform:rotateY(90deg) translateZ(90px)}
.gyro-f4{transform:rotateY(-90deg) translateZ(90px)}
.gyro-f5{transform:rotateX(90deg) translateZ(90px)}
.gyro-f6{transform:rotateX(-90deg) translateZ(90px)}
.gyro-orient{display:flex;gap:8px;margin-top:12px}
.gyro-orient-item{flex:1;text-align:center;padding:10px;background:#fafaf9;border-radius:10px;border:1px solid #e7e5e4}
.gyro-orient-lbl{font-size:10px;font-weight:700;color:#a8a29e;text-transform:uppercase}
.gyro-orient-val{font-size:20px;font-weight:900;color:#1c1917;font-family:ui-monospace,monospace;margin-top:2px}
.gyro-orient-deg{font-size:11px;color:#a8a29e}
.gyro-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.gyro-stat{background:#fafaf9;border-radius:10px;padding:10px;border:1px solid #e7e5e4}
.gyro-stat-lbl{font-size:10px;font-weight:700;color:#a8a29e;text-transform:uppercase}
.gyro-stat-val{font-size:15px;font-weight:800;color:#1c1917;font-family:ui-monospace,monospace;margin-top:2px}
.gyro-stat-unit{font-size:10px;color:#a8a29e;font-weight:600}
.gyro-bar{height:3px;border-radius:2px;margin-top:4px;background:#e7e5e4;overflow:hidden}
.gyro-bar-fill{height:100%;border-radius:2px;transition:width .05s;background:linear-gradient(90deg,#6366f1,#8b5cf6)}
.gyro-log{max-height:150px;overflow-y:auto;font-size:11px;line-height:1.5;color:#78716c;font-family:ui-monospace,monospace;margin-top:12px;background:#fafaf9;border-radius:10px;padding:10px;border:1px solid #e7e5e4}
.gyro-log div{border-bottom:1px solid #f5f5f4;padding:2px 0}
.gyro-device{font-size:12px;color:#78716c;padding:6px 0}
.gyro-device span{font-weight:700;color:#44403c}
</style>
<div class="gyro-wdg">
  <h2>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/></svg>
    Gyroscope &amp; Motion Test
    <span id="gyro-status" class="gyro-status gyro-disconnected">Disconnected</span>
  </h2>
  <p style="font-size:13px;color:#78716c;margin:0 0 12px;line-height:1.5">
    Connect your controller to test gyroscope and accelerometer.
    <strong>For 8BitDo:</strong> use the green <strong>WebUSB</strong> button. Set controller to <strong>Switch mode</strong> (Home+Y). Requires Chrome/Edge.
  </p>
  <div class="gyro-row" style="align-items:center">
    <button id="gyro-connect-btn" class="gyro-btn gyro-btn-pri" onclick="window.__gyroConnect()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
      Connect (HID)
    </button>
    <button id="gyro-usb-btn" class="gyro-btn gyro-btn-usb" onclick="window.__gyroConnectUSB()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M10 7V4h4v3"/><path d="M9 17v3h6v-3"/></svg>
      Connect via USB (WebUSB)
    </button>
    <button id="gyro-disconnect-btn" class="gyro-btn gyro-btn-sec" onclick="window.__gyroDisconnect()" disabled>Disconnect</button>
    <button class="gyro-btn gyro-btn-sec" onclick="window.__gyroZero()">Reset</button>
    <span id="gyro-rate" style="font-size:12px;color:#a8a29e;font-weight:600;margin-left:auto">0 Hz</span>
  </div>
  <div id="gyro-device-info" class="gyro-device">Not connected</div>

  <div class="gyro-grid">
    <div>
      <div class="gyro-scene">
        <div class="gyro-cube-wrap">
          <div id="gyro-cube" class="gyro-cube" style="transform:rotateX(0deg) rotateY(0deg) rotateZ(0deg)">
            <div class="gyro-face gyro-f1">FRONT</div>
            <div class="gyro-face gyro-f2">BACK</div>
            <div class="gyro-face gyro-f3">RIGHT</div>
            <div class="gyro-face gyro-f4">LEFT</div>
            <div class="gyro-face gyro-f5">TOP</div>
            <div class="gyro-face gyro-f6">BOTTOM</div>
          </div>
        </div>
      </div>
      <div class="gyro-orient">
        <div class="gyro-orient-item"><div class="gyro-orient-lbl">Roll</div><div class="gyro-orient-val"><span id="gyro-roll">0.0</span>&deg;</div></div>
        <div class="gyro-orient-item"><div class="gyro-orient-lbl">Pitch</div><div class="gyro-orient-val"><span id="gyro-pitch">0.0</span>&deg;</div></div>
        <div class="gyro-orient-item"><div class="gyro-orient-lbl">Yaw</div><div class="gyro-orient-val"><span id="gyro-yaw">0.0</span>&deg;</div></div>
      </div>
    </div>
    <div>
      <div class="gyro-stats">
        <div class="gyro-stat"><div class="gyro-stat-lbl">Gyro X</div><div class="gyro-stat-val"><span id="gyro-gx">0.00</span> <span class="gyro-stat-unit">deg/s</span></div><div class="gyro-bar"><div class="gyro-bar-fill" id="gyro-gx-bar" style="width:50%"></div></div></div>
        <div class="gyro-stat"><div class="gyro-stat-lbl">Gyro Y</div><div class="gyro-stat-val"><span id="gyro-gy">0.00</span> <span class="gyro-stat-unit">deg/s</span></div><div class="gyro-bar"><div class="gyro-bar-fill" id="gyro-gy-bar" style="width:50%"></div></div></div>
        <div class="gyro-stat"><div class="gyro-stat-lbl">Gyro Z</div><div class="gyro-stat-val"><span id="gyro-gz">0.00</span> <span class="gyro-stat-unit">deg/s</span></div><div class="gyro-bar"><div class="gyro-bar-fill" id="gyro-gz-bar" style="width:50%"></div></div></div>
        <div class="gyro-stat"><div class="gyro-stat-lbl">Accel X</div><div class="gyro-stat-val"><span id="gyro-ax">0.00</span> <span class="gyro-stat-unit">G</span></div><div class="gyro-bar"><div class="gyro-bar-fill" id="gyro-ax-bar" style="width:50%"></div></div></div>
        <div class="gyro-stat"><div class="gyro-stat-lbl">Accel Y</div><div class="gyro-stat-val"><span id="gyro-ay">0.00</span> <span class="gyro-stat-unit">G</span></div><div class="gyro-bar"><div class="gyro-bar-fill" id="gyro-ay-bar" style="width:50%"></div></div></div>
        <div class="gyro-stat"><div class="gyro-stat-lbl">Accel Z</div><div class="gyro-stat-val"><span id="gyro-az">0.00</span> <span class="gyro-stat-unit">G</span></div><div class="gyro-bar"><div class="gyro-bar-fill" id="gyro-az-bar" style="width:50%"></div></div></div>
      </div>
    </div>
  </div>
  <div id="gyro-log" class="gyro-log">
    <div>Ready. Use the green "Connect via USB (WebUSB)" button for 8BitDo controllers. Set controller to Switch mode (Home+Y).</div>
  </div>
</div>
`;
  container.appendChild(wrap);

  logEl = document.getElementById('gyro-log');

  // Expose functions globally
  window.__gyroConnect = connect;
  window.__gyroConnectUSB = connectUSB;
  window.__gyroDisconnect = disconnect;
  window.__gyroZero = zeroOrientation;

  // Listen for auto-disconnect
  navigator.hid.addEventListener('disconnect', (e) => {
    if (STATE.device && e.device.deviceId === STATE.device.deviceId) {
      log('Device disconnected (system)');
      disconnect();
    }
  });
}

// Auto-init on load
if (document.readyState === 'complete') {
  buildWidget('gyro-widget-container');
} else {
  window.addEventListener('load', () => buildWidget('gyro-widget-container'));
}

})();
