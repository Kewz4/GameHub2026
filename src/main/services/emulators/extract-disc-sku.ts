import { createReadStream } from "node:fs";
import { parseCueReferencedFiles } from "./sniff-disc-platform";

const SKU_RE = /[A-Z]{4}-?\d{5}/;
const SNIFF_BYTES = 4 * 1024 * 1024;

const readBytesAsText = (filePath: string, maxBytes: number): Promise<string> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let read = 0;
    const stream = createReadStream(filePath, { highWaterMark: 65536 });
    stream.on("data", (chunk: Buffer | string) => {
      if (typeof chunk === "string") return;
      const remaining = maxBytes - read;
      if (remaining <= 0) {
        stream.destroy();
        return;
      }
      chunks.push(chunk.subarray(0, Math.min(chunk.length, remaining)));
      read += chunk.length;
      if (read >= maxBytes) stream.destroy();
    });
    stream.on("close", () => resolve(Buffer.concat(chunks).toString("latin1")));
    stream.on("error", () => resolve(""));
  });

export const extractDiscSku = async (
  filePath: string,
  _system: string
): Promise<string | null> => {
  try {
    let target = filePath;
    if (filePath.toLowerCase().endsWith(".cue")) {
      const refs = await parseCueReferencedFiles(filePath);
      target = refs[0] ?? filePath;
    }
    const text = await readBytesAsText(target, SNIFF_BYTES);
    const match = SKU_RE.exec(text);
    return match ? match[0].replace("-", "") : null;
  } catch {
    return null;
  }
};

export const formatSkuLabel = (sku: string): string => {
  if (sku.length === 9 && !sku.includes("-")) {
    return `${sku.slice(0, 4)}-${sku.slice(4)}`;
  }
  return sku;
};
