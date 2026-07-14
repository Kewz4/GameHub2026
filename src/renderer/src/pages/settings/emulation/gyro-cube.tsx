import { useEffect, useRef } from "react";

/**
 * 3D gyro motion cube — a direct port of Eden's `Draw3dCube` from
 * `configure_input_player_widget.cpp`, rendered on HTML5 Canvas 2D (the
 * web equivalent of Qt's QPainter).
 *
 * Eden draws a wireframe box (0.7×1.0×0.5 proportions, mimicking Joy-Con
 * shape) by rotating 8 vertices with Tait-Bryan euler angles (roll, pitch,
 * yaw in radians) and projecting orthographically (dropping Z).
 *
 * Motion data comes from the Web Gamepad API's `pose` property (quaternion
 * orientation) when available (PS4/PS5 controllers via USB). For controllers
 * without pose, the cube stays static.
 *
 * The Mahony AHRS complementary filter is ported from Eden's
 * `MotionInput::UpdateOrientation` (hid_core/frontend/motion_input.cpp) to
 * fuse accelerometer + gyroscope data when those sensors are available via
 * the Gamepad API.
 */

interface Props {
  /** Gamepad index to read motion data from. */
  padIndex: number;
  /** Whether motion/gyro is enabled in the profile. */
  enabled: boolean;
}

// ── Mahony AHRS filter (ported from Eden's MotionInput) ──────────────────────

class MahonyAHRS {
  // Quaternion (w, x, y, z)
  private qw = 1;
  private qx = 0;
  private qy = 0;
  private qz = 0;

  // PID integral term
  private ix = 0;
  private iy = 0;
  private iz = 0;

  private readonly kp = 0.3;
  private readonly ki = 0.005;

  /** Process accel (G) + gyro (rad/s) → euler angles (rad). */
  update(accel: [number, number, number], gyro: [number, number, number], dt: number): [number, number, number] {
    // Normalize accelerometer
    const aLen = Math.hypot(accel[0], accel[1], accel[2]) || 1;
    const ax = accel[0] / aLen;
    const ay = accel[1] / aLen;
    const az = accel[2] / aLen;

    // Estimated gravity direction from quaternion
    const halfvx = this.qx * this.qz - this.qw * this.qy;
    const halfvy = this.qw * this.qx + this.qy * this.qz;
    const halfvz = this.qw * this.qw - 0.5 * (this.qx * this.qx + this.qy * this.qy);

    // Error is cross product between measured and estimated gravity
    const halfex = ay * halfvz - az * halfvy;
    const halfey = az * halfvx - ax * halfvz;
    const halfez = ax * halfvy - ay * halfvx;

    // PID feedback
    this.ix += this.ki * halfex * dt;
    this.iy += this.ki * halfey * dt;
    this.iz += this.ki * halfez * dt;

    const gx = gyro[0] - this.kp * halfex - this.ix;
    const gy = gyro[1] - this.kp * halfey - this.iy;
    const gz = gyro[2] - this.kp * halfez - this.iz;

    // Integrate quaternion: q' = q + 0.5 * q ⊗ ω * dt
    const dqw = 0.5 * (-this.qx * gx - this.qy * gy - this.qz * gz) * dt;
    const dqx = 0.5 * ( this.qw * gx + this.qy * gz - this.qz * gy) * dt;
    const dqy = 0.5 * ( this.qw * gy - this.qx * gz + this.qz * gx) * dt;
    const dqz = 0.5 * ( this.qw * gz + this.qx * gy - this.qy * gx) * dt;

    this.qw += dqw;
    this.qx += dqx;
    this.qy += dqy;
    this.qz += dqz;

    // Normalize
    const qlen = Math.hypot(this.qw, this.qx, this.qy, this.qz) || 1;
    this.qw /= qlen;
    this.qx /= qlen;
    this.qy /= qlen;
    this.qz /= qlen;

    // Extract euler angles (Tait-Bryan, same as Eden's GetEulerAngles)
    const roll = Math.atan2(
      2 * (this.qw * this.qx + this.qy * this.qz),
      1 - 2 * (this.qx * this.qx + this.qy * this.qy)
    );
    const pitch = 2 * Math.atan2(
      Math.sqrt(1 + 2 * (this.qw * this.qy - this.qx * this.qz)),
      Math.sqrt(1 - 2 * (this.qw * this.qy - this.qx * this.qz))
    ) - Math.PI / 2;
    const yaw = Math.atan2(
      2 * (this.qw * this.qz + this.qx * this.qy),
      1 - 2 * (this.qy * this.qy + this.qz * this.qz)
    );

    return [roll, pitch, yaw];
  }
}

// ── 3D cube geometry (ported from Eden's Draw3dCube) ─────────────────────────

const CUBE_VERTS: [number, number, number][] = [
  [-0.7, -1, -0.5],
  [-0.7, 1, -0.5],
  [0.7, 1, -0.5],
  [0.7, -1, -0.5],
  [-0.7, -1, 0.5],
  [-0.7, 1, 0.5],
  [0.7, 1, 0.5],
  [0.7, -1, 0.5],
];

function rotateVertex(
  [x, y, z]: [number, number, number],
  roll: number,
  pitch: number,
  yaw: number
): [number, number] {
  // Roll (X axis)
  let t = y;
  y = Math.cos(roll) * y - Math.sin(roll) * z;
  z = Math.sin(roll) * t + Math.cos(roll) * z;

  // Pitch (Y axis)
  t = x;
  x = Math.cos(pitch) * x + Math.sin(pitch) * z;
  z = -Math.sin(pitch) * t + Math.cos(pitch) * z;

  // Yaw (Z axis)
  t = x;
  x = Math.cos(yaw) * x - Math.sin(yaw) * y;
  y = Math.sin(yaw) * t + Math.cos(yaw) * y;

  // Orthographic projection: drop Z
  return [x, y];
}

function drawCube(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  euler: [number, number, number],
  size: number
) {
  const [roll, pitch, yaw] = euler;
  const projected = CUBE_VERTS.map((v) => {
    const [px, py] = rotateVertex(v, roll, pitch, yaw);
    return [cx + px * size, cy + py * size] as [number, number];
  });

  const P = (i: number) => projected[i];

  ctx.lineWidth = 2;
  ctx.strokeStyle = "#7aa2ff";

  // Front face
  ctx.beginPath();
  ctx.moveTo(...P(0));
  ctx.lineTo(...P(1));
  ctx.lineTo(...P(2));
  ctx.lineTo(...P(3));
  ctx.closePath();
  ctx.stroke();

  // Back face
  ctx.beginPath();
  ctx.moveTo(...P(4));
  ctx.lineTo(...P(5));
  ctx.lineTo(...P(6));
  ctx.lineTo(...P(7));
  ctx.closePath();
  ctx.stroke();

  // Connecting edges
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(...P(i));
    ctx.lineTo(...P(i + 4));
    ctx.stroke();
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function GyroCube({ padIndex, enabled }: Readonly<Props>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ahrsRef = useRef<MahonyAHRS>(new MahonyAHRS());
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;

    const loop = (time: number) => {
      const dt = lastTimeRef.current ? (time - lastTimeRef.current) / 1000 : 0.016;
      lastTimeRef.current = time;

      const gp = navigator.getGamepads()?.[padIndex];

      let euler: [number, number, number] = [0, 0, 0];

      if (gp) {
        // Try quaternion pose first (PS4/PS5 controllers via USB)
        if (gp.pose?.quaternion) {
          const q = gp.pose.quaternion;
          // Convert quaternion to euler directly
          const roll = Math.atan2(
            2 * (q[0] * q[1] + q[2] * q[3]),
            1 - 2 * (q[1] * q[1] + q[2] * q[2])
          );
          const pitch = 2 * Math.atan2(
            Math.sqrt(1 + 2 * (q[0] * q[2] - q[1] * q[3])),
            Math.sqrt(1 - 2 * (q[0] * q[2] - q[1] * q[3]))
          ) - Math.PI / 2;
          const yaw = Math.atan2(
            2 * (q[0] * q[3] + q[1] * q[2]),
            1 - 2 * (q[2] * q[2] + q[3] * q[3])
          );
          euler = [roll, pitch, yaw];
        }
        // Try accelerometer + gyroscope via AHRS filter
        else if (gp.pose?.acceleration && gp.pose?.angularVelocity) {
          const a = gp.pose.acceleration;
          const g = gp.pose.angularVelocity;
          euler = ahrsRef.current.update(
            [a[0], a[1], a[2]],
            [g[0], g[1], g[2]],
            dt
          );
        }
      }

      // Clear and draw
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawCube(ctx, canvas.width / 2, canvas.height / 2, euler, 30);

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [padIndex, enabled]);

  if (!enabled) return null;

  return (
    <div className="controller-mapper__card">
      <h4>Motion / Gyro</h4>
      <canvas
        ref={canvasRef}
        width={120}
        height={120}
        className="controller-mapper__gyro-cube"
      />
      <p className="controller-mapper__gyro-hint">
        Tilt your controller to see the 3D orientation cube rotate.
      </p>
    </div>
  );
}
