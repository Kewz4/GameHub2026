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
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
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
      return;
    }
    release = result;
    versionEl.textContent = "Latest release: " + release.tag;
  } catch {
    versionEl.textContent = "Could not reach GitHub";
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
  showScreen("select");
});

window.setup.onProgress((data) => {
  const fill = document.getElementById("progress-fill");
  const percentEl = document.getElementById("progress-percent");
  const sizeEl = document.getElementById("progress-size");

  if (data.total > 0) {
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
    doneTitle.textContent = "Installer Launched!";
    doneMessage.textContent =
      "The GameHub installer has been launched. Follow its steps to complete installation.";
    document.getElementById("btn-launch").style.display = "none";
  } else if (data.mode === "portable") {
    doneTitle.textContent = "Portable Setup Complete!";
    doneMessage.textContent = "GameHub is ready in: " + data.path;
    if (window.setup.platform === "win32") {
      launchPath = data.path + "\\GameHub.exe";
    } else {
      launchPath = data.path + "/GameHub.AppImage";
    }
    document.getElementById("btn-launch").style.display = "inline-block";
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
