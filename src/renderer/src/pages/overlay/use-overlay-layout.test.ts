import assert from "node:assert/strict";
import test from "node:test";

import {
  adjustOverlayWidgetForController,
  getOverlayDefaultWidgetBounds,
  recoverOverlayWidgetControls,
  type OverlayWidgetPosition,
} from "./use-overlay-layout";

const overlapArea = (
  left: { left: number; top: number; width: number; height: number },
  right: { left: number; top: number; width: number; height: number }
) =>
  Math.max(
    0,
    Math.min(left.left + left.width, right.left + right.width) -
      Math.max(left.left, right.left)
  ) *
  Math.max(
    0,
    Math.min(left.top + left.height, right.top + right.height) -
      Math.max(left.top, right.top)
  );

const base: OverlayWidgetPosition = {
  x: 0.5,
  y: 0.5,
  z: 1,
  width: 0.3,
  height: 0.3,
  visible: true,
};

test("controller movement nudges a widget without changing its size", () => {
  const moved = adjustOverlayWidgetForController(
    "capture",
    base,
    "move",
    "right",
    { width: 1_000, height: 800 }
  );
  assert.ok(moved.x > base.x);
  assert.equal(moved.y, base.y);
  assert.equal(moved.width, base.width);
  assert.equal(moved.height, base.height);
});

test("controller movement clamps widgets inside the workspace", () => {
  const atEdge = { ...base, x: 1, y: 1 };
  const moved = adjustOverlayWidgetForController(
    "capture",
    atEdge,
    "move",
    "right",
    { width: 1_000, height: 800 }
  );
  assert.equal(moved.x, 1);
  assert.equal(moved.y, 1);
});

test("controller resize preserves the visible top-left origin", () => {
  const workspace = { width: 1_000, height: 800 };
  const comfortablyAboveMinimum = { ...base, width: 0.5, height: 0.5 };
  const originalLeft =
    comfortablyAboveMinimum.x *
    (workspace.width - comfortablyAboveMinimum.width * workspace.width);
  const originalTop =
    comfortablyAboveMinimum.y *
    (workspace.height - comfortablyAboveMinimum.height * workspace.height);
  const resized = adjustOverlayWidgetForController(
    "capture",
    comfortablyAboveMinimum,
    "resize",
    "right",
    workspace
  );
  const resizedLeft =
    resized.x * (workspace.width - resized.width * workspace.width);
  const resizedTop =
    resized.y * (workspace.height - resized.height * workspace.height);
  assert.ok(resized.width > comfortablyAboveMinimum.width);
  assert.ok(Math.abs(resizedLeft - originalLeft) < 0.001);
  assert.ok(Math.abs(resizedTop - originalTop) < 0.001);
});

test("controller resize honors widget minimum dimensions", () => {
  let resized = { ...base, width: 0.01, height: 0.01 };
  for (let index = 0; index < 30; index += 1) {
    resized = adjustOverlayWidgetForController(
      "friends",
      resized,
      "resize",
      index % 2 === 0 ? "left" : "up",
      { width: 1_000, height: 800 }
    );
  }
  // Minimums scale down proportionally below the 1080x720 reference.
  assert.ok(resized.width * 1_000 >= 240);
  assert.ok(resized.height * 800 >= 194);
});

test("1080p corner placement keeps widget tools below floating header docks", () => {
  const recovered = recoverOverlayWidgetControls(
    { left: 0, top: 0, width: 360, height: 300 },
    { width: 1_920, height: 1_080 },
    [
      { left: 0, top: 0, right: 480, bottom: 72 },
      { left: 1_500, top: 0, right: 1_920, bottom: 72 },
    ]
  );
  assert.ok(recovered.top >= 80);
  assert.equal(recovered.left, 0);
});

test("compact right-corner placement remains recoverable", () => {
  const recovered = recoverOverlayWidgetControls(
    { left: 640, top: 0, width: 260, height: 210 },
    { width: 900, height: 640 },
    [
      { left: 0, top: 0, right: 350, bottom: 60 },
      { left: 520, top: 0, right: 900, bottom: 60 },
    ]
  );
  assert.ok(recovered.top >= 68);
  assert.equal(recovered.left, 640);
});

test("900x640 default layout keeps all eight widgets separated", () => {
  // The compact overlay grid has a 7px margin on each side at this viewport.
  const bounds = getOverlayDefaultWidgetBounds({ width: 886, height: 626 }, [
    { left: 0, top: 0, right: 350, bottom: 60 },
    { left: 520, top: 0, right: 886, bottom: 60 },
  ]);
  const entries = Object.entries(bounds);
  assert.equal(entries.length, 8);
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < entries.length;
      rightIndex += 1
    ) {
      const [leftId, left] = entries[leftIndex];
      const [rightId, right] = entries[rightIndex];
      assert.equal(
        overlapArea(left, right),
        0,
        `${leftId} overlaps ${rightId}: ${JSON.stringify({ left, right })}`
      );
    }
  }
  assert.ok(
    bounds.achievements.top >=
      bounds.performance.top + bounds.performance.height + 8
  );
});

test("4K top-center placement stays freeform when it misses both docks", () => {
  const original = { left: 1_500, top: 0, width: 600, height: 480 };
  const recovered = recoverOverlayWidgetControls(
    original,
    { width: 3_840, height: 2_160 },
    [
      { left: 0, top: 0, right: 800, bottom: 96 },
      { left: 3_000, top: 0, right: 3_840, bottom: 96 },
    ]
  );
  assert.deepEqual(recovered, original);
});

test("nearly full-screen widgets shrink only enough to expose their tools", () => {
  const recovered = recoverOverlayWidgetControls(
    { left: 0, top: 0, width: 1_920, height: 1_026 },
    { width: 1_920, height: 1_080 },
    [
      { left: 0, top: 0, right: 480, bottom: 72 },
      { left: 1_500, top: 0, right: 1_920, bottom: 72 },
    ]
  );
  assert.ok(recovered.top >= 80);
  assert.equal(recovered.height, 1_080 - recovered.top);
});
