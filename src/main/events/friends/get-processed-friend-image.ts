import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { net } from "electron";
import { registerEvent } from "../register-event";
import { logger } from "@main/services";
import { SystemPath } from "@main/services/system-path";

type FriendImageOptions = {
  width: number;
  height: number;
  preserveAnimation?: boolean;
};

const MAX_DIMENSION = 2048;
const CACHE_VERSION = 2;
const inFlight = new Map<string, Promise<string>>();

const isHttpUrl = (url: string) =>
  url.startsWith("http://") || url.startsWith("https://");

const validateOptions = ({ width, height }: FriendImageOptions) => {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_DIMENSION &&
    height <= MAX_DIMENSION
  );
};

const getCacheDir = () => {
  return path.join(SystemPath.getPath("userData"), "image-cache", "friends");
};

const getCacheKey = (
  imageUrl: string,
  options: Required<FriendImageOptions>
) => {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        imageUrl,
        version: CACHE_VERSION,
        width: options.width,
        height: options.height,
        preserveAnimation: options.preserveAnimation,
      })
    )
    .digest("hex");
};

const findCachedImage = async (cacheDir: string, cacheKey: string) => {
  for (const extension of ["gif", "webp", "png", "jpg"]) {
    const imagePath = path.join(cacheDir, `${cacheKey}.${extension}`);
    if (fs.existsSync(imagePath)) {
      return imagePath;
    }
  }
  return null;
};

const downloadAndCacheImage = async (
  imageUrl: string,
  options: Required<FriendImageOptions>
) => {
  const cacheDir = getCacheDir();
  await fs.promises.mkdir(cacheDir, { recursive: true });

  const cacheKey = getCacheKey(imageUrl, options);
  const cached = await findCachedImage(cacheDir, cacheKey);
  if (cached) return `local:${cached}`;

  const response = await net.fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Image download failed with status ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0];
  if (contentType && !contentType.startsWith("image/")) {
    throw new Error(`Unexpected image content type: ${contentType}`);
  }

  const isGif =
    contentType === "image/gif" || imageUrl.toLowerCase().includes(".gif");
  const extension = isGif ? "gif" : "webp";
  const finalPath = path.join(cacheDir, `${cacheKey}.${extension}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(finalPath, buffer);

  return `local:${finalPath}`;
};

const getProcessedFriendImage = async (
  _event: Electron.IpcMainInvokeEvent,
  imageUrl: string | null,
  options: FriendImageOptions
): Promise<string | null> => {
  if (!imageUrl || !isHttpUrl(imageUrl)) return imageUrl;
  if (!validateOptions(options)) return imageUrl;

  const normalizedOptions: Required<FriendImageOptions> = {
    width: options.width,
    height: options.height,
    preserveAnimation: options.preserveAnimation ?? true,
  };

  const inFlightKey = getCacheKey(imageUrl, normalizedOptions);

  try {
    const existingRequest = inFlight.get(inFlightKey);
    if (existingRequest) return await existingRequest;

    const request = downloadAndCacheImage(imageUrl, normalizedOptions);
    inFlight.set(inFlightKey, request);

    return await request;
  } catch (error) {
    logger.error("Failed to process friend image", { imageUrl, error });
    return imageUrl;
  } finally {
    inFlight.delete(inFlightKey);
  }
};

registerEvent("getProcessedFriendImage", getProcessedFriendImage);
