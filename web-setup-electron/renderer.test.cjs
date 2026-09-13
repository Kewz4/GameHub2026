const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const createRenderer = async () => {
  const dom = new JSDOM(
    fs.readFileSync(path.join(__dirname, "index.html"), "utf8"),
    { runScripts: "outside-only" }
  );
  const events = {};
  const launches = [];
  dom.window.setup = {
    platform: "linux",
    getRelease: async () => ({ tag: "v0.0.0-test" }),
    onDone: (callback) => {
      events.done = callback;
    },
    onProgress: (callback) => {
      events.progress = callback;
    },
    onStatus: (callback) => {
      events.status = callback;
    },
    onError: (callback) => {
      events.error = callback;
    },
    launch: (file) => launches.push(file),
  };
  await dom.window.eval(
    fs.readFileSync(path.join(__dirname, "renderer.js"), "utf8")
  );
  return { dom, events, launches, document: dom.window.document };
};

test("installer completion does not claim an applications-menu entry when a foreign entry was preserved", async () => {
  const { dom, events, launches, document } = await createRenderer();
  try {
    events.done({
      mode: "install",
      executable: "/tmp/GameHub.AppImage",
      desktopEntryCreated: false,
      warnings: ["The existing menu entry was preserved."],
    });
    assert.match(
      document.getElementById("done-message").textContent,
      /Use Launch GameHub/
    );
    assert.doesNotMatch(
      document.getElementById("done-message").textContent,
      /You can open it from your applications menu/
    );
    assert.equal(
      document.getElementById("btn-launch").style.display,
      "inline-block"
    );
    document.getElementById("btn-launch").click();
    assert.deepEqual(launches, ["/tmp/GameHub.AppImage"]);
  } finally {
    dom.window.close();
  }
});

test("portable launch uses the backend's exact verified executable path", async () => {
  const { dom, events, launches, document } = await createRenderer();
  try {
    events.done({
      mode: "portable",
      path: "/tmp/GameHub/",
      executable: "/tmp/GameHub/GameHub.AppImage",
    });
    document.getElementById("btn-launch").click();
    assert.deepEqual(launches, ["/tmp/GameHub/GameHub.AppImage"]);
    events.error(
      "GameHub exited before startup completed (code 1). Check FUSE support."
    );
    assert.equal(document.getElementById("screen-error").hidden, false);
    assert.match(document.getElementById("error-message").textContent, /FUSE/);
  } finally {
    dom.window.close();
  }
});
