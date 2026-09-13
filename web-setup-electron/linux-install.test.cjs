const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const {
  getLinuxInstallPaths,
  resolveLinuxPackageManager,
  getLinuxPackageCommand,
  createLinuxDesktopEntry,
  installLinuxAppImage,
  findLinuxAsset,
  launchLinuxAppImage,
} = require("./linux-install.js");

test("Linux installer never treats an x64-only release as ARM64", () => {
  const assets = [
    { name: "GameHub-WebSetup.AppImage" },
    { name: "hydralauncher-1.1.49.AppImage" },
    { name: "hydralauncher_1.1.49_amd64.deb" },
  ];
  assert.equal(findLinuxAsset(assets, "appimage", "x64"), assets[1]);
  assert.equal(findLinuxAsset(assets, "appimage", "arm64"), null);
  assert.equal(findLinuxAsset(assets, "deb", "arm64"), null);
});

test("AppImage setup preserves foreign menu entries, icons, and command files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gamehub-linux-owned-"));
  try {
    const env = { XDG_DATA_HOME: path.join(root, "xdg") };
    const locations = getLinuxInstallPaths(root, env);
    await fs.mkdir(locations.applications, { recursive: true });
    await fs.mkdir(path.dirname(locations.icon), { recursive: true });
    await fs.mkdir(path.dirname(locations.command), { recursive: true });
    const desktop = path.join(
      locations.applications,
      "io.gamehub.launcher.desktop"
    );
    await fs.writeFile(
      desktop,
      "[Desktop Entry]\nName=User's custom launcher\nExec=/custom\n"
    );
    await fs.writeFile(locations.icon, "user icon");
    await fs.writeFile(locations.command, "user command");
    const result = await installLinuxAppImage({
      directory: locations.directory,
      home: root,
      env,
      download: (file) => fs.writeFile(file, "verified app fixture"),
    });
    assert.equal(result.desktopEntryCreated, false);
    assert.equal(result.desktopFile, null);
    assert.match(await fs.readFile(desktop, "utf8"), /User's custom launcher/);
    assert.equal(await fs.readFile(locations.icon, "utf8"), "user icon");
    assert.equal(await fs.readFile(locations.command, "utf8"), "user command");
    assert.match(
      result.warnings.join(" "),
      /no GameHub menu entry was created/
    );
    assert.doesNotMatch(result.warnings.join(" "), /Use the applications menu/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("managed AppImage entries update atomically using a private icon without replacing theme icons", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "gamehub-linux-managed-")
  );
  try {
    const env = { XDG_DATA_HOME: path.join(root, "xdg") };
    const locations = getLinuxInstallPaths(root, env);
    await fs.mkdir(locations.applications, { recursive: true });
    await fs.mkdir(path.dirname(locations.icon), { recursive: true });
    const desktop = path.join(
      locations.applications,
      "io.gamehub.launcher.desktop"
    );
    await fs.writeFile(
      desktop,
      "[Desktop Entry]\nName=Old GameHub\nX-GameHub-Managed=true\n"
    );
    await fs.writeFile(locations.icon, "user-customized theme icon");
    const iconSource = path.join(root, "source.png");
    await fs.writeFile(iconSource, "new bundled icon");
    const options = {
      directory: locations.directory,
      home: root,
      env,
      iconSource,
      download: (file) => fs.writeFile(file, "verified app fixture"),
    };
    const result = await installLinuxAppImage(options);
    assert.equal(result.desktopEntryCreated, true);
    assert.equal(result.desktopFile, desktop);
    const entry = await fs.readFile(desktop, "utf8");
    assert.match(entry, /Name=GameHub\n/);
    assert.match(entry, /gamehub-icon-[a-f0-9]{64}\.png/);
    assert.equal(
      await fs.readFile(locations.icon, "utf8"),
      "user-customized theme icon"
    );
    const icons = (await fs.readdir(locations.directory)).filter((file) =>
      file.startsWith("gamehub-icon-")
    );
    assert.equal(icons.length, 1);
    await installLinuxAppImage(options);
    assert.equal(
      (await fs.readdir(locations.directory)).filter((file) =>
        file.startsWith("gamehub-icon-")
      ).length,
      1
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function mockAppImageProcess() {
  const child = new EventEmitter();
  child.unrefCount = 0;
  child.unref = () => {
    child.unrefCount += 1;
  };
  return child;
}

test("AppImage launch does not succeed just because spawn fired; early FUSE-like exit is reported", async () => {
  const child = mockAppImageProcess();
  let handedOff = false;
  const launched = launchLinuxAppImage("/tmp/GameHub.AppImage", {
    spawnProcess: (file, args, options) => {
      assert.equal(file, "/tmp/GameHub.AppImage");
      assert.deepEqual(args, []);
      assert.deepEqual(options, { detached: true, stdio: "ignore" });
      return child;
    },
    startupGraceMs: 1000,
  });
  launched.then(
    () => {
      handedOff = true;
    },
    () => undefined
  );
  child.emit("spawn");
  await Promise.resolve();
  assert.equal(handedOff, false);
  child.emit("exit", 1, null);
  await assert.rejects(launched, /code 1.*installation is intact.*FUSE/);
  assert.equal(child.unrefCount, 0);
});

test("AppImage handoff succeeds after startup grace or a clean existing-instance handoff", async () => {
  const child = mockAppImageProcess();
  const launched = launchLinuxAppImage("/tmp/GameHub.AppImage", {
    spawnProcess: () => child,
    startupGraceMs: 1,
  });
  child.emit("spawn");
  assert.equal(await launched, child);
  assert.equal(child.unrefCount, 1);
  assert.equal(child.listenerCount("exit"), 0);
  const existing = mockAppImageProcess();
  const activated = launchLinuxAppImage("/tmp/GameHub.AppImage", {
    spawnProcess: () => existing,
    startupGraceMs: 1000,
  });
  existing.emit("spawn");
  existing.emit("exit", 0, null);
  assert.equal(await activated, existing);
});

test("AppImage spawn errors leave setup with an actionable error", async () => {
  const child = mockAppImageProcess();
  const launched = launchLinuxAppImage("/tmp/GameHub.AppImage", {
    spawnProcess: () => child,
  });
  child.emit(
    "error",
    Object.assign(new Error("permission denied"), { code: "EACCES" })
  );
  await assert.rejects(launched, /EACCES.*installation is intact.*permissions/);
  assert.equal(child.unrefCount, 0);
});

test("Linux setup follows absolute XDG paths and ignores relative overrides", () => {
  assert.equal(
    getLinuxInstallPaths("/home/alex", { XDG_DATA_HOME: "/data/apps" })
      .directory,
    "/data/apps/GameHub"
  );
  assert.equal(
    getLinuxInstallPaths("/home/alex", { XDG_DATA_HOME: "relative" }).directory,
    path.posix.join("/home/alex", ".local", "share", "GameHub")
  );
});
test("immutable gaming distros use user installation even when dnf exists", () => {
  const exists = (file) => file === "/usr/bin/dnf";
  assert.equal(
    resolveLinuxPackageManager({
      exists,
      release: 'ID=bazzite\nID_LIKE="fedora"',
    }),
    "appimage"
  );
  assert.equal(
    resolveLinuxPackageManager({ exists, release: "ID=fedora" }),
    "dnf"
  );
});
test("graphical package installation uses structured pkexec argv, never sudo shell strings", () => {
  const file = "/tmp/user name/$(touch nope).deb";
  assert.deepEqual(
    getLinuxPackageCommand("apt", file, () => true),
    {
      command: "/usr/bin/pkexec",
      args: ["/usr/bin/apt-get", "install", "-y", "--", file],
    }
  );
  assert.equal(
    getLinuxPackageCommand("apt", file, () => false),
    null
  );
  assert.throws(() => getLinuxPackageCommand("apt", "-oBad", () => true));
});
test("desktop entries preserve spaces and literal field-code characters", () => {
  const result = createLinuxDesktopEntry(
    "/home/Alex Smith/100% Games/GameHub.AppImage",
    "/home/Alex/icon.png"
  );
  assert.match(
    result,
    /Exec="\/home\/Alex Smith\/100%% Games\/GameHub.AppImage" %U/
  );
  assert.match(result, /--big-picture/);
  assert.throws(() => createLinuxDesktopEntry("/tmp/app\nExec=bad", "/icon"));
});
test("failed AppImage updates preserve the installed executable", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "gamehub-linux-install-")
  );
  try {
    const executable = path.join(directory, "GameHub.AppImage");
    await fs.writeFile(executable, "previous verified binary");
    await assert.rejects(
      installLinuxAppImage({
        directory,
        download: async (temporary) => {
          await fs.writeFile(temporary, "incomplete");
          throw new Error("checksum mismatch");
        },
      }),
      /checksum/
    );
    assert.equal(
      await fs.readFile(executable, "utf8"),
      "previous verified binary"
    );
    assert.deepEqual(await fs.readdir(directory), ["GameHub.AppImage"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("portable installation refuses nonempty destinations and creates the profile marker", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "gamehub-linux-portable-")
  );
  try {
    await fs.writeFile(path.join(root, "save"), "keep");
    await assert.rejects(
      installLinuxAppImage({
        directory: root,
        portable: true,
        download: async () => assert.fail("must not download"),
      }),
      /empty/
    );
    const destination = path.join(root, "new");
    await installLinuxAppImage({
      directory: destination,
      portable: true,
      download: (temporary) => fs.writeFile(temporary, "verified AppImage"),
    });
    assert.equal(
      await fs.readFile(path.join(destination, "portable"), "utf8"),
      ""
    );
    assert.equal(await fs.readFile(path.join(root, "save"), "utf8"), "keep");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
