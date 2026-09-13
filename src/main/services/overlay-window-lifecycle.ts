export interface DestroyableOverlayWindow {
  isDestroyed: () => boolean;
  destroy: () => void;
}

/**
 * Drop the manager's reference before asking Electron to destroy the window.
 * BrowserWindow emits `closed` synchronously on some paths; clearing first
 * makes teardown idempotent and prevents that event from nulling a replacement
 * window created by a later game session.
 */
export const destroyOverlayWindow = <T extends DestroyableOverlayWindow>(
  window: T | null,
  clearReference: () => void
) => {
  clearReference();
  if (window && !window.isDestroyed()) window.destroy();
};
