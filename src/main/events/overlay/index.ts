import { app as electronApp, dialog, shell } from "electron";
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

const pinnedAppIconCache = new Map<string, Promise<string | null>>();

const getPinnedAppIcon = (appPath: string) => {
  const cached = pinnedAppIconCache.get(appPath);
  if (cached) return cached;

  const icon = electronApp
    .getFileIcon(appPath, { size: "large" })
    .then((image) => (image.isEmpty() ? null : image.toDataURL()))
    .catch(() => null);
  pinnedAppIconCache.set(appPath, icon);
  return icon;
};

const hydratePinnedApps = (apps: PinnedApp[]): Promise<PinnedApp[]> =>
  Promise.all(
    apps.map(async ({ name, path: appPath }) => ({
      name,
      path: appPath,
      iconUrl: await getPinnedAppIcon(appPath),
    }))
  );

const writePinnedApps = async (apps: PinnedApp[]) => {
  // Keep large data URLs out of preferences. Icons are resolved from Windows
  // when the quick-launch list is requested and cached for this app session.
  const storedApps = apps.map(({ name, path: appPath }) => ({
    name,
    path: appPath,
  }));
  const prefs = (await readPreferences()) ?? {};
  await db.put<string, UserPreferences>(
    levelKeys.userPreferences,
    { ...prefs, pinnedApps: storedApps },
    { valueEncoding: "json" }
  );
  return hydratePinnedApps(storedApps);
};

registerEvent("getOverlayContext", () => OverlayManager.getContext());
registerEvent("overlayRendererReady", () => OverlayManager.markRendererReady());
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
  async (): Promise<PinnedApp[]> =>
    hydratePinnedApps((await readPreferences())?.pinnedApps ?? [])
);

registerEvent("launchPinnedApp", (_event, appPath: string) =>
  shell.openPath(appPath)
);

registerEvent("removePinnedApp", async (_event, appPath: string) => {
  const apps = (await readPreferences())?.pinnedApps ?? [];
  pinnedAppIconCache.delete(appPath);
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
    return hydratePinnedApps((await readPreferences())?.pinnedApps ?? []);

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
