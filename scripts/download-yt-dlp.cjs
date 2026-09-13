const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");

// Pin the standalone executables so packaged playback never depends on a
// system Python installation and identical GameHub commits ship identical
// resolver bytes. Checksums are from the release's official SHA2-256SUMS asset.
const YT_DLP_VERSION = "2026.07.04";
const YT_DLP_RELEASE_BASE = `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}`;

const RELEASES = {
  "win32-x64": {
    asset: "yt-dlp.exe",
    output: "yt-dlp.exe",
    sha256: "52fe3c26dcf71fbdc85b528589020bb0b8e383155cfa81b64dd447bbe35e24b8",
  },
  "win32-arm64": {
    asset: "yt-dlp_arm64.exe",
    output: "yt-dlp.exe",
    sha256: "1525690b037ecc0bb677e38e7147b0025179cbc9a8d0c57264e3100b18099280",
  },
  "linux-x64": {
    asset: "yt-dlp_linux",
    output: "yt-dlp",
    sha256: "6bbb3d314cde4febe36e5fa1d55462e29c974f63444e707871834f6d8cc210ae",
  },
  "linux-arm64": {
    asset: "yt-dlp_linux_aarch64",
    output: "yt-dlp",
    sha256: "b6ce97646773070d7a7ffd6bbbdcaecb47c48483909c54c915bf08a7a9b5e0b1",
  },
  "darwin-x64": {
    asset: "yt-dlp_macos",
    output: "yt-dlp",
    sha256: "498bd0dae17855c599d371d68ec5bafc439a9d8640e838be25c765a9792f261b",
  },
  "darwin-arm64": {
    asset: "yt-dlp_macos",
    output: "yt-dlp",
    sha256: "498bd0dae17855c599d371d68ec5bafc439a9d8640e838be25c765a9792f261b",
  },
};

const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

const getRelease = () => {
  const key = `${process.platform}-${process.arch}`;
  const release = RELEASES[key];
  if (!release) {
    throw new Error(`No pinned yt-dlp standalone binary for ${key}`);
  }
  return release;
};

const downloadYtDlp = async () => {
  const release = getRelease();
  const targetDirectory = path.resolve(__dirname, "..", "yt-dlp");
  const targetPath = path.join(targetDirectory, release.output);

  if (fs.existsSync(targetPath)) {
    const existingDigest = sha256(await fs.promises.readFile(targetPath));
    if (existingDigest === release.sha256) {
      console.log(`yt-dlp ${YT_DLP_VERSION} already verified at ${targetPath}`);
      return targetPath;
    }
  }

  const url = `${YT_DLP_RELEASE_BASE}/${release.asset}`;
  console.log(
    `Downloading pinned yt-dlp ${YT_DLP_VERSION} (${release.asset})…`
  );
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 120_000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  const binary = Buffer.from(response.data);
  const downloadedDigest = sha256(binary);
  if (downloadedDigest !== release.sha256) {
    throw new Error(
      `yt-dlp checksum mismatch: expected ${release.sha256}, received ${downloadedDigest}`
    );
  }

  await fs.promises.mkdir(targetDirectory, { recursive: true });
  await fs.promises.writeFile(targetPath, binary, { mode: 0o755 });
  if (process.platform !== "win32") {
    await fs.promises.chmod(targetPath, 0o755);
  }
  console.log(`yt-dlp verified and ready at ${targetPath}`);
  return targetPath;
};

if (require.main === module) {
  downloadYtDlp().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { downloadYtDlp, YT_DLP_VERSION };
