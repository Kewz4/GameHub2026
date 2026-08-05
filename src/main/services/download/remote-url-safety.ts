import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";

const BLOCKED_HOST_SUFFIXES = [
  ".internal",
  ".invalid",
  ".lan",
  ".local",
  ".localhost",
  ".localdomain",
  ".home",
];

function parseIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }
  return octets;
}

function isPublicIpv4(address: string) {
  const octets = parseIpv4(address);
  if (!octets) return false;
  const [a, b, c] = octets;

  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;

  return true;
}

function parseIpv6(address: string) {
  let normalized = address
    .replace(/^\[|\]$/g, "")
    .split("%", 1)[0]
    .toLowerCase();

  const ipv4Tail = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail) {
    const octets = parseIpv4(ipv4Tail);
    if (!octets) return null;
    const replacement = `${((octets[0] << 8) | octets[1]).toString(16)}:${(
      (octets[2] << 8) |
      octets[3]
    ).toString(16)}`;
    normalized = normalized.slice(0, -ipv4Tail.length) + replacement;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;

  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[a-f0-9]{1,4}$/i.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

function isPublicIpv6(address: string) {
  const bytes = parseIpv6(address);
  if (!bytes) return false;

  const firstTwelveAreZero = bytes.slice(0, 12).every((byte) => byte === 0);
  const isIpv4Mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  if (firstTwelveAreZero || isIpv4Mapped) {
    return isPublicIpv4(bytes.slice(12).join("."));
  }

  // Only global-unicast IPv6 is useful to an internet download. Exclude the
  // documentation, 6to4, Teredo and ORCHID ranges inside 2000::/3 as well.
  if ((bytes[0] & 0xe0) !== 0x20) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return false;
  if (
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    ((bytes[2] === 0x0d && bytes[3] === 0xb8) ||
      (bytes[2] === 0 && bytes[3] === 0) ||
      (bytes[2] === 0 && bytes[3] === 0x10))
  ) {
    return false;
  }

  return true;
}

export function isPublicNetworkAddress(address: string) {
  const normalized = address.replace(/^\[|\]$/g, "").split("%", 1)[0];
  const family = isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family === 6) return isPublicIpv6(normalized);
  return false;
}

export function assertPublicRemoteUrlSyntax(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid public http(s) download link");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only public http(s) download links are supported");
  }
  if (url.username || url.password) {
    throw new Error("Links containing embedded passwords are not supported");
  }

  const hostname = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    (isIP(hostname) !== 0 && !isPublicNetworkAddress(hostname))
  ) {
    throw new Error("Download links must use a public internet address");
  }

  url.hash = "";
  return url;
}

export function filterPublicLookupAddresses(
  addresses: dns.LookupAddress[]
): dns.LookupAddress[] {
  return addresses.filter((entry) => isPublicNetworkAddress(entry.address));
}

function makeBlockedAddressError(hostname: string) {
  const error = new Error(
    `The remote download host did not resolve to a public internet address (${hostname})`
  ) as NodeJS.ErrnoException;
  error.code = "EACCES";
  return error;
}

export const publicOnlyLookup: LookupFunction = (
  hostname,
  options,
  callback
) => {
  void dns.promises
    .lookup(hostname, {
      family: options.family,
      hints: options.hints,
      all: true,
      verbatim: true,
    })
    .then((addresses) => {
      const publicAddresses = filterPublicLookupAddresses(addresses);
      if (publicAddresses.length === 0) {
        callback(makeBlockedAddressError(hostname), "", 0);
        return;
      }

      if (options.all) {
        callback(null, publicAddresses);
        return;
      }

      const selected = publicAddresses[0];
      callback(null, selected.address, selected.family);
    })
    .catch((error: NodeJS.ErrnoException) => callback(error, "", 0));
};

export function createPublicDownloadAgents() {
  return {
    httpAgent: new http.Agent({ lookup: publicOnlyLookup }),
    httpsAgent: new https.Agent({ lookup: publicOnlyLookup }),
  };
}
