import path from "node:path";

import type { OverlayQaSupervisedTargetIdentity } from "./overlay-supervised-launch-contract";
import {
  isValidOverlayQaSessionId,
  normalizeOverlayQaExecutablePath,
} from "./overlay-supervised-launch-policy";

export const OVERLAY_SUPERVISOR_PROTOCOL_VERSION = 1 as const;
export const OVERLAY_SUPERVISOR_HELPER_ARGS = Object.freeze([
  "--stdio-json-v1",
] as const);
export const OVERLAY_SUPERVISOR_MAX_MESSAGE_BYTES = 32 * 1024;
export const OVERLAY_SUPERVISOR_MAX_LINE_BYTES = 64 * 1024;
export const OVERLAY_SUPERVISOR_MAX_ARGUMENTS = 128;
export const OVERLAY_SUPERVISOR_MAX_ARGUMENT_BYTES = 4 * 1024;
/** Fixed hard-stop: 5s prepare + 5s await-commit + 4s ack + 6s margin. */
export const OVERLAY_SUPERVISOR_DECISION_TIMEOUT_MS = 20_000 as const;

export type OverlaySupervisorLaunchCommand = {
  version: typeof OVERLAY_SUPERVISOR_PROTOCOL_VERSION;
  type: "launch";
  sessionId: string;
  executablePath: string;
  args: readonly string[];
  workingDirectory: string;
  decisionTimeoutMs: typeof OVERLAY_SUPERVISOR_DECISION_TIMEOUT_MS;
};

export type OverlaySupervisorCommitCommand = {
  version: typeof OVERLAY_SUPERVISOR_PROTOCOL_VERSION;
  type: "commit";
} & OverlayQaSupervisedTargetIdentity;

export type OverlaySupervisorAbortCommand = {
  version: typeof OVERLAY_SUPERVISOR_PROTOCOL_VERSION;
  type: "abort";
  reason: string;
} & OverlayQaSupervisedTargetIdentity;

export type OverlaySupervisorCommand =
  | OverlaySupervisorLaunchCommand
  | OverlaySupervisorCommitCommand
  | OverlaySupervisorAbortCommand;

export type OverlaySupervisorIdentityEvent = {
  version: typeof OVERLAY_SUPERVISOR_PROTOCOL_VERSION;
  type: "suspended" | "resumed" | "aborted";
} & OverlayQaSupervisedTargetIdentity;

export type OverlaySupervisorErrorEvent = {
  version: typeof OVERLAY_SUPERVISOR_PROTOCOL_VERSION;
  type: "error";
  sessionId: string;
  stage: string;
  code: number;
  message: string;
};

export type OverlaySupervisorEvent =
  | OverlaySupervisorIdentityEvent
  | OverlaySupervisorErrorEvent;

export type OverlaySupervisorProtocolErrorCode =
  | "line-too-large"
  | "message-too-large"
  | "truncated-line"
  | "empty-line"
  | "invalid-json"
  | "duplicate-field"
  | "unknown-field"
  | "invalid-schema";

export class OverlaySupervisorProtocolError extends Error {
  public constructor(
    public readonly code: OverlaySupervisorProtocolErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OverlaySupervisorProtocolError";
  }
}

const fail = (
  code: OverlaySupervisorProtocolErrorCode,
  message: string
): never => {
  throw new OverlaySupervisorProtocolError(code, message);
};

const byteLength = (value: string) => Buffer.byteLength(value, "utf8");
const containsNull = (value: string) => value.includes("\0");
const VOLUME_SERIAL = /^(?!0{16}$)[0-9A-F]{16}$/u;
const FILE_ID = /^(?!0{32}$)[0-9A-F]{32}$/u;

/** JSON permits escaped lone surrogates even though they are not valid UTF-8. */
const isWellFormedUnicode = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
};

const skipWhitespace = (value: string, start: number) => {
  let index = start;
  while (/\s/u.test(value[index] ?? "")) index += 1;
  return index;
};

const readJsonString = (
  value: string,
  start: number
): { value: string; next: number } => {
  if (value[start] !== '"') fail("invalid-json", "Expected an object key.");
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      const source = value.slice(start, index + 1);
      try {
        const key = JSON.parse(source) as string;
        if (!isWellFormedUnicode(key)) {
          return fail("invalid-schema", "Protocol field name is not Unicode.");
        }
        return { value: key, next: index + 1 };
      } catch {
        return fail("invalid-json", "Invalid JSON object key.");
      }
    }
  }
  return fail("invalid-json", "Unterminated JSON object key.");
};

const skipJsonValue = (value: string, start: number) => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      depth += 1;
      continue;
    }
    if (character === "}" || character === "]") {
      if (depth === 0) return index;
      depth -= 1;
      continue;
    }
    if (character === "," && depth === 0) return index;
  }
  return value.length;
};

/** JSON.parse discards duplicate properties, so reject them before parsing. */
const assertUniqueTopLevelFields = (line: string) => {
  let index = skipWhitespace(line, 0);
  if (line[index] !== "{") fail("invalid-json", "Expected a JSON object.");
  index += 1;
  const fields = new Set<string>();

  for (;;) {
    index = skipWhitespace(line, index);
    if (line[index] === "}") {
      index = skipWhitespace(line, index + 1);
      if (index !== line.length) {
        fail("invalid-json", "Unexpected data after the JSON object.");
      }
      return;
    }

    const key = readJsonString(line, index);
    if (fields.has(key.value)) {
      fail("duplicate-field", `Duplicate protocol field: ${key.value}`);
    }
    fields.add(key.value);
    index = skipWhitespace(line, key.next);
    if (line[index] !== ":") fail("invalid-json", "Expected ':' after key.");
    index = skipJsonValue(line, skipWhitespace(line, index + 1));
    index = skipWhitespace(line, index);
    if (line[index] === ",") {
      index += 1;
      continue;
    }
    if (line[index] !== "}") {
      fail("invalid-json", "Expected ',' or '}' after protocol value.");
    }
  }
};

const asObject = (line: string): Record<string, unknown> => {
  if (!isWellFormedUnicode(line)) {
    fail("invalid-json", "Overlay supervisor message is not valid Unicode.");
  }
  if (byteLength(line) > OVERLAY_SUPERVISOR_MAX_MESSAGE_BYTES) {
    fail("message-too-large", "Overlay supervisor message exceeded its limit.");
  }
  assertUniqueTopLevelFields(line);
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    fail("invalid-json", "Overlay supervisor sent invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("invalid-schema", "Overlay supervisor message must be an object.");
  }
  for (const item of Object.values(parsed as Record<string, unknown>)) {
    if (typeof item === "string" && !isWellFormedUnicode(item)) {
      fail("invalid-schema", "Protocol string is not valid Unicode.");
    }
    if (
      Array.isArray(item) &&
      item.some(
        (member) => typeof member === "string" && !isWellFormedUnicode(member)
      )
    ) {
      fail("invalid-schema", "Protocol array string is not valid Unicode.");
    }
  }
  return parsed as Record<string, unknown>;
};

const assertExactFields = (
  value: Record<string, unknown>,
  expected: readonly string[]
) => {
  const expectedFields = new Set(expected);
  for (const field of Object.keys(value)) {
    if (!expectedFields.has(field)) {
      fail("unknown-field", `Unknown protocol field: ${field}`);
    }
  }
  if (Object.keys(value).length !== expected.length) {
    fail("invalid-schema", "Protocol message is missing a required field.");
  }
};

const assertVersionAndSession = (value: Record<string, unknown>) => {
  if (value.version !== OVERLAY_SUPERVISOR_PROTOCOL_VERSION) {
    fail("invalid-schema", "Unsupported supervisor protocol version.");
  }
  if (
    typeof value.sessionId !== "string" ||
    !isValidOverlayQaSessionId(value.sessionId)
  ) {
    fail("invalid-schema", "Invalid supervisor session identifier.");
  }
};

const parseCreationTicks = (value: unknown): string => {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) {
    fail("invalid-schema", "Invalid process FILETIME identity.");
  }
  const creationTicks = value as string;
  try {
    if (BigInt(creationTicks) > 0xffff_ffff_ffff_ffffn) {
      fail("invalid-schema", "Process FILETIME identity is out of range.");
    }
  } catch {
    fail("invalid-schema", "Invalid process FILETIME identity.");
  }
  return creationTicks;
};

const parseIdentity = (
  value: Record<string, unknown>
): OverlayQaSupervisedTargetIdentity => {
  assertVersionAndSession(value);
  if (
    typeof value.pid !== "number" ||
    !Number.isInteger(value.pid) ||
    value.pid <= 4 ||
    value.pid > 0xffff_ffff
  ) {
    fail("invalid-schema", "Invalid supervised process PID.");
  }
  const pid = value.pid as number;
  const creationTicks = parseCreationTicks(value.creationTicks);
  if (typeof value.canonicalExecutablePath !== "string") {
    fail("invalid-schema", "Invalid canonical executable path.");
  }
  const untrustedPath = value.canonicalExecutablePath as string;
  if (!isWellFormedUnicode(untrustedPath)) {
    fail("invalid-schema", "Canonical executable path is not valid Unicode.");
  }
  const canonicalExecutablePath =
    normalizeOverlayQaExecutablePath(untrustedPath);
  if (!canonicalExecutablePath) {
    return fail("invalid-schema", "Invalid canonical executable path.");
  }
  if (
    typeof value.volumeSerial !== "string" ||
    !VOLUME_SERIAL.test(value.volumeSerial) ||
    typeof value.fileId !== "string" ||
    !FILE_ID.test(value.fileId)
  ) {
    return fail("invalid-schema", "Invalid pinned executable file identity.");
  }
  return {
    sessionId: value.sessionId as string,
    pid,
    creationTicks,
    canonicalExecutablePath,
    volumeSerial: value.volumeSerial,
    fileId: value.fileId,
  };
};

const parseArguments = (value: unknown): readonly string[] => {
  if (
    !Array.isArray(value) ||
    value.length > OVERLAY_SUPERVISOR_MAX_ARGUMENTS
  ) {
    fail("invalid-schema", "Invalid supervised launch argument list.");
  }
  const args = (value as unknown[]).map((argument) => {
    if (
      typeof argument !== "string" ||
      !isWellFormedUnicode(argument) ||
      containsNull(argument) ||
      byteLength(argument) > OVERLAY_SUPERVISOR_MAX_ARGUMENT_BYTES
    ) {
      fail("invalid-schema", "Invalid supervised launch argument.");
    }
    return argument as string;
  });
  return Object.freeze(args);
};

export const parseOverlaySupervisorCommandLine = (
  line: string
): OverlaySupervisorCommand => {
  const value = asObject(line);
  if (typeof value.type !== "string") {
    fail("invalid-schema", "Missing supervisor command type.");
  }
  const messageType = value.type as string;

  if (messageType === "launch") {
    assertExactFields(value, [
      "version",
      "type",
      "sessionId",
      "executablePath",
      "args",
      "workingDirectory",
      "decisionTimeoutMs",
    ]);
    assertVersionAndSession(value);
    if (typeof value.executablePath !== "string") {
      fail("invalid-schema", "Invalid launch executable path.");
    }
    const untrustedExecutablePath = value.executablePath as string;
    if (!isWellFormedUnicode(untrustedExecutablePath)) {
      return fail(
        "invalid-schema",
        "Launch executable path is not valid Unicode."
      );
    }
    const executablePath = normalizeOverlayQaExecutablePath(
      untrustedExecutablePath
    );
    if (!executablePath) {
      return fail("invalid-schema", "Invalid launch executable path.");
    }
    if (
      typeof value.workingDirectory !== "string" ||
      !isWellFormedUnicode(value.workingDirectory as string) ||
      containsNull(value.workingDirectory as string) ||
      path.win32.normalize(value.workingDirectory as string).toLowerCase() !==
        path.win32.dirname(executablePath).toLowerCase()
    ) {
      fail("invalid-schema", "Invalid launch working directory.");
    }
    if (value.decisionTimeoutMs !== OVERLAY_SUPERVISOR_DECISION_TIMEOUT_MS) {
      fail("invalid-schema", "Invalid supervisor decision timeout.");
    }
    return Object.freeze({
      version: OVERLAY_SUPERVISOR_PROTOCOL_VERSION,
      type: "launch",
      sessionId: value.sessionId as string,
      executablePath,
      args: parseArguments(value.args),
      workingDirectory: path.win32.dirname(executablePath),
      decisionTimeoutMs: OVERLAY_SUPERVISOR_DECISION_TIMEOUT_MS,
    });
  }

  if (messageType === "commit" || messageType === "abort") {
    assertExactFields(
      value,
      messageType === "abort"
        ? [
            "version",
            "type",
            "sessionId",
            "pid",
            "creationTicks",
            "canonicalExecutablePath",
            "volumeSerial",
            "fileId",
            "reason",
          ]
        : [
            "version",
            "type",
            "sessionId",
            "pid",
            "creationTicks",
            "canonicalExecutablePath",
            "volumeSerial",
            "fileId",
          ]
    );
    const parsedIdentity = parseIdentity(value);
    if (messageType === "abort") {
      if (
        typeof value.reason !== "string" ||
        !isWellFormedUnicode(value.reason as string) ||
        value.reason.length === 0 ||
        value.reason.length > 128 ||
        containsNull(value.reason)
      ) {
        fail("invalid-schema", "Invalid supervisor abort reason.");
      }
      const reason = value.reason as string;
      return Object.freeze({
        version: OVERLAY_SUPERVISOR_PROTOCOL_VERSION,
        type: "abort",
        ...parsedIdentity,
        reason,
      });
    }
    return Object.freeze({
      version: OVERLAY_SUPERVISOR_PROTOCOL_VERSION,
      type: "commit",
      ...parsedIdentity,
    });
  }

  return fail("invalid-schema", "Unknown supervisor command type.");
};

export const parseOverlaySupervisorEventLine = (
  line: string
): OverlaySupervisorEvent => {
  const value = asObject(line);
  if (typeof value.type !== "string") {
    fail("invalid-schema", "Missing supervisor event type.");
  }
  const messageType = value.type as string;
  if (["suspended", "resumed", "aborted"].includes(messageType)) {
    assertExactFields(value, [
      "version",
      "type",
      "sessionId",
      "pid",
      "creationTicks",
      "canonicalExecutablePath",
      "volumeSerial",
      "fileId",
    ]);
    return Object.freeze({
      version: OVERLAY_SUPERVISOR_PROTOCOL_VERSION,
      type: messageType as "suspended" | "resumed" | "aborted",
      ...parseIdentity(value),
    });
  }
  if (messageType === "error") {
    assertExactFields(value, [
      "version",
      "type",
      "sessionId",
      "stage",
      "code",
      "message",
    ]);
    assertVersionAndSession(value);
    if (
      typeof value.stage !== "string" ||
      !/^[a-z][a-z\d-]{0,63}$/u.test(value.stage) ||
      typeof value.code !== "number" ||
      !Number.isInteger(value.code) ||
      value.code < 0 ||
      value.code > 0xffff_ffff ||
      typeof value.message !== "string" ||
      !isWellFormedUnicode(value.message as string) ||
      containsNull(value.message) ||
      byteLength(value.message) > 1024
    ) {
      fail("invalid-schema", "Invalid supervisor error event.");
    }
    const stage = value.stage as string;
    const code = value.code as number;
    const message = value.message as string;
    return Object.freeze({
      version: OVERLAY_SUPERVISOR_PROTOCOL_VERSION,
      type: "error",
      sessionId: value.sessionId as string,
      stage,
      code,
      message,
    });
  }
  return fail("invalid-schema", "Unknown supervisor event type.");
};

export const encodeOverlaySupervisorCommand = (
  command: OverlaySupervisorCommand
) => {
  // Round-trip through the strict command parser so callers cannot bypass the
  // runtime schema with an `as` cast or an object carrying extra properties.
  const serialized = JSON.stringify(command);
  const parsed = parseOverlaySupervisorCommandLine(serialized);
  const line = `${JSON.stringify(parsed)}\n`;
  if (byteLength(line) > OVERLAY_SUPERVISOR_MAX_LINE_BYTES) {
    fail("line-too-large", "Encoded supervisor command exceeded its limit.");
  }
  return line;
};

export class OverlaySupervisorEventDecoder {
  private buffer = "";

  public push(chunk: string): OverlaySupervisorEvent[] {
    this.buffer += chunk;
    if (
      !this.buffer.includes("\n") &&
      byteLength(this.buffer) > OVERLAY_SUPERVISOR_MAX_LINE_BYTES
    ) {
      fail("line-too-large", "Supervisor protocol line exceeded its limit.");
    }

    const events: OverlaySupervisorEvent[] = [];
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (byteLength(line) > OVERLAY_SUPERVISOR_MAX_LINE_BYTES) {
        fail("line-too-large", "Supervisor protocol line exceeded its limit.");
      }
      if (!line.length) fail("empty-line", "Empty supervisor protocol line.");
      events.push(parseOverlaySupervisorEventLine(line));
    }
    if (byteLength(this.buffer) > OVERLAY_SUPERVISOR_MAX_LINE_BYTES) {
      fail("line-too-large", "Supervisor protocol line exceeded its limit.");
    }
    return events;
  }

  public finish() {
    if (this.buffer.length > 0) {
      this.buffer = "";
      fail("truncated-line", "Supervisor output ended mid-message.");
    }
  }
}
