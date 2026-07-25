const axios = require("axios");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");

// Pinned LGPL build used only to join the recorder's independently encoded
// WebM segments. The capture/encoding path itself is Chromium's Windows
// Graphics Capture + MediaRecorder implementation.
const FFMPEG_BUILD = "n8.1.2-21-gce3c09c101";
const FFMPEG_ASSET = "ffmpeg-n8.1.2-21-gce3c09c101-win64-lgpl-8.1.zip";
const FFMPEG_ARCHIVE_SHA256 =
  "3b9eceb438016b647e0755a51ce3a388cd4ed5679e2427cb83a01e1ae2cd0eba";
const FFMPEG_LICENSE_SHA256 =
  "da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768";
const GPL_LICENSE_SHA256 =
  "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903";
const FFMPEG_URL =
  `https://github.com/BtbN/FFmpeg-Builds/releases/download/` +
  `autobuild-2026-06-30-13-34/${FFMPEG_ASSET}`;
const GPL_LICENSE_URL =
  "https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.1.2/COPYING.GPLv3";

const digestFile = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.once("error", reject);
    input.once("end", () => resolve(hash.digest("hex")));
  });

const findFile = (directory, fileName) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(entryPath, fileName);
      if (nested) return nested;
    } else if (entry.name.toLowerCase() === fileName.toLowerCase()) {
      return entryPath;
    }
  }
  return null;
};

const downloadToFile = async (url, targetPath) => {
  const maximumAttempts = 4;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const response = await axios.get(url, {
        responseType: "stream",
        timeout: 180_000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        headers: { "User-Agent": "GameHub-build/1.1.20" },
      });
      await pipeline(response.data, fs.createWriteStream(targetPath));
      return;
    } catch (error) {
      await fs.promises.rm(targetPath, { force: true });
      const status = error?.response?.status;
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable || attempt === maximumAttempts) throw error;

      const retryAfterSeconds = Number(
        error?.response?.headers?.["retry-after"]
      );
      const delay = Number.isFinite(retryAfterSeconds)
        ? Math.min(retryAfterSeconds * 1_000, 30_000)
        : 1_000 * 2 ** (attempt - 1);
      console.warn(
        `Download attempt ${attempt} failed${
          status ? ` with HTTP ${status}` : ""
        }; retrying in ${delay}ms…`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};

const downloadFfmpeg = async () => {
  if (process.platform !== "win32" || process.arch !== "x64") return null;

  const repositoryRoot = path.resolve(__dirname, "..");
  const targetDirectory = path.join(repositoryRoot, "ffmpeg");
  const targetPath = path.join(targetDirectory, "ffmpeg.exe");
  const manifestPath = path.join(targetDirectory, "manifest.json");
  const ffmpegLicensePath = path.join(targetDirectory, "LICENSE-LGPL-3.0.txt");
  const gplLicensePath = path.join(targetDirectory, "LICENSE-GPL-3.0.txt");
  await fs.promises.mkdir(targetDirectory, { recursive: true });

  if (
    fs.existsSync(targetPath) &&
    fs.existsSync(manifestPath) &&
    fs.existsSync(ffmpegLicensePath) &&
    fs.existsSync(gplLicensePath)
  ) {
    try {
      const manifest = JSON.parse(
        await fs.promises.readFile(manifestPath, "utf8")
      );
      if (
        manifest.build === FFMPEG_BUILD &&
        manifest.archiveSha256 === FFMPEG_ARCHIVE_SHA256 &&
        manifest.executableSha256 === (await digestFile(targetPath)) &&
        (await digestFile(ffmpegLicensePath)) === FFMPEG_LICENSE_SHA256 &&
        (await digestFile(gplLicensePath)) === GPL_LICENSE_SHA256
      ) {
        console.log(`FFmpeg ${FFMPEG_BUILD} already verified at ${targetPath}`);
        return targetPath;
      }
    } catch {
      // Re-download and re-verify below.
    }
  }

  const archivePath = path.join(targetDirectory, `${FFMPEG_ASSET}.download`);
  const extractDirectory = path.join(targetDirectory, ".extract");
  await fs.promises.rm(archivePath, { force: true });
  await fs.promises.rm(extractDirectory, { recursive: true, force: true });

  console.log(`Downloading pinned LGPL FFmpeg ${FFMPEG_BUILD}…`);
  await downloadToFile(FFMPEG_URL, archivePath);
  const archiveDigest = await digestFile(archivePath);
  if (archiveDigest !== FFMPEG_ARCHIVE_SHA256) {
    throw new Error(
      `FFmpeg checksum mismatch: expected ${FFMPEG_ARCHIVE_SHA256}, received ${archiveDigest}`
    );
  }

  const sevenZip = path.join(repositoryRoot, "binaries", "7z.exe");
  if (!fs.existsSync(sevenZip)) {
    throw new Error(`7-Zip is required to extract FFmpeg: ${sevenZip}`);
  }
  await fs.promises.mkdir(extractDirectory, { recursive: true });
  const extraction = spawnSync(
    sevenZip,
    ["x", "-y", `-o${extractDirectory}`, archivePath],
    { encoding: "utf8", windowsHide: true }
  );
  if (extraction.status !== 0) {
    throw new Error(
      extraction.stderr || extraction.stdout || "FFmpeg extraction failed."
    );
  }

  const extractedBinary = findFile(extractDirectory, "ffmpeg.exe");
  const extractedLicense = findFile(extractDirectory, "LICENSE.txt");
  if (!extractedBinary || !extractedLicense) {
    throw new Error(
      "The verified FFmpeg archive did not contain its executable and license."
    );
  }
  await fs.promises.copyFile(extractedBinary, targetPath);
  await fs.promises.copyFile(extractedLicense, ffmpegLicensePath);
  if ((await digestFile(ffmpegLicensePath)) !== FFMPEG_LICENSE_SHA256) {
    throw new Error("The FFmpeg license file failed integrity verification.");
  }

  const gplDownloadPath = path.join(targetDirectory, "GPL-3.0.txt.download");
  await fs.promises.rm(gplDownloadPath, { force: true });
  await downloadToFile(GPL_LICENSE_URL, gplDownloadPath);
  if ((await digestFile(gplDownloadPath)) !== GPL_LICENSE_SHA256) {
    throw new Error(
      "The GNU GPL v3 license file failed integrity verification."
    );
  }
  await fs.promises.rename(gplDownloadPath, gplLicensePath);

  const executableSha256 = await digestFile(targetPath);
  await fs.promises.writeFile(
    manifestPath,
    JSON.stringify(
      {
        build: FFMPEG_BUILD,
        asset: FFMPEG_ASSET,
        source: FFMPEG_URL,
        archiveSha256: FFMPEG_ARCHIVE_SHA256,
        executableSha256,
        ffmpegLicenseSha256: FFMPEG_LICENSE_SHA256,
        gplLicenseSha256: GPL_LICENSE_SHA256,
        license: "LGPL-3.0-or-later",
      },
      null,
      2
    )
  );

  await fs.promises.rm(archivePath, { force: true });
  await fs.promises.rm(extractDirectory, { recursive: true, force: true });
  console.log(`FFmpeg verified and ready at ${targetPath}`);
  return targetPath;
};

if (require.main === module) {
  downloadFfmpeg().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { downloadFfmpeg, FFMPEG_BUILD };
