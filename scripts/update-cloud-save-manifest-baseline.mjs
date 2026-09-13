import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://cdn.losbroxas.org/manifest.yaml";
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetDirectory = path.join(
  root,
  "native",
  "hydra-native",
  "src",
  "cloud_save",
  "manifest"
);

const response = await fetch(SOURCE_URL, {
  headers: { "User-Agent": "GameHub-Manifest-Baseline/1" },
});
if (!response.ok) {
  throw new Error(`Manifest download failed with HTTP ${response.status}`);
}
const declaredLength = Number(response.headers.get("Content-Length"));
if (Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_BYTES) {
  throw new Error("Manifest exceeds the release baseline size limit");
}

const raw = Buffer.from(await response.arrayBuffer());
if (raw.length === 0 || raw.length > MAX_MANIFEST_BYTES) {
  throw new Error("Manifest body is empty or exceeds the size limit");
}
const digest = crypto.createHash("sha256").update(raw).digest("hex");
const compressed = gzipSync(raw, { level: 9, mtime: 0 });

await Promise.all([
  fs.writeFile(
    path.join(targetDirectory, "baseline-manifest.yaml.gz"),
    compressed
  ),
  fs.writeFile(
    path.join(targetDirectory, "baseline-manifest.sha256"),
    `${digest}\n`,
    "utf8"
  ),
]);

console.log(
  JSON.stringify({
    source: SOURCE_URL,
    bytes: raw.length,
    compressedBytes: compressed.length,
    sha256: digest,
  })
);
