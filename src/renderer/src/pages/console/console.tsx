import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDownIcon,
  DownloadIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  TrashIcon,
} from "@primer/octicons-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  CONSOLE_LOG_CHANNELS,
  CONSOLE_OTHER_CHANNEL,
  consoleLogChannelOf,
  type ConsoleLogEntry,
} from "@shared";

import "./console.scss";

const MAX_VISIBLE_HISTORY = 20_000;
const MAX_COLLAPSED_LOG_CHARS = 1_200;

const LEVEL_COLORS: Record<string, string> = {
  error: "#ff6b6b",
  warn: "#f2b84b",
  info: "#f5f5f5",
  verbose: "#c8c8c8",
  debug: "#9a9a9a",
  silly: "#747474",
};

const mergeEntries = (
  current: ConsoleLogEntry[],
  incoming: ConsoleLogEntry[]
): ConsoleLogEntry[] => {
  if (incoming.length === 0) return current;
  const latest = current.at(-1)?.id ?? 0;
  if (incoming.every((entry) => entry.id > latest)) {
    return [...current, ...incoming].slice(-MAX_VISIBLE_HISTORY);
  }

  const merged = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) merged.set(entry.id, entry);
  return [...merged.values()]
    .sort((left, right) => left.id - right.id)
    .slice(-MAX_VISIBLE_HISTORY);
};

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return (
    date.getHours().toString().padStart(2, "0") +
    ":" +
    date.getMinutes().toString().padStart(2, "0") +
    ":" +
    date.getSeconds().toString().padStart(2, "0") +
    "." +
    date.getMilliseconds().toString().padStart(3, "0")
  );
};

export default function ConsolePage() {
  const [entries, setEntries] = useState<ConsoleLogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter.trim().toLowerCase());
  const [levelFilter, setLevelFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [streamPaused, setStreamPaused] = useState(false);
  const [pausedCount, setPausedCount] = useState(0);
  const [droppedBeforeId, setDroppedBeforeId] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [expandedEntryIds, setExpandedEntryIds] = useState<Set<number>>(
    () => new Set()
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pausedRef = useRef(false);
  const pausedEntriesRef = useRef<ConsoleLogEntry[]>([]);

  const acceptBatch = useCallback((batch: ConsoleLogEntry[]) => {
    if (pausedRef.current) {
      pausedEntriesRef.current = mergeEntries(pausedEntriesRef.current, batch);
      setPausedCount(pausedEntriesRef.current.length);
      return;
    }
    setEntries((current) => mergeEntries(current, batch));
  }, []);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = window.electron.onConsoleLogs((batch) => {
      if (!disposed) acceptBatch(batch);
    });

    window.electron
      .getConsoleLogSnapshot()
      .then((snapshot) => {
        if (disposed) return;
        setDroppedBeforeId(snapshot.droppedBeforeId);
        acceptBatch(snapshot.entries);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [acceptBatch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "Escape") {
        void window.electron.toggleConsoleWindow();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const tagged = useMemo(
    () =>
      entries.map((entry) => ({ entry, channel: consoleLogChannelOf(entry) })),
    [entries]
  );

  const matchesTextAndLevel = useCallback(
    (entry: ConsoleLogEntry) => {
      if (levelFilter !== "all" && entry.level !== levelFilter) return false;
      if (!deferredFilter) return true;
      return (
        entry.text.toLowerCase().includes(deferredFilter) ||
        entry.scope.toLowerCase().includes(deferredFilter) ||
        entry.level.toLowerCase().includes(deferredFilter)
      );
    },
    [deferredFilter, levelFilter]
  );

  const counts = useMemo(() => {
    const result: Record<string, number> = {
      all: 0,
      [CONSOLE_OTHER_CHANNEL]: 0,
    };
    for (const channel of CONSOLE_LOG_CHANNELS) result[channel.id] = 0;
    for (const { entry, channel } of tagged) {
      if (!matchesTextAndLevel(entry)) continue;
      result.all += 1;
      result[channel] = (result[channel] ?? 0) + 1;
    }
    return result;
  }, [matchesTextAndLevel, tagged]);

  const filtered = useMemo(
    () =>
      tagged
        .filter(
          ({ entry, channel }) =>
            (activeTab === "all" || channel === activeTab) &&
            matchesTextAndLevel(entry)
        )
        .map(({ entry }) => entry),
    [activeTab, matchesTextAndLevel, tagged]
  );

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 24,
    overscan: 24,
  });

  useEffect(() => {
    if (autoScroll && filtered.length > 0) {
      virtualizer.scrollToIndex(filtered.length - 1, { align: "end" });
    }
  }, [autoScroll, filtered.length, virtualizer]);

  const handleScroll = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    const atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    setAutoScroll(atBottom);
  }, []);

  const togglePaused = useCallback(() => {
    setStreamPaused((current) => {
      const next = !current;
      pausedRef.current = next;
      if (!next && pausedEntriesRef.current.length > 0) {
        const pending = pausedEntriesRef.current;
        pausedEntriesRef.current = [];
        setPausedCount(0);
        setEntries((entriesNow) => mergeEntries(entriesNow, pending));
      }
      return next;
    });
  }, []);

  const toggleExpanded = useCallback((id: number) => {
    setExpandedEntryIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const tabs = useMemo(
    () => [
      { id: "all", label: "All" },
      ...CONSOLE_LOG_CHANNELS.map(({ id, label }) => ({ id, label })),
      { id: CONSOLE_OTHER_CHANNEL, label: "Other" },
    ],
    []
  );

  const errorCount = entries.filter((entry) => entry.level === "error").length;
  const warningCount = entries.filter((entry) => entry.level === "warn").length;

  return (
    <main className="console">
      <header className="console__header">
        <div className="console__heading">
          <span className="console__eyebrow">GAMEHUB</span>
          <div>
            <h1 className="console__title">Diagnostics</h1>
            <p className="console__subtitle">
              Live session logs, retained while this window is closed
            </p>
          </div>
        </div>

        <div className="console__stats" aria-label="Log summary">
          <span>{entries.length.toLocaleString()} entries</span>
          <span className="console__stat--warn">{warningCount} warnings</span>
          <span className="console__stat--error">{errorCount} errors</span>
        </div>
      </header>

      <div className="console__toolbar">
        <label className="console__search">
          <SearchIcon size={15} aria-hidden="true" />
          <input
            ref={searchRef}
            placeholder="Search message, scope, or level…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label="Search diagnostics"
          />
          <kbd>Ctrl F</kbd>
        </label>

        <select
          className="console__level-select"
          value={levelFilter}
          onChange={(event) => setLevelFilter(event.target.value)}
          aria-label="Filter by log level"
        >
          <option value="all">All levels</option>
          <option value="error">Errors</option>
          <option value="warn">Warnings</option>
          <option value="info">Info</option>
          <option value="verbose">Verbose</option>
          <option value="debug">Debug</option>
          <option value="silly">Silly</option>
        </select>

        <div className="console__actions">
          <button
            type="button"
            className={streamPaused ? "console__action--active" : undefined}
            onClick={togglePaused}
            title={streamPaused ? "Resume live updates" : "Pause live updates"}
          >
            {streamPaused ? <PlayIcon /> : <PauseIcon />}
            <span>{streamPaused ? "Resume" : "Pause"}</span>
          </button>
          <button
            type="button"
            disabled={exporting || entries.length === 0}
            onClick={async () => {
              setExporting(true);
              await window.electron.exportConsoleLogs().catch(() => undefined);
              setExporting(false);
            }}
            title="Export the redacted session log"
          >
            <DownloadIcon />
            <span>{exporting ? "Exporting…" : "Export"}</span>
          </button>
          <button
            type="button"
            disabled={entries.length === 0}
            onClick={async () => {
              await window.electron.clearConsoleLogs().catch(() => undefined);
              pausedEntriesRef.current = [];
              setPausedCount(0);
              setExpandedEntryIds(new Set());
              setEntries([]);
            }}
            title="Clear retained session logs"
          >
            <TrashIcon />
            <span>Clear</span>
          </button>
          <button
            type="button"
            className={autoScroll ? "console__action--active" : undefined}
            disabled={filtered.length === 0}
            onClick={() => {
              setAutoScroll(true);
              if (filtered.length > 0) {
                virtualizer.scrollToIndex(filtered.length - 1, {
                  align: "end",
                });
              }
            }}
            title="Follow the newest matching log"
          >
            <ArrowDownIcon />
            <span>Latest</span>
          </button>
        </div>
      </div>

      <nav className="console__tabs" aria-label="Diagnostic categories">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={
              activeTab === tab.id ? "console__tab--active" : undefined
            }
            onClick={() => setActiveTab(tab.id)}
            aria-pressed={activeTab === tab.id}
          >
            <span>{tab.label}</span>
            <span className="console__tab-count">{counts[tab.id] ?? 0}</span>
          </button>
        ))}
      </nav>

      <div
        className="console__body"
        ref={containerRef}
        onScroll={handleScroll}
        role="log"
        aria-label="GameHub diagnostic log"
      >
        {filtered.length === 0 ? (
          <div className="console__empty">
            <strong>No matching logs</strong>
            <span>Adjust the category, level, or search filter.</span>
          </div>
        ) : (
          <div
            className="console__virtual-list"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const entry = filtered[item.index];
              const isLong = entry.text.length > MAX_COLLAPSED_LOG_CHARS;
              const isExpanded = expandedEntryIds.has(entry.id);
              const displayedText =
                isLong && !isExpanded
                  ? `${entry.text.slice(0, MAX_COLLAPSED_LOG_CHARS)}…`
                  : entry.text;
              return (
                <div
                  key={entry.id}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className={`console__line console__line--${entry.level}`}
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <time
                    className="console__ts"
                    dateTime={new Date(entry.ts).toISOString()}
                  >
                    {formatTime(entry.ts)}
                  </time>
                  <span className="console__scope" title={entry.scope}>
                    {entry.scope}
                  </span>
                  <span
                    className="console__level"
                    style={{ color: LEVEL_COLORS[entry.level] ?? "#a8a8a8" }}
                  >
                    {entry.level.toUpperCase()}
                  </span>
                  {isLong ? (
                    <button
                      type="button"
                      className="console__text console__text--expandable"
                      aria-expanded={isExpanded}
                      onClick={() => toggleExpanded(entry.id)}
                      title={
                        isExpanded
                          ? "Collapse this log entry"
                          : "Expand the retained text; complete oversized payloads remain in GameHub's on-disk logs"
                      }
                    >
                      {displayedText}
                      <span className="console__text-hint">
                        {isExpanded
                          ? "Collapse"
                          : `Show ${(
                              entry.text.length - MAX_COLLAPSED_LOG_CHARS
                            ).toLocaleString()} more characters`}
                      </span>
                    </button>
                  ) : (
                    <span className="console__text">{displayedText}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <footer className="console__statusbar">
        <span>
          Showing {filtered.length.toLocaleString()} of{" "}
          {entries.length.toLocaleString()}
        </span>
        {streamPaused && (
          <span className="console__paused">
            Live updates paused{pausedCount ? ` · ${pausedCount} buffered` : ""}
          </span>
        )}
        {!streamPaused && !autoScroll && (
          <span className="console__paused">
            Following paused while reviewing
          </span>
        )}
        {droppedBeforeId > 0 && (
          <span title="The oldest entries were removed to keep the console fast">
            Bounded history active
          </span>
        )}
        <span className="console__shortcut">Shift S · toggle</span>
      </footer>
    </main>
  );
}
