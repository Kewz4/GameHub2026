import assert from "node:assert/strict";
import test from "node:test";

import { getOverlayContrastRatio, type OverlayRgba } from "./overlay-contrast";

const FAINT_ALPHA = 0.68;
const FAINT_TOOL_OPACITY = 0.92;
const DISABLED_OPACITY = 0.72;

const themes = [
  {
    name: "GameHub dark",
    foreground: [255, 255, 255],
    background: [18, 18, 18],
  },
  {
    name: "GameHub light",
    foreground: [17, 17, 19],
    background: [236, 236, 239],
  },
  {
    name: "custom monochrome",
    foreground: [250, 250, 250],
    background: [11, 7, 18],
  },
] as const;

const rgba = (
  channels: readonly [number, number, number],
  alpha: number
): OverlayRgba => ({
  red: channels[0],
  green: channels[1],
  blue: channels[2],
  alpha,
});

for (const theme of themes) {
  test(`${theme.name} muted tools and metadata meet 4.5:1`, () => {
    const ratio = getOverlayContrastRatio(
      rgba(theme.foreground, FAINT_ALPHA),
      rgba(theme.background, 1)
    );
    assert.ok(ratio >= 4.5, `computed ratio was ${ratio.toFixed(2)}:1`);
  });

  test(`${theme.name} subdued resize tools meet 4.5:1`, () => {
    const ratio = getOverlayContrastRatio(
      rgba(theme.foreground, FAINT_ALPHA * FAINT_TOOL_OPACITY),
      rgba(theme.background, 1)
    );
    assert.ok(ratio >= 4.5, `computed ratio was ${ratio.toFixed(2)}:1`);
  });

  test(`${theme.name} disabled tools meet 3:1`, () => {
    const ratio = getOverlayContrastRatio(
      rgba(theme.foreground, FAINT_ALPHA * DISABLED_OPACITY),
      rgba(theme.background, 1)
    );
    assert.ok(ratio >= 3, `computed ratio was ${ratio.toFixed(2)}:1`);
  });
}
