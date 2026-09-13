import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceOverlayGamepadPoll,
  arbitrateOverlayControllerAction,
  createOverlayGamepadPollState,
  deleteOverlayKeyboardText,
  findOverlayDirectionalCandidate,
  getOverlayBrowserGamepadMask,
  getOverlaySequentialNavigationOffset,
  insertOverlayKeyboardText,
  moveOverlayKeyboardCursor,
  type OverlayControllerRect,
} from "./overlay-controller";

const gamepad = ({
  axes = [0, 0],
  pressed = [],
}: {
  axes?: number[];
  pressed?: number[];
}) => ({
  axes,
  connected: true,
  buttons: Array.from({ length: 17 }, (_, index) => ({
    pressed: pressed.includes(index),
    touched: pressed.includes(index),
    value: pressed.includes(index) ? 1 : 0,
  })),
});

test("browser gamepad mapping supports buttons, D-pad and analog stick", () => {
  const buttonMask = getOverlayBrowserGamepadMask([
    gamepad({ pressed: [0, 4, 15] }),
  ]);
  let state = createOverlayGamepadPollState();
  let frame = advanceOverlayGamepadPoll(state, buttonMask, 100);
  assert.equal(frame.action, "accept");

  state = createOverlayGamepadPollState();
  const axisMask = getOverlayBrowserGamepadMask([gamepad({ axes: [-0.8, 0] })]);
  frame = advanceOverlayGamepadPoll(state, axisMask, 100);
  assert.equal(frame.action, "left");
});

test("held directions repeat only after the accessibility-friendly delay", () => {
  const mask = getOverlayBrowserGamepadMask([gamepad({ pressed: [13] })]);
  let frame = advanceOverlayGamepadPoll(
    createOverlayGamepadPollState(),
    mask,
    1_000
  );
  assert.equal(frame.action, "down");

  frame = advanceOverlayGamepadPoll(frame.state, mask, 1_200);
  assert.equal(frame.action, null);
  frame = advanceOverlayGamepadPoll(frame.state, mask, 1_360);
  assert.equal(frame.action, "down");
  frame = advanceOverlayGamepadPoll(frame.state, mask, 1_465);
  assert.equal(frame.action, "down");

  frame = advanceOverlayGamepadPoll(frame.state, 0, 1_470);
  assert.equal(frame.action, null);
  assert.equal(frame.state.repeatingBit, 0);
});

test("shoulder buttons remain accelerators and do not repeat", () => {
  const mask = getOverlayBrowserGamepadMask([gamepad({ pressed: [5] })]);
  let frame = advanceOverlayGamepadPoll(
    createOverlayGamepadPollState(),
    mask,
    5_000
  );
  assert.equal(frame.action, "next-tab");
  frame = advanceOverlayGamepadPoll(frame.state, mask, 8_000);
  assert.equal(frame.action, null);
});

test("source arbitration drops only the matching simultaneous duplicate", () => {
  const native = arbitrateOverlayControllerAction(
    null,
    "accept",
    "native",
    1_000
  );
  assert.equal(native.accepted, true);
  const duplicate = arbitrateOverlayControllerAction(
    native.state,
    "accept",
    "browser",
    1_025
  );
  assert.equal(duplicate.accepted, false);

  const differentEdge = arbitrateOverlayControllerAction(
    duplicate.state,
    "right",
    "browser",
    1_030
  );
  assert.equal(differentEdge.accepted, true);
});

test("source arbitration accepts rapid failover and same-source repeat", () => {
  const native = arbitrateOverlayControllerAction(
    null,
    "down",
    "native",
    2_000
  );
  const fallback = arbitrateOverlayControllerAction(
    native.state,
    "down",
    "browser",
    2_081
  );
  assert.equal(fallback.accepted, true);
  const repeat = arbitrateOverlayControllerAction(
    fallback.state,
    "down",
    "browser",
    2_105
  );
  assert.equal(repeat.accepted, true);
});

test("spatial navigation follows the visual row before a diagonal shortcut", () => {
  const origin: OverlayControllerRect = {
    left: 100,
    top: 100,
    right: 140,
    bottom: 140,
    width: 40,
    height: 40,
  };
  const target = findOverlayDirectionalCandidate(
    origin,
    [
      {
        value: "same-row",
        rect: {
          left: 170,
          top: 104,
          right: 210,
          bottom: 144,
          width: 40,
          height: 40,
        },
      },
      {
        value: "diagonal",
        rect: {
          left: 150,
          top: 190,
          right: 190,
          bottom: 230,
          width: 40,
          height: 40,
        },
      },
    ],
    "right"
  );
  assert.equal(target, "same-row");
});

test("spatial navigation returns null when no target is in the direction", () => {
  const origin: OverlayControllerRect = {
    left: 100,
    top: 100,
    right: 140,
    bottom: 140,
    width: 40,
    height: 40,
  };
  assert.equal(
    findOverlayDirectionalCandidate(
      origin,
      [
        {
          value: "left",
          rect: {
            left: 10,
            top: 100,
            right: 50,
            bottom: 140,
            width: 40,
            height: 40,
          },
        },
      ],
      "right"
    ),
    null
  );
});

test("overflow fallback stays on the list's vertical axis", () => {
  assert.equal(getOverlaySequentialNavigationOffset("up"), -1);
  assert.equal(getOverlaySequentialNavigationOffset("down"), 1);
  assert.equal(getOverlaySequentialNavigationOffset("left"), null);
  assert.equal(getOverlaySequentialNavigationOffset("right"), null);
});

test("controller keyboard inserts and deletes at the edit cursor", () => {
  assert.deepEqual(insertOverlayKeyboardText("GameHub", 4, " "), {
    value: "Game Hub",
    cursor: 5,
  });
  assert.deepEqual(deleteOverlayKeyboardText("Game Hub", 5), {
    value: "GameHub",
    cursor: 4,
  });
  assert.deepEqual(deleteOverlayKeyboardText("GameHub", 0), {
    value: "GameHub",
    cursor: 0,
  });
});

test("controller keyboard cursor movement clamps to text boundaries", () => {
  assert.equal(moveOverlayKeyboardCursor("GameHub", 0, -1), 0);
  assert.equal(moveOverlayKeyboardCursor("GameHub", 7, 1), 7);
  assert.equal(moveOverlayKeyboardCursor("GameHub", 4, -1), 3);
  assert.equal(moveOverlayKeyboardCursor("GameHub", 4, 1), 5);
});
