export type CustomDownloadSourceType = "link" | "magnet" | "torrent";

export interface ClassifiedCustomDownloadSource {
  type: Exclude<CustomDownloadSourceType, "torrent">;
  value: string;
  remoteTorrentFile: boolean;
}

const MULTIPART_ARCHIVE_SUFFIX = /(?:\.part\d+)?\.(?:zip|rar|7z|torrent)$/i;
const MAX_CUSTOM_DOWNLOAD_SOURCE_LENGTH = 16 * 1024;

function isValidTorrentExactTopic(topic: string) {
  const normalized = topic.toLowerCase();
  if (normalized.startsWith("urn:btih:")) {
    const hash = normalized.slice("urn:btih:".length);
    return /^[a-f0-9]{40}$/i.test(hash) || /^[a-z2-7]{32}$/i.test(hash);
  }

  if (normalized.startsWith("urn:btmh:")) {
    const multihash = normalized.slice("urn:btmh:".length);
    // BitTorrent v2 magnets normally carry a SHA-256 multihash encoded as
    // `1220` followed by 32 bytes of hex. Also accept a bounded multibase form
    // for clients that serialize the same multihash as base32/base64url.
    return (
      /^1220[a-f0-9]{64}$/i.test(multihash) ||
      /^[a-z0-9_-]{40,160}$/i.test(multihash)
    );
  }

  return false;
}

function isRemoteTorrentFileUrl(url: URL) {
  if (url.pathname.toLowerCase().endsWith(".torrent")) return true;

  // Signed/download endpoints often keep the real filename in a query value,
  // for example `download.php?file=game.torrent` or an S3
  // response-content-disposition override. URLSearchParams has already decoded
  // these values for us.
  return Array.from(url.searchParams.values()).some((value) =>
    /\.torrent(?:["'\s;&]|$)/i.test(value)
  );
}

export function classifyCustomDownloadSource(
  input: string
): ClassifiedCustomDownloadSource {
  const value = input.trim();
  if (!value) throw new Error("Paste a direct link or magnet link");
  if (value.length > MAX_CUSTOM_DOWNLOAD_SOURCE_LENGTH) {
    throw new Error("The download link is unexpectedly long");
  }
  if (/\p{Cc}/u.test(value)) {
    throw new Error("The download link contains invalid control characters");
  }

  if (/^magnet:\?/i.test(value)) {
    const params = new URLSearchParams(value.slice(value.indexOf("?") + 1));
    const exactTopics = params.getAll("xt");
    if (!exactTopics.some(isValidTorrentExactTopic)) {
      throw new Error("The magnet link does not contain a valid torrent hash");
    }

    return { type: "magnet", value, remoteTorrentFile: false };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid http(s) download link or magnet link");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) links and magnet links are supported");
  }
  if (url.username || url.password) {
    throw new Error("Links containing embedded passwords are not supported");
  }

  // URL fragments are never sent to an HTTP server and can accidentally carry
  // credentials copied from a browser. They are not needed by TorBox.
  url.hash = "";

  return {
    type: "link",
    value: url.toString(),
    remoteTorrentFile: isRemoteTorrentFileUrl(url),
  };
}

export function normalizeCustomDownloadTitle(input: string) {
  const title = Array.from(input, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? " " : character;
  })
    .join("")
    .trim();
  const normalized = title.replace(/\s+/g, " ");
  if (!normalized) throw new Error("Enter a name for this game");
  if (normalized.length > 160) {
    throw new Error("The game name must be 160 characters or fewer");
  }
  return normalized;
}

export function suggestCustomDownloadTitle(
  source: string,
  attachedFileName?: string | null
) {
  let candidate = attachedFileName?.replace(/\.torrent$/i, "") ?? "";

  if (!candidate && /^magnet:\?/i.test(source.trim())) {
    const query = source.trim().slice(source.indexOf("?") + 1);
    candidate = new URLSearchParams(query).get("dn") ?? "";
  }

  if (!candidate) {
    try {
      const url = new URL(source.trim());
      candidate = decodeURIComponent(
        url.pathname.split("/").filter(Boolean).at(-1) ?? ""
      );
    } catch {
      candidate = "";
    }
  }

  return candidate
    .replace(MULTIPART_ARCHIVE_SUFFIX, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isDirectExecutableUrl(source: string) {
  try {
    const url = new URL(source);
    return (
      /^https?:$/.test(url.protocol) &&
      url.pathname.toLowerCase().endsWith(".exe")
    );
  } catch {
    return false;
  }
}

/** Decide after the server-provided filename is known whether extraction is valid. */
export function shouldExtractCustomDownload(
  filename: string | null | undefined,
  extractionRequested: boolean
) {
  return Boolean(
    extractionRequested && filename && /\.(?:zip|rar|7z)$/i.test(filename)
  );
}
