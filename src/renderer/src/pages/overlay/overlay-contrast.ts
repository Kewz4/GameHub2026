export type OverlayRgba = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

const clampChannel = (value: number) => Math.min(255, Math.max(0, value));
const clampAlpha = (value: number) => Math.min(1, Math.max(0, value));

export const compositeOverlayColor = (
  foreground: OverlayRgba,
  background: OverlayRgba
): OverlayRgba => {
  const foregroundAlpha = clampAlpha(foreground.alpha);
  const backgroundAlpha = clampAlpha(background.alpha);
  const outputAlpha = foregroundAlpha + backgroundAlpha * (1 - foregroundAlpha);
  if (outputAlpha === 0) {
    return { red: 0, green: 0, blue: 0, alpha: 0 };
  }

  const channel = (foregroundValue: number, backgroundValue: number) =>
    (clampChannel(foregroundValue) * foregroundAlpha +
      clampChannel(backgroundValue) * backgroundAlpha * (1 - foregroundAlpha)) /
    outputAlpha;

  return {
    red: channel(foreground.red, background.red),
    green: channel(foreground.green, background.green),
    blue: channel(foreground.blue, background.blue),
    alpha: outputAlpha,
  };
};

const linearChannel = (value: number) => {
  const srgb = clampChannel(value) / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
};

export const getOverlayRelativeLuminance = (color: OverlayRgba) =>
  0.2126 * linearChannel(color.red) +
  0.7152 * linearChannel(color.green) +
  0.0722 * linearChannel(color.blue);

export const getOverlayContrastRatio = (
  foreground: OverlayRgba,
  background: OverlayRgba
) => {
  const opaqueBackground = compositeOverlayColor(background, {
    red: 0,
    green: 0,
    blue: 0,
    alpha: 1,
  });
  const opaqueForeground = compositeOverlayColor(foreground, opaqueBackground);
  const foregroundLuminance = getOverlayRelativeLuminance(opaqueForeground);
  const backgroundLuminance = getOverlayRelativeLuminance(opaqueBackground);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};
