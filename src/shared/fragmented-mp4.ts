type IsoBox = {
  type: string;
  start: number;
  end: number;
};

export type FragmentedMp4Initialization = {
  initialization: Uint8Array<ArrayBuffer>;
  media: Uint8Array<ArrayBuffer>;
};

const EMPTY_BYTES = () => new Uint8Array(0);

export const concatenateBytes = (
  ...parts: ReadonlyArray<Uint8Array<ArrayBufferLike>>
): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0)
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};

const boxTypeAt = (bytes: Uint8Array<ArrayBufferLike>, offset: number) =>
  String.fromCharCode(
    bytes[offset + 4],
    bytes[offset + 5],
    bytes[offset + 6],
    bytes[offset + 7]
  );

/**
 * Parse complete top-level ISO-BMFF boxes.
 *
 * MediaRecorder is allowed to split the initialization data across several
 * `dataavailable` events. Returning null for an incomplete trailing box lets
 * the caller retain the bytes and append the next event before trying again.
 */
const parseTopLevelBoxes = (
  bytes: Uint8Array<ArrayBufferLike>
): IsoBox[] | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: IsoBox[] = [];
  let offset = 0;

  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) return null;

    const size32 = view.getUint32(offset);
    const type = boxTypeAt(bytes, offset);
    let headerSize = 8;
    let size: number;

    if (size32 === 1) {
      if (offset + 16 > bytes.byteLength) return null;
      const extendedSize = view.getBigUint64(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size32 === 0) {
      // A zero-sized box extends to EOF. It is complete for this emitted Blob.
      size = bytes.byteLength - offset;
    } else {
      size = size32;
    }

    if (size < headerSize || offset + size > bytes.byteLength) return null;
    boxes.push({ type, start: offset, end: offset + size });
    offset += size;
  }

  return boxes;
};

/**
 * Split Chromium's fragmented-MP4 stream into the reusable `ftyp`/`moov`
 * initialization prefix and the first `moof` media fragment.
 *
 * Chromium 140 (Electron 40) commonly emits `ftyp` as the first event and
 * `moov` plus the first `moof`/`mdat` as the second. Treating event one as the
 * whole initialization segment produces files with no `moov`, which FFmpeg and
 * media players cannot open. Call this with all bytes accumulated until it
 * returns a result.
 */
export const splitFragmentedMp4Initialization = (
  bytes: Uint8Array<ArrayBufferLike>
): FragmentedMp4Initialization | null => {
  const boxes = parseTopLevelBoxes(bytes);
  if (!boxes) return null;

  const moov = boxes.find((box) => box.type === "moov");
  if (!moov) return null;

  const firstMedia = boxes.find(
    (box) => box.start >= moov.end && box.type === "moof"
  );
  const mediaOffset = firstMedia?.start ?? bytes.byteLength;
  return {
    initialization: bytes.slice(0, mediaOffset),
    media:
      mediaOffset < bytes.byteLength ? bytes.slice(mediaOffset) : EMPTY_BYTES(),
  };
};

/** Rebase every track in one or more MP4 fragments onto a zero timeline. */
export const rebaseFragmentedMp4Media = (
  bytes: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: { offset: number; version: number; value: bigint }[] = [];

  const walk = (start: number, end: number) => {
    let offset = start;
    while (offset + 8 <= end) {
      const size = view.getUint32(offset);
      if (size < 8 || offset + size > end) return;
      const type = boxTypeAt(bytes, offset);
      if (type === "moof" || type === "traf") {
        walk(offset + 8, offset + size);
      } else if (type === "tfdt") {
        const version = bytes[offset + 8];
        found.push({
          offset,
          version,
          value:
            version === 1
              ? view.getBigUint64(offset + 12)
              : BigInt(view.getUint32(offset + 12)),
        });
      }
      offset += size;
    }
  };

  walk(0, bytes.byteLength);
  if (!found.length) return bytes;

  // Preserve the relative offset between audio/video tracks and between all
  // moofs in this event. Only the event's common decode-time base is removed.
  const base = found.reduce(
    (lowest, entry) => (entry.value < lowest ? entry.value : lowest),
    found[0].value
  );
  for (const entry of found) {
    const rebased = entry.value - base;
    if (entry.version === 1) view.setBigUint64(entry.offset + 12, rebased);
    else view.setUint32(entry.offset + 12, Number(rebased));
  }
  return bytes;
};

/**
 * Incrementally turns MediaRecorder's fragmented-MP4 events into independently
 * probeable MP4 files. The initialization bytes are retained once and prepended
 * to each subsequently rebased media event.
 */
export class FragmentedMp4SegmentAssembler {
  private initialization: Uint8Array<ArrayBuffer> | null = null;
  private pendingInitialization = EMPTY_BYTES();

  public push(
    emitted: Uint8Array<ArrayBuffer>
  ): Uint8Array<ArrayBuffer> | null {
    let media = emitted;
    if (!this.initialization) {
      this.pendingInitialization = concatenateBytes(
        this.pendingInitialization,
        emitted
      );
      const split = splitFragmentedMp4Initialization(
        this.pendingInitialization
      );
      if (!split) return null;
      this.initialization = split.initialization;
      this.pendingInitialization = EMPTY_BYTES();
      media = split.media;
    }

    if (!media.byteLength) return null;
    return concatenateBytes(
      this.initialization,
      rebaseFragmentedMp4Media(media)
    );
  }
}
