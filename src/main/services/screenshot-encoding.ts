import sharp from "sharp";

/** Normalize HDR/compositor frames to a tagged SDR JPEG for stable display. */
export const encodeSdrScreenshotJpeg = (input: Buffer, quality: number) =>
  sharp(input)
    .toColourspace("srgb")
    .withIccProfile("srgb")
    .jpeg({ quality })
    .toBuffer();
