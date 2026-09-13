let release = null;
let portableTargetDir = null;
let launchPath = null;

const screens = {
  select: document.getElementById("screen-select"),
  progress: document.getElementById("screen-progress"),
  done: document.getElementById("screen-done"),
  error: document.getElementById("screen-error"),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => {
    s.classList.remove("active");
    s.hidden = true;
  });
  screens[name].hidden = false;
  screens[name].classList.add("active");
  screens[name].querySelector("h1")?.focus();
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

async function init() {
  const versionEl = document.getElementById("version");
  try {
    const result = await window.setup.getRelease();
    if (result.error) {
      versionEl.textContent = "Could not reach GitHub";
      release = null;
      showError(
        "The latest release could not be loaded. Check your connection and try again."
      );
      return;
    }
    release = result;
    versionEl.textContent = "Latest release: " + release.tag;
    document.getElementById("mode-install").disabled = false;
    document.getElementById("mode-portable").disabled = false;
  } catch {
    versionEl.textContent = "Could not reach GitHub";
    showError(
      "The latest release could not be loaded. Check your connection and try again."
    );
  }
}

document.getElementById("mode-install").addEventListener("click", () => {
  if (!release) {
    showError("No release available. Check your internet connection.");
    return;
  }
  showScreen("progress");
  window.setup.install(release);
});

document.getElementById("mode-portable").addEventListener("click", async () => {
  if (!release) {
    showError("No release available. Check your internet connection.");
    return;
  }
  const folder = await window.setup.selectFolder();
  if (!folder) return;
  portableTargetDir = folder;
  showScreen("progress");
  window.setup.portable(release, folder);
});

document.getElementById("btn-launch").addEventListener("click", () => {
  window.setup.launch(launchPath);
});

document.getElementById("btn-close").addEventListener("click", () => {
  window.setup.quit();
});

document.getElementById("btn-retry").addEventListener("click", () => {
  document.getElementById("progress-fill").style.width = "0%";
  document.getElementById("progress-percent").textContent = "0%";
  document.getElementById("progress-size").textContent = "";
  showScreen("select");
  if (!release) void init();
});

window.setup.onProgress((data) => {
  const fill = document.getElementById("progress-fill");
  const percentEl = document.getElementById("progress-percent");
  const sizeEl = document.getElementById("progress-size");

  if (data.total > 0) {
    document
      .getElementById("download-progress")
      .setAttribute("aria-valuenow", String(Math.round(data.percent)));
    fill.style.width = data.percent + "%";
    percentEl.textContent = Math.round(data.percent) + "%";
    sizeEl.textContent =
      formatBytes(data.downloaded) + " / " + formatBytes(data.total);
  } else {
    fill.style.width = "100%";
    percentEl.textContent = "";
    sizeEl.textContent = formatBytes(data.downloaded);
  }
});

window.setup.onStatus((text) => {
  document.getElementById("status-text").textContent = text;
});

window.setup.onDone((data) => {
  const doneTitle = document.getElementById("done-title");
  const doneMessage = document.getElementById("done-message");

  if (data.mode === "install") {
    doneTitle.textContent = data.handedOff
      ? "Continue in the installer."
      : "GameHub is installed.";
    doneMessage.textContent = data.handedOff
      ? "Your download is ready. Follow the GameHub installer's steps to finish setup."
      : data.desktopEntryCreated === false
        ? "GameHub is ready. Use Launch GameHub below or open the installed AppImage."
        : "GameHub is ready. You can open it from your applications menu.";
    document.getElementById("btn-launch").style.display = "none";
    if (data.executable && !data.handedOff) {
      launchPath = data.executable;
      document.getElementById("btn-launch").style.display = "inline-block";
    }
  } else if (data.mode === "portable") {
    doneTitle.textContent = "Ready to play.";
    doneMessage.textContent = "GameHub is ready in: " + data.path;
    if (data.executable) {
      launchPath = data.executable;
    } else if (window.setup.platform === "win32") {
      launchPath = data.path + "\\GameHub.exe";
    } else {
      launchPath = data.path + "/GameHub.AppImage";
    }
    document.getElementById("btn-launch").style.display = "inline-block";
  }

  if (Array.isArray(data.warnings) && data.warnings.length) {
    doneMessage.textContent += " " + data.warnings.join(" ");
  }

  showScreen("done");
});

window.setup.onError((message) => {
  showError(message);
});

function showError(message) {
  document.getElementById("error-message").textContent = message;
  showScreen("error");
}

init();
