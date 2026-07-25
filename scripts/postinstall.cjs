const { default: axios } = require("axios");
const tar = require("tar");
const util = require("node:util");
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { downloadYtDlp } = require("./download-yt-dlp.cjs");
const { downloadFfmpeg } = require("./download-ffmpeg.cjs");

const execFileAsync = util.promisify(execFile);

const ludusaviVersion = "0.29.0";
const presentMonVersion = "2.5.1";
const presentMonSha256 =
  "9bec3083069f58f911e6a512f4806db51a27bd096103087bc1d05ef54c80a191";

const fileName = {
  win32: `ludusavi-v${ludusaviVersion}-win64.zip`,
  linux: `ludusavi-v${ludusaviVersion}-linux.tar.gz`,
  darwin: `ludusavi-v${ludusaviVersion}-mac.tar.gz`,
};

const ludusaviBinaryName = {
  win32: "ludusavi.exe",
  linux: "ludusavi",
  darwin: "ludusavi",
};

const downloadLudusavi = async () => {
  if (
    fs.existsSync(
      path.join(process.cwd(), "ludusavi", ludusaviBinaryName[process.platform])
    )
  ) {
    console.log("Ludusavi already exists, skipping download...");
    return;
  }

  const file = fileName[process.platform];
  const downloadUrl = `https://github.com/mtkennerly/ludusavi/releases/download/v${ludusaviVersion}/${file}`;

  console.log(`Downloading ${file}...`);

  const response = await axios.get(downloadUrl, { responseType: "stream" });
  const archivePath = path.join(process.cwd(), file);
  await pipeline(response.data, fs.createWriteStream(archivePath));
  try {
    console.log(`Downloaded ${file}, extracting...`);

    const targetPath = path.join(process.cwd(), "ludusavi");

    await fs.promises.mkdir(targetPath, { recursive: true });

    if (process.platform === "win32") {
      const sevenZip = path.join(process.cwd(), "binaries", "7z.exe");
      await execFileAsync(
        sevenZip,
        ["x", "-y", `-o${targetPath}`, archivePath],
        { windowsHide: true }
      );
    } else {
      await tar.x({
        file: archivePath,
        cwd: targetPath,
      });
    }

    if (process.platform !== "win32") {
      fs.chmodSync(path.join(targetPath, "ludusavi"), 0o755);
    }

    console.log(`Extracted ${file}.`);
  } finally {
    await fs.promises.rm(archivePath, { force: true });
  }
};

// PresentMon backs the in-game overlay's FPS/frame-time HUD (Windows only).
const downloadPresentMon = async () => {
  if (process.platform !== "win32") return;

  const targetDirectory = path.join(process.cwd(), "presentmon");
  const targetPath = path.join(targetDirectory, "PresentMon.exe");
  if (fs.existsSync(targetPath)) {
    const existing = await fs.promises.readFile(targetPath);
    const digest = crypto.createHash("sha256").update(existing).digest("hex");
    if (digest === presentMonSha256) {
      console.log(
        `PresentMon ${presentMonVersion} already verified at ${targetPath}`
      );
      return;
    }
  }

  const file = `PresentMon-${presentMonVersion}-x64.exe`;
  const downloadUrl = `https://github.com/GameTechDev/PresentMon/releases/download/v${presentMonVersion}/${file}`;
  console.log(`Downloading ${file}...`);
  const response = await axios.get(downloadUrl, {
    responseType: "arraybuffer",
  });
  const binary = Buffer.from(response.data);
  const digest = crypto.createHash("sha256").update(binary).digest("hex");
  if (digest !== presentMonSha256) {
    throw new Error(
      `PresentMon checksum mismatch: expected ${presentMonSha256}, received ${digest}`
    );
  }
  await fs.promises.mkdir(targetDirectory, { recursive: true });
  await fs.promises.writeFile(targetPath, binary);
  console.log(`PresentMon verified and ready at ${targetPath}`);
};

Promise.all([
  downloadLudusavi(),
  downloadPresentMon(),
  downloadYtDlp(),
  downloadFfmpeg(),
]).catch((error) => {
  console.error("Failed to download a development dependency", error);
  process.exitCode = 1;
});
