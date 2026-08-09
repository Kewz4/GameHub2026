type IsoBox = {
  type: string;
  start: number;
  end: number;
};

export type FragmentedMp4TrackTimescales = ReadonlyMap<number, number>;

type FragmentedMp4TrackDescription = {
  timescale: number;
  handlerType: string | null;
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

const parseChildBoxes = (
  bytes: Uint8Array<ArrayBufferLike>,
  start: number,
  end: number
): IsoBox[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: IsoBox[] = [];
  let offset = start;

  while (offset + 8 <= end) {
    const size32 = view.getUint32(offset);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (offset + 16 > end) break;
      const extendedSize = view.getBigUint64(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    boxes.push({
      type: boxTypeAt(bytes, offset),
      start: offset,
      end: offset + size,
    });
    offset += size;
  }
  return boxes;
};

const getFragmentedMp4TrackDescriptions = (
  initialization: Uint8Array<ArrayBufferLike>
): Map<number, FragmentedMp4TrackDescription> => {
  const view = new DataView(
    initialization.buffer,
    initialization.byteOffset,
    initialization.byteLength
  );
  const topLevel = parseTopLevelBoxes(initialization) ?? [];
  const moov = topLevel.find((box) => box.type === "moov");
  const descriptions = new Map<number, FragmentedMp4TrackDescription>();
  if (!moov) return descriptions;

  for (const trak of parseChildBoxes(
    initialization,
    moov.start + 8,
    moov.end
  )) {
    if (trak.type !== "trak") continue;
    const children = parseChildBoxes(initialization, trak.start + 8, trak.end);
    const tkhd = children.find((box) => box.type === "tkhd");
    const mdia = children.find((box) => box.type === "mdia");
    if (!tkhd || !mdia || tkhd.start + 32 > tkhd.end) continue;

    const tkhdVersion = initialization[tkhd.start + 8];
    const trackIdOffset = tkhd.start + (tkhdVersion === 1 ? 28 : 20);
    if (trackIdOffset + 4 > tkhd.end) continue;
    const trackId = view.getUint32(trackIdOffset);

    const mdhd = parseChildBoxes(initialization, mdia.start + 8, mdia.end).find(
      (box) => box.type === "mdhd"
    );
    if (!mdhd) continue;
    const mdhdVersion = initialization[mdhd.start + 8];
    const timescaleOffset = mdhd.start + (mdhdVersion === 1 ? 28 : 20);
    if (timescaleOffset + 4 > mdhd.end) continue;
    const timescale = view.getUint32(timescaleOffset);
    const hdlr = parseChildBoxes(initialization, mdia.start + 8, mdia.end).find(
      (box) => box.type === "hdlr"
    );
    const handlerType =
      hdlr && hdlr.start + 20 <= hdlr.end
        ? String.fromCharCode(
            initialization[hdlr.start + 16],
            initialization[hdlr.start + 17],
            initialization[hdlr.start + 18],
            initialization[hdlr.start + 19]
          )
        : null;
    if (trackId > 0 && timescale > 0) {
      descriptions.set(trackId, { timescale, handlerType });
    }
  }
  return descriptions;
};

/** Read each fragmented-MP4 track's media timescale from the init segment. */
export const getFragmentedMp4TrackTimescales = (
  initialization: Uint8Array<ArrayBufferLike>
): Map<number, number> =>
  new Map(
    [...getFragmentedMp4TrackDescriptions(initialization)].map(
      ([trackId, description]) => [trackId, description.timescale]
    )
  );

/** Count encoded video samples in an independently probeable MP4 slice. */
export const getFragmentedMp4VideoFrameCount = (
  bytes: Uint8Array<ArrayBufferLike>
): number | null => {
  const descriptions = getFragmentedMp4TrackDescriptions(bytes);
  const videoTrackIds = new Set(
    [...descriptions]
      .filter(([, description]) => description.handlerType === "vide")
      .map(([trackId]) => trackId)
  );
  if (!videoTrackIds.size) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let frames = 0;
  let foundRun = false;
  for (const moof of parseTopLevelBoxes(bytes) ?? []) {
    if (moof.type !== "moof") continue;
    for (const traf of parseChildBoxes(bytes, moof.start + 8, moof.end)) {
      if (traf.type !== "traf") continue;
      const children = parseChildBoxes(bytes, traf.start + 8, traf.end);
      const tfhd = children.find((box) => box.type === "tfhd");
      if (!tfhd || tfhd.start + 16 > tfhd.end) continue;
      const trackId = view.getUint32(tfhd.start + 12);
      if (!videoTrackIds.has(trackId)) continue;
      for (const trun of children.filter((box) => box.type === "trun")) {
        if (trun.start + 16 > trun.end) continue;
        frames += view.getUint32(trun.start + 12);
        foundRun = true;
      }
    }
  }
  return foundRun ? frames : null;
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

/**
 * Rebase one or more MP4 fragments while preserving audio/video sync.
 *
 * `tfdt` values from different tracks cannot be directly subtracted: video
 * commonly uses a 90 kHz clock while audio uses 48 kHz. The previous common
 * numeric minimum shifted those unlike clocks by the same tick count, creating
 * a large A/V offset in every replay slice. Convert through the init segment's
 * per-track timescales and subtract one common instant instead.
 */
export const rebaseFragmentedMp4Media = (
  bytes: Uint8Array<ArrayBuffer>,
  trackTimescales: FragmentedMp4TrackTimescales = new Map()
): Uint8Array<ArrayBuffer> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: {
    offset: number;
    version: number;
    value: bigint;
    trackId: number;
  }[] = [];

  const topLevel = parseTopLevelBoxes(bytes) ?? [];
  for (const moof of topLevel) {
    if (moof.type !== "moof") continue;
    for (const traf of parseChildBoxes(bytes, moof.start + 8, moof.end)) {
      if (traf.type !== "traf") continue;
      const children = parseChildBoxes(bytes, traf.start + 8, traf.end);
      const tfhd = children.find((box) => box.type === "tfhd");
      const tfdt = children.find((box) => box.type === "tfdt");
      if (!tfhd || !tfdt || tfhd.start + 16 > tfhd.end) continue;
      const trackId = view.getUint32(tfhd.start + 12);
      const version = bytes[tfdt.start + 8];
      found.push({
        offset: tfdt.start,
        version,
        trackId,
        value:
          version === 1
            ? view.getBigUint64(tfdt.start + 12)
            : BigInt(view.getUint32(tfdt.start + 12)),
      });
    }
  }
  if (!found.length) return bytes;

  const timed = found.filter((entry) => trackTimescales.has(entry.trackId));
  const earliest = timed.reduce<(typeof timed)[number] | null>(
    (lowest, entry) => {
      if (!lowest) return entry;
      const entryScale = BigInt(trackTimescales.get(entry.trackId)!);
      const lowestScale = BigInt(trackTimescales.get(lowest.trackId)!);
      return entry.value * lowestScale < lowest.value * entryScale
        ? entry
        : lowest;
    },
    null
  );

  const fallbackBaseByTrack = new Map<number, bigint>();
  for (const entry of found) {
    const current = fallbackBaseByTrack.get(entry.trackId);
    if (current === undefined || entry.value < current) {
      fallbackBaseByTrack.set(entry.trackId, entry.value);
    }
  }

  for (const entry of found) {
    const entryScale = trackTimescales.get(entry.trackId);
    const earliestScale = earliest
      ? trackTimescales.get(earliest.trackId)
      : undefined;
    const base =
      earliest && entryScale && earliestScale
        ? (earliest.value * BigInt(entryScale)) / BigInt(earliestScale)
        : (fallbackBaseByTrack.get(entry.trackId) ?? entry.value);
    const rebased = entry.value >= base ? entry.value - base : 0n;
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
  private trackTimescales: FragmentedMp4TrackTimescales = new Map();
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
      this.trackTimescales = getFragmentedMp4TrackTimescales(
        this.initialization
      );
      this.pendingInitialization = EMPTY_BYTES();
      media = split.media;
    }

    if (!media.byteLength) return null;
    return concatenateBytes(
      this.initialization,
      rebaseFragmentedMp4Media(media, this.trackTimescales)
    );
  }
}
