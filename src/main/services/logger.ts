import { logsPath } from "@main/constants";
import log from "electron-log";
import path from "path";
import type { ConsoleLogEntry, ConsoleLogSnapshot } from "@shared";
import { formatConsoleLogData } from "@shared";
import { sanitizeLogMessageBeforeTransport } from "./logger-sanitizer";

log.transports.file.resolvePathFn = (
  _: log.PathVariables,
  message?: log.LogMessage | undefined
) => {
  if (message?.scope === "python-rpc") {
    return path.join(logsPath, "pythonrpc.txt");
  }

  if (message?.scope === "network") {
    return path.join(logsPath, "network.txt");
  }

  if (message?.scope == "achievements") {
    return path.join(logsPath, "achievements.txt");
  }

  if (message?.level === "error") {
    return path.join(logsPath, "error.txt");
  }

  if (message?.level === "info") {
    return path.join(logsPath, "info.txt");
  }

  return path.join(logsPath, "logs.txt");
};

// electron-log serializes Error/Axios objects directly for the file
// transport. Those objects can contain request headers and account tokens far
// below the top level, so formatting-only redaction in the Shift+S window is
// too late. Sanitize a non-mutating, circular-safe copy before *any* transport
// receives the message while retaining error names, stacks and status codes.
log.hooks.push(sanitizeLogMessageBeforeTransport);

// Keep a bounded session history even while the console window is closed. The
// old sender-only transport silently discarded startup and background logs,
// which meant opening the debugger after a failure usually showed an empty
// screen. Batches cap IPC/render pressure during noisy downloads or syncs.
const CONSOLE_LOG_LIMIT = 20_000;
const CONSOLE_LOG_TEXT_BUDGET = 16 * 1024 * 1024;
const CONSOLE_LOG_ENTRY_LIMIT = 32_000;
const CONSOLE_LOG_BATCH_INTERVAL_MS = 40;
const consoleLogBuffer: ConsoleLogEntry[] = [];
let consoleLogBufferChars = 0;
let consoleLogSequence = 0;
let droppedBeforeId = 0;
let pendingConsoleBatch: ConsoleLogEntry[] = [];
let consoleBatchTimer: ReturnType<typeof setTimeout> | null = null;
let _consoleWindowSend: ((entries: ConsoleLogEntry[]) => void) | null = null;

export function setConsoleWindowSender(
  fn: ((entries: ConsoleLogEntry[]) => void) | null
) {
  _consoleWindowSend = fn;
  if (!fn) {
    pendingConsoleBatch = [];
    if (consoleBatchTimer) clearTimeout(consoleBatchTimer);
    consoleBatchTimer = null;
  }
}

export function getConsoleLogSnapshot(afterId = 0): ConsoleLogSnapshot {
  return {
    entries: consoleLogBuffer.filter((entry) => entry.id > afterId),
    latestId: consoleLogSequence,
    droppedBeforeId,
  };
}

export function clearConsoleLogBuffer(): ConsoleLogSnapshot {
  consoleLogBuffer.length = 0;
  consoleLogBufferChars = 0;
  droppedBeforeId = consoleLogSequence;
  pendingConsoleBatch = [];
  return getConsoleLogSnapshot();
}

function flushConsoleBatch() {
  consoleBatchTimer = null;
  if (!_consoleWindowSend || pendingConsoleBatch.length === 0) return;
  const batch = pendingConsoleBatch;
  pendingConsoleBatch = [];
  _consoleWindowSend(batch);
}

function scheduleConsoleBatch(entry: ConsoleLogEntry) {
  if (!_consoleWindowSend) return;
  pendingConsoleBatch.push(entry);
  if (!consoleBatchTimer) {
    consoleBatchTimer = setTimeout(
      flushConsoleBatch,
      CONSOLE_LOG_BATCH_INTERVAL_MS
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ipcTransport: any = (message: log.LogMessage) => {
  const fullText = formatConsoleLogData(message.data);
  const text =
    fullText.length > CONSOLE_LOG_ENTRY_LIMIT
      ? `${fullText.slice(0, CONSOLE_LOG_ENTRY_LIMIT)}… [diagnostics view truncated ${(
          fullText.length - CONSOLE_LOG_ENTRY_LIMIT
        ).toLocaleString()} characters; the complete entry remains in the on-disk log]`
      : fullText;
  const entry: ConsoleLogEntry = {
    id: ++consoleLogSequence,
    ts: message.date.getTime(),
    level: message.level,
    scope: (message.scope as string) || "main",
    text,
  };
  consoleLogBuffer.push(entry);
  consoleLogBufferChars += entry.text.length;

  let removeCount = Math.max(0, consoleLogBuffer.length - CONSOLE_LOG_LIMIT);
  let charsAfterRemoval = consoleLogBufferChars;
  for (
    let index = 0;
    index < consoleLogBuffer.length &&
    (index < removeCount || charsAfterRemoval > CONSOLE_LOG_TEXT_BUDGET);
    index += 1
  ) {
    charsAfterRemoval -= consoleLogBuffer[index].text.length;
    removeCount = index + 1;
  }
  if (removeCount > 0) {
    const removed = consoleLogBuffer.splice(0, removeCount);
    consoleLogBufferChars = charsAfterRemoval;
    droppedBeforeId = removed.at(-1)?.id ?? droppedBeforeId;
  }
  scheduleConsoleBatch(entry);
};
ipcTransport.level = "silly";
log.transports["consoleWindow"] = ipcTransport;

log.errorHandler.startCatching({
  showDialog: false,
});

log.initialize();

export const pythonRpcLogger = log.scope("python-rpc");
export const logger = log.scope("main");
export const achievementsLogger = log.scope("achievements");
export const networkLogger = log.scope("network");
