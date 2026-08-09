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
  /((?:^|[^\w])["']?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|authorization|api[_-]?key|api[_-]?token|password|secret|client[_-]?secret|cookie)\b["']?\s*[=:]\s*)(["']?)([^\s,"'}&]+)\2/gim;

export function redactConsoleLogText(text: string): string {
  return text
    .replace(/(\bBearer\s+)[^\s,"']+/gi, "$1[redacted]")
    .replace(/(\bhttps?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[redacted]@")
    .replace(SECRET_VALUE_PATTERN, "$1$2[redacted]$2")
    .replace(
      /([?&](?:access_token|refresh_token|id_token|token|api_key|key|signature|sig|credential|x-amz-signature|x-amz-credential)=)[^&#\s]+/gi,
      "$1[redacted]"
    );
}

function serializableLogValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol" || typeof value === "function") {
    return String(value);
  }
  if (depth > 6) return "[Max depth]";

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: serializableLogValue(value.cause, seen, depth + 1),
    };
  }

  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => serializableLogValue(item, seen, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = serializableLogValue(item, seen, depth + 1);
  }
  return result;
}

export function formatConsoleLogData(values: unknown[]): string {
  const seen = new WeakSet<object>();
  const text = values
    .map((value) => {
      if (typeof value === "string") return value;
      const normalized = serializableLogValue(value, seen, 0);
      if (normalized === undefined) return "undefined";
      try {
        return JSON.stringify(normalized);
      } catch {
        return String(normalized);
      }
    })
    .join(" ");
  return redactConsoleLogText(text);
}
