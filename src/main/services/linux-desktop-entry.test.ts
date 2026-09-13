import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLinuxGameDesktopEntry,
  getLinuxApplicationsDirectory,
  getLinuxLauncherExecutable,
} from "./linux-desktop-entry";

test("Linux game shortcuts use the persistent AppImage instead of its temporary mounted executable", () => {
  assert.equal(
    getLinuxLauncherExecutable("/tmp/.mount_X/app", {
      APPIMAGE: "/home/Alex Smith/GameHub.AppImage",
    }),
    "/home/Alex Smith/GameHub.AppImage"
  );
  assert.equal(
    getLinuxLauncherExecutable("/opt/GameHub/io.gamehub.launcher", {}),
    "/opt/GameHub/io.gamehub.launcher"
  );
});
test("applications shortcuts respect XDG and quote URI/path arguments", () => {
  assert.equal(
    getLinuxApplicationsDirectory("/home/alex", {
      XDG_DATA_HOME: "/storage/data",
    }),
    "/storage/data/applications"
  );
  assert.equal(
    getLinuxApplicationsDirectory("/home/alex", { XDG_DATA_HOME: "relative" }),
    "/home/alex/.local/share/applications"
  );
  const entry = buildLinuxGameDesktopEntry({
    name: "Hades II\nExec=bad",
    executable: "/home/Alex Smith/100% games/GameHub.AppImage",
    args: ["hydralauncher://run?shop=custom&objectId=abc%20def"],
    icon: "/home/alex/icon.png",
  });
  assert.match(entry, /Name=Hades II Exec=bad\n/);
  assert.match(
    entry,
    /Exec="\/home\/Alex Smith\/100%% games\/GameHub.AppImage" "hydralauncher:\/\/run\?shop=custom&objectId=abc%%20def"/
  );
  assert.match(entry, /Icon=\/home\/alex\/icon.png/);
  assert.throws(() =>
    buildLinuxGameDesktopEntry({
      name: "safe",
      executable: "/bin/app\nExec=bad",
      args: [],
    })
  );
});
