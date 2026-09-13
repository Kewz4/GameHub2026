import type { HydraOverlayGamepadAction } from "@types";

export type OverlayControllerDirection = Extract<
  HydraOverlayGamepadAction,
  "up" | "down" | "left" | "right"
>;

/**
 * A spatial miss may walk a virtualized/overflowing list only on its primary
 * (vertical) axis. Horizontal input remains spatial, so Right at the end of a
 * row never jumps to the first item on the next row.
 */
export const getOverlaySequentialNavigationOffset = (
  direction: OverlayControllerDirection
): -1 | 1 | null => (direction === "up" ? -1 : direction === "down" ? 1 : null);

export type OverlayControllerRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type OverlayControllerCandidate<T> = {
  value: T;
  rect: OverlayControllerRect;
};

const GAMEPAD_REPEAT_DELAY_MS = 360;
const GAMEPAD_REPEAT_INTERVAL_MS = 105;
const GAMEPAD_AXIS_THRESHOLD = 0.55;
export const OVERLAY_GAMEPAD_DUPLICATE_WINDOW_MS = 80;

export type OverlayControllerInputSource = "native" | "browser";
export type OverlayControllerArbitrationState = {
  action: HydraOverlayGamepadAction;
  source: OverlayControllerInputSource;
  acceptedAt: number;
} | null;

export const arbitrateOverlayControllerAction = (
  state: OverlayControllerArbitrationState,
  action: HydraOverlayGamepadAction,
  source: OverlayControllerInputSource,
  now: number,
  duplicateWindowMs = OVERLAY_GAMEPAD_DUPLICATE_WINDOW_MS
): { accepted: boolean; state: OverlayControllerArbitrationState } => {
  const duplicate =
    state !== null &&
    state.source !== source &&
    state.action === action &&
    now - state.acceptedAt >= 0 &&
    now - state.acceptedAt <= duplicateWindowMs;
  if (duplicate) return { accepted: false, state };
  return { accepted: true, state: { action, source, acceptedAt: now } };
};

const GAMEPAD_BITS = {
  accept: 1 << 0,
  back: 1 << 1,
  previousTab: 1 << 2,
  nextTab: 1 << 3,
  up: 1 << 4,
  down: 1 << 5,
  left: 1 << 6,
  right: 1 << 7,
} as const;

const GAMEPAD_ACTIONS: ReadonlyArray<[number, HydraOverlayGamepadAction]> = [
  [GAMEPAD_BITS.accept, "accept"],
  [GAMEPAD_BITS.back, "back"],
  [GAMEPAD_BITS.previousTab, "previous-tab"],
  [GAMEPAD_BITS.nextTab, "next-tab"],
  [GAMEPAD_BITS.up, "up"],
  [GAMEPAD_BITS.down, "down"],
  [GAMEPAD_BITS.left, "left"],
  [GAMEPAD_BITS.right, "right"],
];

const DIRECTION_MASK =
  GAMEPAD_BITS.up | GAMEPAD_BITS.down | GAMEPAD_BITS.left | GAMEPAD_BITS.right;

type BrowserGamepadLike = Pick<Gamepad, "axes" | "buttons" | "connected">;

export type OverlayGamepadPollState = {
  previousMask: number;
  repeatingBit: number;
  nextRepeatAt: number;
};

export const createOverlayGamepadPollState = (): OverlayGamepadPollState => ({
  previousMask: 0,
  repeatingBit: 0,
  nextRepeatAt: 0,
});

const isPressed = (gamepad: BrowserGamepadLike, index: number) =>
  Boolean(
    gamepad.buttons[index]?.pressed || gamepad.buttons[index]?.value > 0.5
  );

/**
 * Reads the browser Gamepad API's standard mapping. Chromium normalizes Xbox,
 * PlayStation, Nintendo and many generic pads to these indices, which makes it
 * a useful compatibility path alongside GameHub's native XInput watcher.
 */
export const getOverlayBrowserGamepadMask = (
  gamepads: ReadonlyArray<BrowserGamepadLike | null | undefined>
) => {
  let mask = 0;

  for (const gamepad of gamepads) {
    if (!gamepad?.connected) continue;

    if (isPressed(gamepad, 0)) mask |= GAMEPAD_BITS.accept;
    if (isPressed(gamepad, 1)) mask |= GAMEPAD_BITS.back;
    if (isPressed(gamepad, 4)) mask |= GAMEPAD_BITS.previousTab;
    if (isPressed(gamepad, 5)) mask |= GAMEPAD_BITS.nextTab;

    const horizontalAxis = Number(gamepad.axes[0] ?? 0);
    const verticalAxis = Number(gamepad.axes[1] ?? 0);
    if (isPressed(gamepad, 12) || verticalAxis < -GAMEPAD_AXIS_THRESHOLD) {
      mask |= GAMEPAD_BITS.up;
    }
    if (isPressed(gamepad, 13) || verticalAxis > GAMEPAD_AXIS_THRESHOLD) {
      mask |= GAMEPAD_BITS.down;
    }
    if (isPressed(gamepad, 14) || horizontalAxis < -GAMEPAD_AXIS_THRESHOLD) {
      mask |= GAMEPAD_BITS.left;
    }
    if (isPressed(gamepad, 15) || horizontalAxis > GAMEPAD_AXIS_THRESHOLD) {
      mask |= GAMEPAD_BITS.right;
    }
  }

  return mask;
};

/**
 * Converts one browser Gamepad API frame into a single predictable UI action.
 * Buttons fire only on their rising edge; directional input repeats after the
 * same deliberate delay used by the native overlay watcher.
 */
export const advanceOverlayGamepadPoll = (
  state: OverlayGamepadPollState,
  mask: number,
  now: number
): {
  action: HydraOverlayGamepadAction | null;
  state: OverlayGamepadPollState;
} => {
  const risingMask = mask & ~state.previousMask;
  const risingAction = GAMEPAD_ACTIONS.find(
    ([bit]) => (risingMask & bit) !== 0
  );

  if (risingAction) {
    const [bit, action] = risingAction;
    return {
      action,
      state: {
        previousMask: mask,
        repeatingBit: (bit & DIRECTION_MASK) !== 0 ? bit : 0,
        nextRepeatAt:
          (bit & DIRECTION_MASK) !== 0
            ? now + GAMEPAD_REPEAT_DELAY_MS
            : state.nextRepeatAt,
      },
    };
  }

  const heldDirection = GAMEPAD_ACTIONS.find(
    ([bit]) => (bit & DIRECTION_MASK) !== 0 && (mask & bit) !== 0
  );
  if (!heldDirection) {
    return {
      action: null,
      state: { previousMask: mask, repeatingBit: 0, nextRepeatAt: 0 },
    };
  }

  const [bit, action] = heldDirection;
  if (state.repeatingBit !== bit) {
    return {
      action: null,
      state: {
        previousMask: mask,
        repeatingBit: bit,
        nextRepeatAt: now + GAMEPAD_REPEAT_DELAY_MS,
      },
    };
  }

  if (now < state.nextRepeatAt) {
    return {
      action: null,
      state: { ...state, previousMask: mask },
    };
  }

  return {
    action,
    state: {
      previousMask: mask,
      repeatingBit: bit,
      nextRepeatAt: now + GAMEPAD_REPEAT_INTERVAL_MS,
    },
  };
};

/**
 * Picks the nearest element in the requested two-dimensional direction. The
 * perpendicular distance is weighted enough to prefer controls in the same
 * visual row/column without making a slightly offset nearby control unreachable.
 */
export const findOverlayDirectionalCandidate = <T>(
  origin: OverlayControllerRect,
  candidates: ReadonlyArray<OverlayControllerCandidate<T>>,
  direction: OverlayControllerDirection
): T | null => {
  const originX = origin.left + origin.width / 2;
  const originY = origin.top + origin.height / 2;

  const ranked = candidates
    .map(({ value, rect }) => {
      const dx = rect.left + rect.width / 2 - originX;
      const dy = rect.top + rect.height / 2 - originY;
      const inDirection =
        direction === "left"
          ? dx < -3
          : direction === "right"
            ? dx > 3
            : direction === "up"
              ? dy < -3
              : dy > 3;
      if (!inDirection) return null;

      const primary =
        direction === "left" || direction === "right"
          ? Math.abs(dx)
          : Math.abs(dy);
      const secondary =
        direction === "left" || direction === "right"
          ? Math.abs(dy)
          : Math.abs(dx);

      return {
        value,
        score: primary + secondary * 0.35 + (secondary / (primary + 1)) * 60,
      };
    })
    .filter(
      (candidate): candidate is { value: T; score: number } =>
        candidate !== null
    )
    .sort((left, right) => left.score - right.score);

  return ranked[0]?.value ?? null;
};

export type OverlayKeyboardEdit = { value: string; cursor: number };

export const insertOverlayKeyboardText = (
  value: string,
  cursor: number,
  insertedText: string
): OverlayKeyboardEdit => {
  const position = Math.min(value.length, Math.max(0, cursor));
  return {
    value: `${value.slice(0, position)}${insertedText}${value.slice(position)}`,
    cursor: position + insertedText.length,
  };
};

export const deleteOverlayKeyboardText = (
  value: string,
  cursor: number
): OverlayKeyboardEdit => {
  const position = Math.min(value.length, Math.max(0, cursor));
  if (position === 0) return { value, cursor: 0 };
  return {
    value: `${value.slice(0, position - 1)}${value.slice(position)}`,
    cursor: position - 1,
  };
};

export const moveOverlayKeyboardCursor = (
  value: string,
  cursor: number,
  offset: -1 | 1
) => Math.min(value.length, Math.max(0, cursor + offset));
