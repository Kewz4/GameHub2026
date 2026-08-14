import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OVERLAY_SUPERVISOR_DECISION_TIMEOUT_MS,
  OVERLAY_SUPERVISOR_MAX_LINE_BYTES,
  OVERLAY_SUPERVISOR_MAX_MESSAGE_BYTES,
  OverlaySupervisorEventDecoder,
  OverlaySupervisorProtocolError,
  encodeOverlaySupervisorCommand,
  parseOverlaySupervisorCommandLine,
  parseOverlaySupervisorEventLine,
} from "./overlay-supervised-launch-protocol";

const sessionId = "a".repeat(32);
const executable = String.raw`C:\Games\Spider Man 2\Spider-Man2.exe`;

const identity = {
  sessionId,
  pid: 42,
  creationTicks: "133700000000000000",
  canonicalExecutablePath: executable,
};

const eventLine = (type: "suspended" | "resumed" | "aborted") =>
  JSON.stringify({ version: 1, type, ...identity });

const assertProtocolError = (
  operation: () => unknown,
  code: OverlaySupervisorProtocolError["code"]
) => {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof OverlaySupervisorProtocolError);
    assert.equal(error.code, code);
    return true;
  });
};

describe("overlay supervisor newline JSON protocol", () => {
  it("round-trips strict launch, commit, and abort commands", () => {
    const launch = encodeOverlaySupervisorCommand({
      version: 1,
      type: "launch",
      sessionId,
      executablePath: executable,
      args: ["-windowed", "value with spaces"],
      workingDirectory: String.raw`C:\Games\Spider Man 2`,
      decisionTimeoutMs: OVERLAY_SUPERVISOR_DECISION_TIMEOUT_MS,
    });
    assert.equal(launch.endsWith("\n"), true);
    assert.deepEqual(parseOverlaySupervisorCommandLine(launch.trimEnd()), {
      version: 1,
      type: "launch",
      sessionId,
      executablePath: executable,
      args: ["-windowed", "value with spaces"],
      workingDirectory: String.raw`C:\Games\Spider Man 2`,
      decisionTimeoutMs: OVERLAY_SUPERVISOR_DECISION_TIMEOUT_MS,
    });

    for (const command of [
      { version: 1 as const, type: "commit" as const, ...identity },
      {
        version: 1 as const,
        type: "abort" as const,
        ...identity,
        reason: "preparation-timeout",
      },
    ]) {
      const encoded = encodeOverlaySupervisorCommand(command);
      assert.deepEqual(
        parseOverlaySupervisorCommandLine(encoded.trimEnd()),
        command
      );
    }
  });

  it("decodes fragmented, batched, LF, and CRLF events", () => {
    const decoder = new OverlaySupervisorEventDecoder();
    const first = `${eventLine("suspended")}\r\n`;
    const split = Math.floor(first.length / 2);
    assert.deepEqual(decoder.push(first.slice(0, split)), []);
    assert.deepEqual(decoder.push(first.slice(split)), [
      { version: 1, type: "suspended", ...identity },
    ]);
    assert.deepEqual(
      decoder.push(`${eventLine("resumed")}\n${eventLine("aborted")}\n`),
      [
        { version: 1, type: "resumed", ...identity },
        { version: 1, type: "aborted", ...identity },
      ]
    );
    decoder.finish();
  });

  it("rejects duplicate and unknown fields before JSON can discard them", () => {
    assertProtocolError(
      () =>
        parseOverlaySupervisorEventLine(
          `{"version":1,"type":"suspended","type":"resumed","sessionId":"${sessionId}","pid":42,"creationTicks":"1","canonicalExecutablePath":"C:\\\\Games\\\\Game.exe"}`
        ),
      "duplicate-field"
    );
    assertProtocolError(
      () =>
        parseOverlaySupervisorEventLine(
          JSON.stringify({
            version: 1,
            type: "suspended",
            ...identity,
            unexpected: true,
          })
        ),
      "unknown-field"
    );
  });

  it("rejects unknown types, missing fields, arrays, and empty lines", () => {
    assertProtocolError(
      () =>
        parseOverlaySupervisorEventLine(
          JSON.stringify({ version: 1, type: "ready", ...identity })
        ),
      "invalid-schema"
    );
    assertProtocolError(
      () =>
        parseOverlaySupervisorEventLine(
          JSON.stringify({ version: 1, type: "suspended", sessionId })
        ),
      "invalid-schema"
    );
    assertProtocolError(
      () => parseOverlaySupervisorEventLine("[]"),
      "invalid-json"
    );
    const decoder = new OverlaySupervisorEventDecoder();
    assertProtocolError(() => decoder.push("\n"), "empty-line");
  });

  it("rejects invalid session, PID, FILETIME, and canonical path identities", () => {
    const invalid: Array<Record<string, unknown>> = [
      { ...identity, sessionId: "short" },
      { ...identity, pid: 4 },
      { ...identity, pid: 42.5 },
      { ...identity, creationTicks: "0" },
      { ...identity, creationTicks: "18446744073709551616" },
      { ...identity, canonicalExecutablePath: "steam://run/1" },
      {
        ...identity,
        canonicalExecutablePath: String.raw`\\server\games\Game.exe`,
      },
    ];
    for (const target of invalid) {
      assertProtocolError(
        () =>
          parseOverlaySupervisorEventLine(
            JSON.stringify({ version: 1, type: "suspended", ...target })
          ),
        "invalid-schema"
      );
    }
  });

  it("rejects oversized messages, lines, arguments, and truncated EOF", () => {
    const oversizedMessage = JSON.stringify({
      version: 1,
      type: "error",
      sessionId,
      stage: "launch",
      code: 1,
      message: "x".repeat(OVERLAY_SUPERVISOR_MAX_MESSAGE_BYTES),
    });
    assertProtocolError(
      () => parseOverlaySupervisorEventLine(oversizedMessage),
      "message-too-large"
    );

    const decoder = new OverlaySupervisorEventDecoder();
    assertProtocolError(
      () => decoder.push("x".repeat(OVERLAY_SUPERVISOR_MAX_LINE_BYTES + 1)),
      "line-too-large"
    );

    assertProtocolError(
      () =>
        encodeOverlaySupervisorCommand({
          version: 1,
          type: "launch",
          sessionId,
          executablePath: executable,
          args: ["x".repeat(4097)],
          workingDirectory: String.raw`C:\Games\Spider Man 2`,
          decisionTimeoutMs: OVERLAY_SUPERVISOR_DECISION_TIMEOUT_MS,
        }),
      "invalid-schema"
    );

    const truncated = new OverlaySupervisorEventDecoder();
    truncated.push(eventLine("suspended"));
    assertProtocolError(() => truncated.finish(), "truncated-line");
  });

  it("validates strict error events without exposing arbitrary payloads", () => {
    assert.deepEqual(
      parseOverlaySupervisorEventLine(
        JSON.stringify({
          version: 1,
          type: "error",
          sessionId,
          stage: "create-process",
          code: 740,
          message: "elevation required",
        })
      ),
      {
        version: 1,
        type: "error",
        sessionId,
        stage: "create-process",
        code: 740,
        message: "elevation required",
      }
    );
  });

  it("requires the fixed helper decision deadline", () => {
    const command = {
      version: 1,
      type: "launch",
      sessionId,
      executablePath: executable,
      args: [],
      workingDirectory: String.raw`C:\Games\Spider Man 2`,
      decisionTimeoutMs: OVERLAY_SUPERVISOR_DECISION_TIMEOUT_MS - 1,
    };
    assertProtocolError(
      () => parseOverlaySupervisorCommandLine(JSON.stringify(command)),
      "invalid-schema"
    );
  });

  it("rejects escaped lone surrogates in protocol strings", () => {
    for (const line of [
      JSON.stringify({
        version: 1,
        type: "error",
        sessionId,
        stage: "launch",
        code: 1,
        message: "\ud800",
      }),
      JSON.stringify({
        version: 1,
        type: "suspended",
        ...identity,
        canonicalExecutablePath: `${executable}\udfff`,
      }),
    ]) {
      assertProtocolError(
        () => parseOverlaySupervisorEventLine(line),
        "invalid-schema"
      );
    }

    assertProtocolError(
      () =>
        encodeOverlaySupervisorCommand({
          version: 1,
          type: "launch",
          sessionId,
          executablePath: executable,
          args: ["\ud800"],
          workingDirectory: String.raw`C:\Games\Spider Man 2`,
          decisionTimeoutMs: OVERLAY_SUPERVISOR_DECISION_TIMEOUT_MS,
        }),
      "invalid-schema"
    );
  });
});
