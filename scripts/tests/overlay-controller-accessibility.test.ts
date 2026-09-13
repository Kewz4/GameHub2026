import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overlaySource = readFileSync(
  "src/renderer/src/pages/overlay/overlay.tsx",
  "utf8"
);
const overlayUnavailableSource = readFileSync(
  "src/renderer/src/pages/overlay/overlay-unavailable.ts",
  "utf8"
);
const widgetFrameSource = readFileSync(
  "src/renderer/src/pages/overlay/overlay-widget-frame.tsx",
  "utf8"
);
const controllerKeyboardSource = readFileSync(
  "src/renderer/src/pages/overlay/overlay-controller-keyboard.tsx",
  "utf8"
);
const overlaySelectSource = readFileSync(
  "src/renderer/src/pages/overlay/overlay-select.tsx",
  "utf8"
);
const overlayStyles = readFileSync(
  "src/renderer/src/pages/overlay/overlay.scss",
  "utf8"
);
const overlayHarness = readFileSync("scripts/shoot-overlay.mjs", "utf8");

test("overlay keeps native and Chromium gamepad input behind one action path", () => {
  assert.match(overlaySource, /navigator\.getGamepads\(\)/);
  assert.match(overlaySource, /onOverlayGamepadAction/);
  assert.match(overlaySource, /dispatchControllerAction\(action, "native"\)/);
  assert.match(
    overlaySource,
    /dispatchControllerAction\(frame\.action, "browser"\)/
  );
  assert.match(overlaySource, /arbitrateOverlayControllerAction/);
});

test("controller users can enter scroll regions and move or resize widgets", () => {
  assert.match(overlaySource, /data-controller-focus-region/g);
  assert.match(widgetFrameSource, /data-widget-controller-edit="move"/);
  assert.match(widgetFrameSource, /data-widget-controller-edit="resize"/);
  assert.match(widgetFrameSource, /aria-pressed=/);
  assert.match(widgetFrameSource, /type="button"/);
  assert.match(overlaySource, /moveControllerFocusSequentiallyInRegion/);
});

test("controller text entry has a scoped on-screen keyboard", () => {
  assert.match(overlaySource, /<OverlayControllerKeyboard/);
  assert.match(overlaySource, /isOverlayEditableElement\(active\)/);
  assert.match(controllerKeyboardSource, /aria-modal="true"/);
  assert.match(controllerKeyboardSource, /data-controller-scope="true"/);
  assert.match(controllerKeyboardSource, /Delete/);
  assert.match(controllerKeyboardSource, /Space/);
  assert.match(controllerKeyboardSource, /Done/);
  assert.match(controllerKeyboardSource, /Move text cursor left/);
  assert.match(controllerKeyboardSource, /Move text cursor right/);
  assert.match(controllerKeyboardSource, /insertOverlayKeyboardText/);
  assert.match(controllerKeyboardSource, /deleteOverlayKeyboardText/);
  assert.match(controllerKeyboardSource, /moveOverlayKeyboardCursor/);
  assert.match(controllerKeyboardSource, /overlay-controller-keyboard__caret/);
  assert.doesNotMatch(controllerKeyboardSource, /aria-live=/);
});

test("widget editing lives in one labelled, dismissible options scope", () => {
  assert.match(widgetFrameSource, /overlay-widget__options-trigger/);
  assert.match(widgetFrameSource, /aria-controls=\{menuId\}/);
  assert.match(widgetFrameSource, /data-controller-dismiss-on-back="true"/);
  assert.match(widgetFrameSource, /createPortal/);
  assert.match(widgetFrameSource, /closeOptions\(false\)/);
  assert.match(
    widgetFrameSource,
    /window\.removeEventListener\("blur", onBlur\)/
  );
  assert.doesNotMatch(widgetFrameSource, /className="overlay-widget__tool"/);
});

test("overlay replay progress animates without relayout", () => {
  assert.match(overlaySource, /transform: `scaleX\(/);
  assert.doesNotMatch(overlayStyles, /transition: width/);
  assert.match(overlayStyles, /transform-origin: left center/);
});

test("widget menu dismissal cannot queue a stale focus return", () => {
  const dismissal = overlaySource.slice(
    overlaySource.indexOf("const dismissibleScope"),
    overlaySource.indexOf("if (playlistMenuTrackId)")
  );
  assert.match(dismissal, /trigger\?\.focus\(/);
  assert.doesNotMatch(dismissal, /requestAnimationFrame/);
});

test("controller actions refuse a hidden, blurred, or detached overlay", () => {
  assert.match(overlaySource, /document\.visibilityState !== "visible"/);
  assert.match(overlaySource, /!document\.hasFocus\(\)/);
  assert.match(overlaySource, /!document\.querySelector\("\.overlay--full"\)/);
});

test("closing a game is a scoped, reversible two-step interaction", () => {
  assert.match(
    overlaySource,
    /id="overlay-close-game-trigger"[\s\S]*?onClick=\{requestCloseActiveGame\}/
  );
  assert.match(overlaySource, /role="alertdialog"/);
  assert.match(overlaySource, /aria-modal="true"/);
  assert.match(overlaySource, /id="overlay-close-game-cancel"/);
  assert.match(overlaySource, /data-controller-scope="true"/);
  assert.match(
    overlaySource,
    /if \(closeGameConfirmOpen\)[\s\S]*?setCloseGameConfirmOpen\(false\)/
  );
});

test("playlist deletion and layout reset are Cancel-first confirmations", () => {
  assert.match(overlaySource, /id="overlay-delete-playlist-dialog"/);
  assert.match(overlaySource, /id="overlay-delete-playlist-cancel"/);
  assert.match(
    overlaySource,
    /#overlay-delete-playlist-cancel[\s\S]*?focus\(\{ preventScroll: true \}\)/
  );
  assert.match(overlaySource, /id="overlay-reset-layout-dialog"/);
  assert.match(overlaySource, /id="overlay-reset-layout-cancel"/);
  assert.match(
    overlaySource,
    /#overlay-reset-layout-cancel[\s\S]*?focus\(\{ preventScroll: true \}\)/
  );
});

test("capture and mixer controls expose useful controller semantics", () => {
  assert.match(
    overlaySource,
    /className="overlay-capture__buffer"[\s\S]*?role="progressbar"[\s\S]*?aria-valuetext=/
  );
  assert.match(
    overlaySource,
    /aria-label=\{`Adjust \$\{session\.name\} volume, \$\{Math\.round\(session\.volume \* 100\)\} percent`\}/
  );
  assert.match(overlaySource, /overlay-controller-hints__tabs/);
});

test("Back dismisses nested menus before leaving their parent list", () => {
  assert.match(
    overlaySource,
    /if \(playlistMenuTrackId\)[\s\S]*?if \(controllerScrollEditRef\.current\)/
  );
  assert.match(
    overlaySource,
    /if \(controllerScrollEditRef\.current\)[\s\S]*?if \(expandedMixerPid !== null\)/
  );
  assert.match(
    overlaySource,
    /moveControllerFocus\([\s\S]*?isInsideEngagedRegion \? engagedRegion! : undefined/
  );
});

test("overlay listbox Tab closes and performs an explicit focus handoff", () => {
  assert.match(overlaySelectSource, /const handoffTab = useCallback/);
  assert.match(overlaySelectSource, /event\.preventDefault\(\)/);
  assert.match(overlaySelectSource, /event\.stopPropagation\(\)/);
  assert.match(overlaySelectSource, /handoffTab\(event\.shiftKey\)/);
});

test("GameHub overlay chrome uses monochrome highlight tokens", () => {
  assert.match(overlayStyles, /--overlay-highlight:/);
  assert.doesNotMatch(overlayStyles, /#aab2ff/i);
  assert.doesNotMatch(overlayStyles, /--teal\b/i);
  assert.match(
    overlayStyles,
    /\.overlay-music__play[\s\S]*?color: var\(--color-dark-background\)/
  );
  assert.match(
    overlayStyles,
    /--color-text-muted: rgba\(var\(--fg-rgb\), 0\.78\)/
  );
  assert.match(
    overlayStyles,
    /--color-text-faint: rgba\(var\(--fg-rgb\), 0\.68\)/
  );
  assert.match(overlayStyles, /--overlay-disabled-opacity: 0\.72/);
  assert.match(
    overlayStyles,
    /\.overlay-widget__resize\s*\{[^}]*opacity: 0\.92/
  );
  assert.match(overlayHarness, /assertOverlayThemeContrast/);
});

test("unsupported window modes render a branded noninteractive toast", () => {
  assert.match(
    overlayUnavailableSource,
    /params\.get\("kind"\) !== "overlay-unavailable"/
  );
  assert.match(overlaySource, /Overlay requires Borderless or Windowed/);
  for (const reason of [
    "exclusive-fullscreen",
    "window-compositor-unavailable",
    "focus-refused",
  ]) {
    assert.match(
      overlayUnavailableSource,
      new RegExp(`(?:"${reason}"|${reason}:)`)
    );
  }
  assert.match(overlayStyles, /\.overlay-toast[\s\S]*?&--error/);
  assert.match(overlayHarness, /reason=exclusive-fullscreen/);
});
