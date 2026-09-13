import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import axios from "axios";
import releases from "../../../resources/launcher-binaries.json";

export type LauncherBinary = keyof typeof releases;
export const getLauncherBinaryRelease = (
  tool: LauncherBinary,
  platform: string = process.platform,
  arch: string = process.arch
) => {
  const release = releases[tool];
  const assets: Record<string, { name: string; sha256: string }> =
    release.assets;
  const asset = assets[`${platform}-${arch}`];
  if (!asset)
    throw new Error(`No verified ${tool} binary for ${platform}-${arch}`);
  return {
    ...asset,
    version: release.version,
    url: `https://github.com/${release.repository}/releases/download/${release.version}/${asset.name}`,
  };
};

export const verifyLauncherBinary = (bytes: Uint8Array, expected: string) => {
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (hash !== expected)
    throw new Error(
      "Launcher helper checksum mismatch; the installed binary was not replaced."
    );
};

export const installLauncherBinary = async (
  tool: LauncherBinary,
  destination: string,
  onProgress?: (percent: number) => void
) => {
  const release = getLauncherBinaryRelease(tool);
  const response = await axios.get<ArrayBuffer>(release.url, {
    responseType: "arraybuffer",
    timeout: 120_000,
    maxContentLength: 128 * 1024 * 1024,
    onDownloadProgress: (event) => {
      if (event.total)
        onProgress?.(Math.round((event.loaded / event.total) * 100));
    },
  });
  const bytes = Buffer.from(response.data);
  verifyLauncherBinary(bytes, release.sha256);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.download-${crypto.randomUUID()}`;
  try {
    await fs.promises.writeFile(temporary, bytes, { flag: "wx", mode: 0o755 });
    if (process.platform !== "win32") await fs.promises.chmod(temporary, 0o755);
    await fs.promises.rename(temporary, destination);
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
  return destination;
};

export const findExecutableOnPath = (
  name: string,
  env = process.env
): string | null => {
  const fileName = process.platform === "win32" ? `${name}.exe` : name;
  for (const directory of (env.PATH ?? env.Path ?? "")
    .split(path.delimiter)
    .filter(Boolean)) {
    const file = path.join(directory, fileName);
    try {
      if (!fs.statSync(file).isFile()) continue;
      fs.accessSync(
        file,
        process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK
      );
      return file;
    } catch {
      /* Continue to the next actual executable. */
    }
  }
  return null;
};
