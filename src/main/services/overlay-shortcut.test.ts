import { test } from "node:test";
import assert from "node:assert/strict";
import { isOverlayShortcutInput } from "./overlay-shortcut";
test("Shift+F3 accepts either Electron key representation once per press", () => {
  assert.equal(
    isOverlayShortcutInput({ type: "keyDown", key: "F3", shift: true }),
    true
  );
  assert.equal(
    isOverlayShortcutInput({ type: "keyDown", code: "F3", shift: true }),
    true
  );
  for (const input of [
    { type: "keyUp" },
    { isAutoRepeat: true },
    { shift: false },
    { alt: true },
    { meta: true },
  ]) {
    assert.equal(
      isOverlayShortcutInput({
        type: "keyDown",
        key: "F3",
        shift: true,
        ...input,
      }),
      false
    );
  }
});
