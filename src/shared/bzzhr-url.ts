const BZZHR_PAGE_HOST = "bzzhr.to";
const BZZHR_DIRECT_HOSTS = new Set(["ts.bzzhr.to", "ts.bzzhr.io"]);

export type ParsedBzzhrUri =
  | { kind: "page"; id: string; url: URL }
  | { kind: "direct"; id: string; url: URL };

const parseHttpsUrl = (value: string): URL | null => {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
};

/** Parse only the public page and direct-download URL shapes Bzzhr exposes. */
export const parseBzzhrUri = (value: string): ParsedBzzhrUri | null => {
  const url = parseHttpsUrl(value);
  if (!url) return null;

  const segments = url.pathname.split("/").filter(Boolean);

  if (url.hostname === BZZHR_PAGE_HOST && segments.length === 1 && !url.hash) {
    return { kind: "page", id: segments[0], url };
  }

  if (
    BZZHR_DIRECT_HOSTS.has(url.hostname) &&
    segments[0] === "d" &&
    segments.length >= 2 &&
    !url.hash
  ) {
    return { kind: "direct", id: segments[1], url };
  }

  return null;
};

export const isBzzhrUri = (value: string): boolean =>
  parseBzzhrUri(value) !== null;

export const isBzzhrDirectUri = (value: string): boolean =>
  parseBzzhrUri(value)?.kind === "direct";

/**
 * Extract a same-origin, same-file token path from the Bzzhr download page.
 * The token itself is deliberately never returned in an error or log message.
 */
export const extractBzzhrTokenPath = (
  html: string,
  expectedId: string
): string => {
  const normalized = html.replaceAll(String.raw`\/`, "/");
  const copyLink = /copyDownloadLink\(\s*['"]([^'"]+)['"]\s*\)/i.exec(
    normalized
  )?.[1];
  const genericToken = /(\/[A-Za-z0-9_-]+\/download\?t=[^\s'"<>\\]+)/i.exec(
    normalized
  )?.[1];
  const candidate = copyLink ?? genericToken;

  if (!candidate) throw new Error("bzzhr_download_token_missing");

  let tokenUrl: URL;
  try {
    tokenUrl = new URL(candidate, `https://${BZZHR_PAGE_HOST}`);
  } catch {
    throw new Error("bzzhr_download_token_invalid");
  }

  const segments = tokenUrl.pathname.split("/").filter(Boolean);
  if (
    tokenUrl.protocol !== "https:" ||
    tokenUrl.hostname !== BZZHR_PAGE_HOST ||
    tokenUrl.username ||
    tokenUrl.password ||
    tokenUrl.hash ||
    segments.length !== 2 ||
    segments[0] !== expectedId ||
    segments[1] !== "download" ||
    !tokenUrl.searchParams.get("t")
  ) {
    throw new Error("bzzhr_download_token_invalid");
  }

  return `${tokenUrl.pathname}${tokenUrl.search}`;
};

/** Accept a redirect only when it is the direct URL for this exact request. */
export const validateBzzhrDirectRedirect = (
  value: string,
  expectedId: string
): string => {
  const parsed = parseBzzhrUri(value);
  if (parsed?.kind !== "direct" || parsed.id !== expectedId) {
    throw new Error("bzzhr_download_redirect_invalid");
  }
  return parsed.url.toString();
};

/** Intermediate redirects may remain on the token origin, never elsewhere. */
export const isSafeBzzhrIntermediateRedirect = (value: string): boolean => {
  const url = parseHttpsUrl(value);
  return Boolean(
    url &&
      url.hostname === BZZHR_PAGE_HOST &&
      !url.username &&
      !url.password &&
      !url.hash
  );
};
