const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

function validateAsset(asset) {
  if (
    !asset ||
    typeof asset.name !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._ -]+$/.test(asset.name) ||
    asset.name !== path.basename(asset.name)
  )
    throw new Error("Invalid release filename.");
  const url = new URL(asset.url);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.github.com" ||
    !/^\/repos\/Kewz4\/GameHub2026\/releases\/assets\/\d+$/.test(url.pathname)
  ) {
    throw new Error("GameHub refused an untrusted release asset URL.");
  }
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0)
    throw new Error("The release has no valid download size.");
  if (asset.digest && !/^sha256:[a-f0-9]{64}$/i.test(asset.digest))
    throw new Error("Unsupported release checksum.");
  return asset;
}

async function downloadReleaseAsset(
  asset,
  destination,
  openStream,
  onProgress,
  signal
) {
  validateAsset(asset);
  const partial = `${destination}.part`;
  const hash = crypto.createHash("sha256");
  let downloaded = 0;
  let lastProgress = 0;
  try {
    const source = await openStream(asset.url, signal);
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        downloaded += chunk.length;
        if (downloaded > asset.size)
          return callback(new Error("Download exceeds the release size."));
        hash.update(chunk);
        if (Date.now() - lastProgress >= 100 || downloaded === asset.size) {
          onProgress?.({
            downloaded,
            total: asset.size,
            percent: (downloaded / asset.size) * 100,
          });
          lastProgress = Date.now();
        }
        callback(null, chunk);
      },
    });
    await pipeline(
      source,
      meter,
      fs.createWriteStream(partial, { flags: "wx" }),
      { signal }
    );
    if (downloaded !== asset.size)
      throw new Error("The download was interrupted. Try again.");
    const digest = `sha256:${hash.digest("hex")}`;
    if (asset.digest && digest !== asset.digest.toLowerCase())
      throw new Error(
        "The download did not match the release checksum. Try again."
      );
    await fs.promises.rename(partial, destination);
    return { bytes: downloaded, digest };
  } catch (error) {
    await fs.promises.rm(partial, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = { validateAsset, downloadReleaseAsset };
