import crypto from "node:crypto";
import os from "node:os";

/**
 * EA "pc_sign" generator.
 *
 * The EA App links a login to a machine via a `pc_sign` value passed to the
 * JUNO_PC_CLIENT OAuth flow. It is a SELF-SIGNED token: a small JSON blob of
 * (mostly hardware) identifiers, base64url-encoded, followed by an HMAC-SHA256
 * signature computed with one of two signing keys hardcoded into every EA
 * client. EA's auth server only verifies the HMAC — so the token can be
 * generated entirely in JS with no native/hardware access.
 *
 * Verified live against accounts.ea.com/connect/auth: a token built here is
 * accepted (the server advances past "sig is invalid" to "login_required",
 * i.e. it now only needs the user's login session).
 *
 * Signing keys + payload shape: ArmchairDevelopers/Maxima and the GOG Galaxy
 * EA Desktop integration (BellezaEmporium/galaxy-integration-ead). Kudos to
 * @imLinguin & ArmchairDevelopers for the reverse-engineering.
 */

const SIGN_KEYS: Record<"v1" | "v2", Buffer> = {
  v1: Buffer.from("ISa3dpGOc8wW7Adn4auACSQmaccrOyR2"),
  v2: Buffer.from("nt5FfJbdPzNcl2pkC3zgjO43Knvscxft"),
};

const base64url = (buf: Buffer): string =>
  buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** 64-bit FNV-1a hash, returned as a decimal string (matches EA's `mid`). */
const fnv1a = (input: string): string => {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of Buffer.from(input, "utf8")) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString();
};

/** First non-internal, universally-administered MAC as EA formats it ("$<hex>"). */
const eaMacAddress = (): string | null => {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (!iface.mac || iface.internal) continue;
      if (iface.mac === "00:00:00:00:00:00") continue;
      const hex = iface.mac.replace(/:/g, "").toLowerCase();
      // Skip locally-administered addresses (multicast bit set on first octet).
      const firstOctet = parseInt(hex.slice(0, 2), 16);
      if ((firstOctet & 1) === 0) return `$${hex}`;
    }
  }
  return null;
};

/** EA's timestamp format: "YYYY-M-D H:M:S:ms" (UTC, no zero-padding). */
const eaTimestamp = (): string => {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()} ` +
    `${d.getUTCHours()}:${d.getUTCMinutes()}:${d.getUTCSeconds()}:${d.getUTCMilliseconds()}`
  );
};

/**
 * Builds a valid `pc_sign` token. The hardware values are stable placeholders
 * (EA only verifies the HMAC, not the values) augmented with the real MAC so
 * the derived machine id (`mid`) is stable per device.
 */
export const generateEaPcSign = (sv: "v1" | "v2" = "v1"): string => {
  const boardManufacturer = "Microsoft Corporation";
  const boardSn = "None";
  const biosManufacturer = "Microsoft Corporation";
  const biosSn = "None";
  const osInstallDate = "1970-01-0100:00:00.000000000+0000";
  const osSn = "None";
  const diskSn = "None";
  const mac = eaMacAddress();

  const midBuffer =
    boardManufacturer +
    boardSn +
    biosManufacturer +
    biosSn +
    osInstallDate +
    osSn +
    (mac ?? "");
  const mid = fnv1a(midBuffer);

  // Field order mirrors EA's client (insertion order is part of the payload).
  const payloadObj = {
    av: "v1",
    bsn: biosSn,
    gid: 0,
    hsn: diskSn,
    mac,
    mid,
    msn: boardSn,
    sv,
    ts: eaTimestamp(),
  };

  const payload = base64url(Buffer.from(JSON.stringify(payloadObj), "utf8"));
  const signature = crypto
    .createHmac("sha256", SIGN_KEYS[sv])
    .update(payload, "ascii")
    .digest();

  return `${payload}.${base64url(signature)}`;
};
