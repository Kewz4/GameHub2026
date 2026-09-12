/** Automatic exact-window capture requires a desktop that exposes window IDs.
 * Native Wayland needs a user-selected portal session, which is not yet hosted
 * by the background recorder. Do not start a portal prompt on an achievement. */
export const supportsDesktopGameCapture = (
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv = process.env
) =>
  platform === "win32" ||
  (platform === "linux" &&
    Boolean(environment.DISPLAY?.trim()) &&
    !environment.WAYLAND_DISPLAY &&
    environment.XDG_SESSION_TYPE !== "wayland");

export const desktopCaptureUnavailableMessage = (platform: NodeJS.Platform) =>
  platform === "linux"
    ? "Automatic gameplay capture requires an X11 desktop. Native Wayland capture needs a screen-sharing portal session and is not available yet."
    : "Gameplay capture is not available on this platform.";
