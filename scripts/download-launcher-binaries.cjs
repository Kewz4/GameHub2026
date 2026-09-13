const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const axios = require("axios");
const manifest = require("../resources/launcher-binaries.json");

const getRelease = (tool, platform = process.platform, arch = process.arch) => {
  const release = manifest[tool];
  const asset = release?.assets[`${platform}-${arch}`];
  if (!asset)
    throw new Error(`No verified ${tool} binary for ${platform}-${arch}`);
  return {
    ...asset,
    url: `https://github.com/${release.repository}/releases/download/${release.version}/${asset.name}`,
  };
};
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const reuseVerifiedBinary = (
  destination,
  expectedHash,
  platform,
  fileSystem = fs
) => {
  if (
    !fileSystem.existsSync(destination) ||
    hash(fileSystem.readFileSync(destination)) !== expectedHash
  )
    return false;
  // Archives, shared workspaces and restored caches can preserve bytes but lose
  // executable permissions. A checksum hit must still repair that metadata.
  if (platform !== "win32") fileSystem.chmodSync(destination, 0o755);
  return true;
};

async function download(tool, platform, arch) {
  const release = getRelease(tool, platform, arch);
  const destination = path.join(
    __dirname,
    "..",
    "binaries",
    "bin",
    `${tool}${platform === "win32" ? ".exe" : ""}`
  );
  if (reuseVerifiedBinary(destination, release.sha256, platform)) {
    console.log(`${tool} already checksum-verified for ${platform}-${arch}`);
    return;
  }
  const response = await axios.get(release.url, {
    responseType: "arraybuffer",
    timeout: 120_000,
    maxContentLength: 128 * 1024 * 1024,
  });
  const bytes = Buffer.from(response.data);
  if (hash(bytes) !== release.sha256)
    throw new Error(`${tool} download checksum mismatch`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.download-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporary, bytes, { mode: 0o755, flag: "wx" });
    if (platform !== "win32") fs.chmodSync(temporary, 0o755);
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  console.log(`Verified ${tool} for ${platform}-${arch}: ${destination}`);
}
if (require.main === module) {
  const platform = process.argv[2] || process.platform;
  const arch = process.argv[3] || process.arch;
  Promise.all(
    Object.keys(manifest).map((tool) => download(tool, platform, arch))
  ).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { getRelease, reuseVerifiedBinary };
