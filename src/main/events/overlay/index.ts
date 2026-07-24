import { dialog, shell } from "electron";
import path from "node:path";
import type { AudioSession, PinnedApp, UserPreferences } from "@types";
import { OverlayManager } from "@main/services/overlay-manager";
import { NativeAddon } from "@main/services/native-addon";
import { db, levelKeys, overlayNotesSublevel } from "@main/level";
import { registerEvent } from "../register-event";

const readPreferences = () =>
  db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

const writePinnedApps = async (apps: PinnedApp[]) => {
  const prefs = (await readPreferences()) ?? {};
  await db.put<string, UserPreferences>(
    levelKeys.userPreferences,
    { ...prefs, pinnedApps: apps },
    { valueEncoding: "json" }
  );
  return apps;
};

registerEvent("getOverlayContext", () => OverlayManager.getContext());
registerEvent("closeHydraOverlay", () => OverlayManager.hideOverlay());
registerEvent("setOverlayPerformancePinned", (_event, pinned: boolean) =>
  OverlayManager.setPerformancePinned(Boolean(pinned))
);
registerEvent("getOverlayNote", async () => {
  const game = OverlayManager.getActiveGame();
  if (!game) return "";
  return (
    (await overlayNotesSublevel
      .get(levelKeys.game(game.shop, game.objectId))
      .catch(() => "")) ?? ""
  );
});
registerEvent("saveOverlayNote", async (_event, note: string) => {
  const game = OverlayManager.getActiveGame();
  if (!game) return;
  await overlayNotesSublevel.put(
    levelKeys.game(game.shop, game.objectId),
    String(note).slice(0, 20_000)
  );
});

// ── Pinned-apps quick launcher ──────────────────────────────────────────────
registerEvent(
  "getPinnedApps",
  async (): Promise<PinnedApp[]> => (await readPreferences())?.pinnedApps ?? []
);

registerEvent("launchPinnedApp", (_event, appPath: string) =>
  shell.openPath(appPath)
);

registerEvent("removePinnedApp", async (_event, appPath: string) => {
  const apps = (await readPreferences())?.pinnedApps ?? [];
  return writePinnedApps(apps.filter((app) => app.path !== appPath));
});

registerEvent("pickPinnedApp", async (): Promise<PinnedApp[]> => {
  const result = await dialog.showOpenDialog({
    title: "Pin an app to the overlay",
    properties: ["openFile"],
    filters:
      process.platform === "win32"
        ? [{ name: "Applications", extensions: ["exe", "lnk", "bat", "cmd"] }]
        : [],
  });
  const picked = result.filePaths[0];
  if (result.canceled || !picked)
    return (await readPreferences())?.pinnedApps ?? [];

  const name = path.basename(picked).replace(/\.(exe|lnk|bat|cmd)$/i, "");
  const apps = (await readPreferences())?.pinnedApps ?? [];
  if (!apps.some((app) => app.path === picked)) {
    apps.push({ name: name || "App", path: picked });
  }
  return writePinnedApps(apps);
});

// ── Per-app volume mixer ─────────────────────────────────────────────────────
// Sessions are keyed by pid — the same key is used for volume/mute writes so
// the renderer never has to hold a native handle.
registerEvent(
  "getAudioSessions",
  async (): Promise<AudioSession[]> => NativeAddon.getAudioSessions()
);

registerEvent(
  "setAudioSessionVolume",
  (_event, pid: number, volume: number): boolean =>
    NativeAddon.setAudioSessionVolume(Number(pid), Number(volume))
);

registerEvent(
  "setAudioSessionMute",
  (_event, pid: number, muted: boolean): boolean =>
    NativeAddon.setAudioSessionMute(Number(pid), Boolean(muted))
);
