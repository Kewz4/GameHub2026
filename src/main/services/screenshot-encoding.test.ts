import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";

import { encodeSdrScreenshotJpeg } from "./screenshot-encoding";

describe("souvenir SDR screenshot encoding", () => {
  it("emits a tagged sRGB JPEG", async () => {
    const input = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 4,
        background: { r: 220, g: 120, b: 20, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const output = await encodeSdrScreenshotJpeg(input, 82);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.space, "srgb");
    assert.ok(metadata.icc && metadata.icc.length > 0);
  });
});
