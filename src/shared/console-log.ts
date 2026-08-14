export type ConsoleLogLevel =
  | "error"
  | "warn"
  | "info"
  | "verbose"
  | "debug"
  | "silly"
  | string;

export interface ConsoleLogEntry {
  id: number;
  ts: number;
  level: ConsoleLogLevel;
  scope: string;
  text: string;
}

export interface ConsoleLogSnapshot {
  entries: ConsoleLogEntry[];
  latestId: number;
  droppedBeforeId: number;
}

export interface ConsoleLogChannel {
  id: string;
  label: string;
  scopes: string[];
  tags: string[];
  keywords: string[];
}

export const CONSOLE_LOG_CHANNELS: ConsoleLogChannel[] = [
  {
    id: "library",
    label: "Library & Artwork",
    scopes: ["library", "catalogue", "catalog", "artwork", "metadata"],
    tags: [
      "library",
      "catalogue",
      "catalog",
      "artwork",
      "metadata",
      "sgdb",
      "steamgriddb",
      "igdb",
    ],
    keywords: [
      "library sync",
      "catalogue search",
      "missing artwork",
      "fetchbestassets",
      "generatemissingmetadata",
      "steamgriddb",
    ],
  },
  {
    id: "cloud",
    label: "Cloud Saves",
    scopes: ["cloud", "cloud-save", "cloud-sync", "r2"],
    tags: [
      "cloud",
      "cloud-save",
      "cloud-sync",
      "cloudsave",
      "cloudsavev2",
      "ludusavi",
      "save-sync",
      "saves",
      "r2",
    ],
    keywords: ["cloud save", "snapshot", "save sync", "ludusavi", "r2 "],
  },
  {
    id: "achievements",
    label: "Achievements",
    scopes: ["achievements", "achievement"],
    tags: [
      "achievement",
      "achievements",
      "exophase",
      "retroachievements",
      "ra",
      "psn",
      "trophy",
    ],
    keywords: ["achievement", "exophase", "retroachievement", "troph"],
  },
  {
    id: "downloads",
    label: "Downloads",
    scopes: ["downloads", "download", "torrent"],
    tags: [
      "download",
      "downloads",
      "downloadmanager",
      "downloadorchestrator",
      "jshttpdownloader",
      "minerva",
      "torrent",
      "torbox",
      "debrid",
      "http",
      "gogdl",
      "legendary",
    ],
    keywords: [
      "download",
      "torrent",
      "torbox",
      "range header",
      "extracting",
      "seeding",
    ],
  },
  {
    id: "emulators",
    label: "Emulators",
    scopes: ["emulators", "emulator", "rom"],
    tags: [
      "emulator",
      "emulators",
      "cemu",
      "rpcs3",
      "dolphin",
      "pcsx2",
      "duckstation",
      "retroarch",
      "rom",
      "roms",
      "gamehub-meta",
    ],
    keywords: ["emulator", " rom ", "cemu", "rpcs3", "dolphin", "pcsx2"],
  },
  {
    id: "overlay",
    label: "Overlay & Capture",
    scopes: ["overlay", "recorder", "presentmon", "capture"],
    tags: [
      "overlay",
      "recorder",
      "game-recorder",
      "presentmon",
      "fps",
      "capture",
      "instant-replay",
    ],
    keywords: [
      "overlay",
      "presentmon",
      "instant replay",
      "game recorder",
      "capture session",
    ],
  },
  {
    id: "mods",
    label: "Mod Manager",
    scopes: ["mods", "mod-manager"],
    tags: ["ukmm", "mods", "botw-mod", "gamebanana", "bcml"],
    keywords: ["mod manager", "gamebanana", "ukmm", "bcml"],
  },
  {
    id: "music",
    label: "Music",
    scopes: ["music", "spotify", "youtube"],
    tags: ["music", "spotify", "yt-dlp", "youtube", "deezer"],
    keywords: ["spotify", "yt-dlp", "music player", "deezer"],
  },
  {
    id: "network",
    label: "Network",
    scopes: ["network", "ws", "websocket"],
    tags: ["network", "ws", "websocket", "http-client"],
    keywords: [
      "network change",
      "connection available",
      "websocket",
      "reconnecting",
    ],
  },
  {
    id: "account",
    label: "Account & API",
    scopes: ["auth", "account", "hydra-api", "api"],
    tags: [
      "auth",
      "account",
      "hydraapi",
      "hydra-api",
      "api",
      "profile",
      "clouddebugger",
    ],
    keywords: ["sign in", "logged in", "auth refresh", "profile/games"],
  },
  {
    id: "updates",
    label: "Updates",
    scopes: ["updater", "update"],
    tags: ["updater", "update", "updater:eu"],
    keywords: ["checking for update", "update downloaded", "in-app check"],
  },
  {
    id: "python-rpc",
    label: "Python RPC",
    scopes: ["python-rpc", "python"],
    tags: ["python-rpc", "python", "rpc"],
    keywords: ["python rpc", "pythonrpc"],
  },
];

export const CONSOLE_OTHER_CHANNEL = "other";

const normalizeClassifierText = (value: string): string =>
  value.toLowerCase().replace(/[_:]+/g, "-");

export function consoleLogChannelOf(
  entry: Pick<ConsoleLogEntry, "scope" | "text">
): string {
  const scope = normalizeClassifierText(entry.scope || "main");
  const text = normalizeClassifierText(entry.text);
  const tags = [...entry.text.matchAll(/\[([a-z0-9_:-]+)\]/gi)].map((match) =>
    normalizeClassifierText(match[1])
  );

  for (const channel of CONSOLE_LOG_CHANNELS) {
    if (
      channel.scopes.some(
        (candidate) =>
          scope === candidate ||
          scope.startsWith(`${candidate}-`) ||
          scope.endsWith(`-${candidate}`)
      )
    ) {
      return channel.id;
    }
  }

  for (const channel of CONSOLE_LOG_CHANNELS) {
    if (
      tags.some((tag) =>
        channel.tags.some(
          (candidate) => tag === candidate || tag.startsWith(`${candidate}-`)
        )
      )
    ) {
      return channel.id;
    }
  }

  for (const channel of CONSOLE_LOG_CHANNELS) {
    if (channel.keywords.some((keyword) => text.includes(keyword))) {
      return channel.id;
    }
  }

  return CONSOLE_OTHER_CHANNEL;
}

const SECRET_VALUE_PATTERN =
  /((?:^|[^\w])["']?(?:(?:[a-z][a-z0-9_-]*)?(?:token|api[_-]?key)|authorization|password|secret|client[_-]?secret|cookie|x-amz-(?:credential|signature|security-token))\b["']?\s*[=:]\s*)(["']?)([^\s,"'}&]+)\2/gim;

const SECRET_KEY_NAMES = new Set([
  "authorization",
  "proxyauthorization",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "authtoken",
  "bearertoken",
  "apikey",
  "apitoken",
  "password",
  "passwd",
  "secret",
  "clientsecret",
  "privatekey",
  "accesskeyid",
  "secretaccesskey",
  "cookie",
  "setcookie",
  "credential",
  "signature",
  "securitytoken",
  "jwt",
]);

const normalizeSecretKey = (key: string) =>
  key.toLowerCase().replace(/[^a-z0-9]/g, "");

const isSecretLogKey = (key: string) => {
  const normalized = normalizeSecretKey(key);
  return (
    SECRET_KEY_NAMES.has(normalized) ||
    normalized === "token" ||
    normalized.endsWith("token") ||
    normalized.endsWith("accesstoken") ||
    normalized.endsWith("refreshtoken") ||
    normalized.endsWith("sessiontoken") ||
    normalized.endsWith("securitytoken") ||
    normalized.endsWith("authtoken") ||
    normalized.endsWith("apitoken") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("password") ||
    normalized.endsWith("clientsecret") ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("secretaccesskey") ||
    normalized.endsWith("credential") ||
    normalized.endsWith("signature")
  );
};

const ALWAYS_SECRET_QUERY_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "session_token",
  "security_token",
  "api_key",
  "api_token",
  "key",
  "signature",
  "sig",
  "credential",
  "x-amz-credential",
  "x-amz-signature",
  "x-amz-security-token",
]);

const AUTH_CONTEXT_QUERY_KEYS = new Set([
  "client_id",
  "code_challenge",
  "code_verifier",
  "redirect_uri",
  "response_type",
  "state",
]);

const normalizeQueryKey = (key: string) => {
  try {
    return decodeURIComponent(key.replace(/\+/g, " ")).toLowerCase();
  } catch {
    return key.toLowerCase();
  }
};

/**
 * Redact credentials inside URLs without treating every innocent `code` or
 * `token` query parameter as authentication material. Generic OAuth names are
 * hidden only on auth/callback URLs (or alongside presigning parameters),
 * while explicit token and X-Amz credential names are always hidden.
 */
function redactUrlQuerySecrets(rawUrl: string): string {
  const queryStart = rawUrl.indexOf("?");
  if (queryStart < 0) return rawUrl;

  const hashStart = rawUrl.indexOf("#", queryStart);
  const base = rawUrl.slice(0, queryStart);
  const query = rawUrl.slice(
    queryStart + 1,
    hashStart < 0 ? rawUrl.length : hashStart
  );
  const hash = hashStart < 0 ? "" : rawUrl.slice(hashStart);
  const parts = query.split("&");
  const names = parts.map((part) =>
    normalizeQueryKey(part.slice(0, Math.max(0, part.indexOf("="))))
  );
  const authContext =
    /\/(?:auth|authorize|callback|login|oauth2?|signin|token)(?:\/|$)/i.test(
      base
    ) ||
    names.some((name) => AUTH_CONTEXT_QUERY_KEYS.has(name)) ||
    names.some((name) => name.startsWith("x-amz-"));

  const redactedQuery = parts
    .map((part, index) => {
      const separator = part.indexOf("=");
      if (separator < 0) return part;
      const name = names[index];
      const isGenericAuthSecret =
        authContext && (name === "token" || name === "code");
      if (!ALWAYS_SECRET_QUERY_KEYS.has(name) && !isGenericAuthSecret) {
        return part;
      }
      return `${part.slice(0, separator + 1)}[redacted]`;
    })
    .join("&");

  return `${base}?${redactedQuery}${hash}`;
}

export function redactConsoleLogText(text: string): string {
  return text
    .replace(/\bhttps?:\/\/[^\s"'<>\])}]+/gi, redactUrlQuerySecrets)
    .replace(/(\b(?:Bearer|Basic)\s+)[^\s,"']+/gi, "$1[redacted]")
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      "[redacted-jwt]"
    )
    .replace(/(\bhttps?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[redacted]@")
    .replace(SECRET_VALUE_PATTERN, "$1$2[redacted]$2");
}

function sanitizeConsoleLogValueInternal(
  value: unknown,
  seen: WeakSet<object>,
  depth: number
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactConsoleLogText(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol" || typeof value === "function") {
    return String(value);
  }
  if (depth > 8) return "[Max depth]";

  if (value instanceof Error) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    const result: Record<string, unknown> = {
      name: redactConsoleLogText(value.name),
      message: redactConsoleLogText(value.message),
      stack: value.stack ? redactConsoleLogText(value.stack) : undefined,
    };
    if (value.cause !== undefined) {
      result.cause = sanitizeConsoleLogValueInternal(
        value.cause,
        seen,
        depth + 1
      );
    }
    // Axios and Node errors attach useful enumerable metadata (code, config,
    // response, syscall, path) to Error instances. Preserve it, but apply the
    // exact same recursive secret handling as regular objects.
    for (const [key, item] of Object.entries(value)) {
      if (key in result) continue;
      result[key] = isSecretLogKey(key)
        ? "[redacted]"
        : sanitizeConsoleLogValueInternal(item, seen, depth + 1);
    }
    return result;
  }

  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return redactConsoleLogText(value.toString());
  if (ArrayBuffer.isView(value)) {
    return `[${value.constructor.name} ${value.byteLength} bytes]`;
  }
  if (value instanceof ArrayBuffer) {
    return `[ArrayBuffer ${value.byteLength} bytes]`;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeConsoleLogValueInternal(item, seen, depth + 1)
    );
  }

  if (value instanceof Map) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of value) {
      const stringKey = String(key);
      result[stringKey] = isSecretLogKey(stringKey)
        ? "[redacted]"
        : sanitizeConsoleLogValueInternal(item, seen, depth + 1);
    }
    return result;
  }

  if (value instanceof Set) {
    return [...value].map((item) =>
      sanitizeConsoleLogValueInternal(item, seen, depth + 1)
    );
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = isSecretLogKey(key)
      ? "[redacted]"
      : sanitizeConsoleLogValueInternal(item, seen, depth + 1);
  }
  return result;
}

/**
 * Produce a circular-safe, loggable copy without mutating the source value.
 * This is used before every electron-log transport, so secrets never reach
 * either the on-disk logs or a development console in the first place.
 */
export function sanitizeConsoleLogValue(value: unknown): unknown {
  return sanitizeConsoleLogValueInternal(value, new WeakSet<object>(), 0);
}

export function formatConsoleLogData(values: unknown[]): string {
  const seen = new WeakSet<object>();
  const text = values
    .map((value) => {
      const normalized = sanitizeConsoleLogValueInternal(value, seen, 0);
      if (normalized === undefined) return "undefined";
      if (typeof normalized === "string") return normalized;
      try {
        return JSON.stringify(normalized);
      } catch {
        return String(normalized);
      }
    })
    .join(" ");
  return redactConsoleLogText(text);
}
