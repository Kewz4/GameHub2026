import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import "./console.scss";

interface LogEntry {
  ts: number;
  level: string;
  scope: string;
  text: string;
}

const LEVEL_COLORS: Record<string, string> = {
  error: "#f87171",
  warn: "#fb923c",
  info: "#60a5fa",
  verbose: "#a78bfa",
  debug: "#94a3b8",
  silly: "#64748b",
};

/**
 * Log "channels" — the console groups every entry into one of these subsystem
 * tabs so OS/cloud syncs, mod-manager work, achievement syncs, downloads, etc.
 * each read on their own tab instead of one interleaved stream. An entry is
 * routed by its logger scope first, then by a leading `[tag]` in its text.
 */
interface Channel {
  id: string;
  label: string;
  /** electron-log scopes that map here. */
  scopes?: string[];
  /** `[tag]` prefixes (lower-cased, without brackets) that map here. */
  tags?: string[];
}

const CHANNELS: Channel[] = [
  {
    id: "mods",
    label: "Mod Manager",
    tags: ["ukmm", "mods", "botw-mod", "gamebanana", "bcml"],
  },
  {
    id: "cloud",
    label: "Cloud Saves",
    tags: ["cloud", "cloud-sync", "ludusavi", "save-sync", "saves", "sync"],
  },
  {
    id: "achievements",
    label: "Achievements",
    scopes: ["achievements"],
    tags: ["achievement", "achievements"],
  },
  {
    id: "downloads",
    label: "Downloads",
    tags: ["minerva", "download", "downloads", "torrent", "debrid", "http"],
  },
  {
    id: "emulators",
    label: "Emulators",
    tags: ["emulator", "emulators", "cemu", "rpcs3", "dolphin", "rom", "roms"],
  },
  {
    id: "network",
    label: "Network",
    scopes: ["network"],
  },
  {
    id: "python-rpc",
    label: "Python RPC",
    scopes: ["python-rpc"],
  },
];

const OTHER_CHANNEL = "other";

/** Extract a leading `[tag]` (lower-cased) from a log line, if present. */
function leadingTag(text: string): string | null {
  const m = text.match(/^\s*\[([a-z0-9_-]+)\]/i);
  return m ? m[1].toLowerCase() : null;
}

/** Route an entry to a channel id by scope, then by its `[tag]` prefix. */
function channelOf(entry: LogEntry): string {
  const scope = (entry.scope || "").toLowerCase();
  for (const ch of CHANNELS) {
    if (ch.scopes?.includes(scope)) return ch.id;
  }
  const tag = leadingTag(entry.text);
  if (tag) {
    for (const ch of CHANNELS) {
      if (ch.tags?.includes(tag)) return ch.id;
    }
  }
  // A meaningful non-"main" scope becomes its own catch tag under Other, but we
  // still surface it in Other so nothing is ever hidden.
  return OTHER_CHANNEL;
}

function fmt(ts: number) {
  const d = new Date(ts);
  return (
    d.getHours().toString().padStart(2, "0") +
    ":" +
    d.getMinutes().toString().padStart(2, "0") +
    ":" +
    d.getSeconds().toString().padStart(2, "0") +
    "." +
    d.getMilliseconds().toString().padStart(3, "0")
  );
}

export default function ConsolePage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<string>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = window.electron.onConsoleLog((entry: LogEntry) => {
      setEntries((prev) => {
        const next = [...prev, entry];
        return next.length > 5000 ? next.slice(-5000) : next;
      });
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [entries, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  }, []);

  // Tag every entry with its channel once (memoised on the entries array).
  const tagged = useMemo(
    () => entries.map((e) => ({ e, channel: channelOf(e) })),
    [entries]
  );

  // Per-channel counts for the tab badges (respecting level/text filters so the
  // badge reflects what you'd actually see).
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, [OTHER_CHANNEL]: 0 };
    for (const ch of CHANNELS) c[ch.id] = 0;
    const q = filter.toLowerCase();
    for (const { e, channel } of tagged) {
      if (levelFilter !== "all" && e.level !== levelFilter) continue;
      if (
        q &&
        !e.text.toLowerCase().includes(q) &&
        !e.scope.toLowerCase().includes(q)
      )
        continue;
      c.all += 1;
      c[channel] = (c[channel] ?? 0) + 1;
    }
    return c;
  }, [tagged, levelFilter, filter]);

  const filtered = tagged.filter(({ e, channel }) => {
    if (activeTab !== "all" && channel !== activeTab) return false;
    if (levelFilter !== "all" && e.level !== levelFilter) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return (
        e.text.toLowerCase().includes(q) || e.scope.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const tabs: { id: string; label: string }[] = [
    { id: "all", label: "All" },
    ...CHANNELS.map((c) => ({ id: c.id, label: c.label })),
    { id: OTHER_CHANNEL, label: "Other" },
  ];

  return (
    <div className="console">
      <div className="console__toolbar">
        <span className="console__title">Debug Console</span>
        <select
          className="console__level-select"
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
        >
          <option value="all">All levels</option>
          <option value="error">error</option>
          <option value="warn">warn</option>
          <option value="info">info</option>
          <option value="verbose">verbose</option>
          <option value="debug">debug</option>
          <option value="silly">silly</option>
        </select>
        <input
          className="console__filter"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          className="console__clear-btn"
          onClick={() => setEntries([])}
          type="button"
        >
          Clear
        </button>
        <button
          className={`console__scroll-btn ${autoScroll ? "console__scroll-btn--active" : ""}`}
          onClick={() => {
            setAutoScroll(true);
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
          type="button"
          title="Scroll to bottom"
        >
          ↓
        </button>
      </div>

      <div className="console__tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`console__tab ${activeTab === tab.id ? "console__tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            <span className="console__tab-count">{counts[tab.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="console__body" ref={containerRef} onScroll={handleScroll}>
        {filtered.map(({ e }, i) => (
          <div key={i} className={`console__line console__line--${e.level}`}>
            <span className="console__ts">{fmt(e.ts)}</span>
            <span className="console__scope">[{e.scope}]</span>
            <span
              className="console__level"
              style={{ color: LEVEL_COLORS[e.level] ?? "#94a3b8" }}
            >
              {e.level.toUpperCase()}
            </span>
            <span className="console__text">{e.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="console__statusbar">
        {filtered.length} / {entries.length} entries
        {!autoScroll && (
          <span className="console__paused"> — scrolling paused</span>
        )}
      </div>
    </div>
  );
}
