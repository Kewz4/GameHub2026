import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OverlaySupervisedLaunchPolicyInput } from "./overlay-supervised-launch-contract";
import { evaluateOverlaySupervisedLaunchPolicy } from "./overlay-supervised-launch-policy";

const executable = String.raw`C:\Games\Spider Man 2\Spider-Man2.exe`;
const sessionId = "a".repeat(32);

const createInput = (
  overrides: Partial<OverlaySupervisedLaunchPolicyInput> = {}
): OverlaySupervisedLaunchPolicyInput => ({
  runtime: {
    platform: "win32",
    isPackaged: false,
    environment: {
      GAMEHUB_READ_ONLY_VISUAL_QA: "true",
      GAMEHUB_OVERLAY_SUPERVISED_LAUNCH_QA: "true",
    },
  },
  sessionId,
  game: {
    libraryOrigin: "catalog",
    executablePath: executable,
    nativeExecutablePath: null,
    trackingExecutablePaths: [],
  },
  executablePath: executable,
  canonicalExecutablePath: executable,
  resolvedCommand: { command: executable, args: ["-windowed"], env: {} },
  workingDirectory: String.raw`C:\Games\Spider Man 2`,
  ...overrides,
});

const failureReason = (input: OverlaySupervisedLaunchPolicyInput) => {
  const result = evaluateOverlaySupervisedLaunchPolicy(input);
  assert.equal(result.allowed, false);
  return result.allowed ? null : result.reason;
};

describe("QA-only supervised overlay launch policy", () => {
  it("allows only an exact direct local executable", () => {
    const result = evaluateOverlaySupervisedLaunchPolicy(createInput());
    assert.equal(result.allowed, true);
    if (!result.allowed) return;
    assert.equal(result.plan.sessionId, sessionId);
    assert.equal(result.plan.executablePath, executable);
    assert.deepEqual(result.plan.args, ["-windowed"]);
    assert.equal(Object.isFrozen(result.plan), true);
    assert.equal(Object.isFrozen(result.plan.args), true);
  });

  it("accepts custom games and Windows path casing differences", () => {
    const result = evaluateOverlaySupervisedLaunchPolicy(
      createInput({
        game: {
          libraryOrigin: "custom",
          executablePath: executable.toUpperCase(),
          nativeExecutablePath: executable.toLowerCase(),
          trackingExecutablePaths: [executable.toUpperCase()],
        },
        executablePath: "C:/Games/Spider Man 2/Spider-Man2.exe",
      })
    );
    assert.equal(result.allowed, true);
  });

  it("requires Windows, an unpackaged build, and both exact QA gates", () => {
    assert.equal(
      failureReason(
        createInput({
          runtime: { ...createInput().runtime, platform: "linux" },
        })
      ),
      "unsupported-platform"
    );
    assert.equal(
      failureReason(
        createInput({ runtime: { ...createInput().runtime, isPackaged: true } })
      ),
      "packaged-build"
    );
    assert.equal(
      failureReason(
        createInput({
          runtime: {
            ...createInput().runtime,
            environment: {
              GAMEHUB_OVERLAY_SUPERVISED_LAUNCH_QA: "true",
            },
          },
        })
      ),
      "read-only-qa-required"
    );
    assert.equal(
      failureReason(
        createInput({
          runtime: {
            ...createInput().runtime,
            environment: {
              GAMEHUB_READ_ONLY_VISUAL_QA: "true",
            },
          },
        })
      ),
      "supervised-launch-qa-required"
    );
    assert.equal(
      failureReason(
        createInput({
          runtime: {
            ...createInput().runtime,
            environment: {
              GAMEHUB_READ_ONLY_VISUAL_QA: "TRUE",
              GAMEHUB_OVERLAY_SUPERVISED_LAUNCH_QA: "true",
            },
          },
        })
      ),
      "read-only-qa-required"
    );
  });

  it("rejects invalid or replay-friendly session identifiers", () => {
    for (const invalid of ["short", "a".repeat(129), `a${"!".repeat(31)}`]) {
      assert.equal(
        failureReason(createInput({ sessionId: invalid })),
        "invalid-session-id"
      );
    }
  });

  it("rejects synced and unstamped games", () => {
    for (const libraryOrigin of ["sync", undefined] as const) {
      assert.equal(
        failureReason(
          createInput({ game: { ...createInput().game, libraryOrigin } })
        ),
        "platform-managed-title"
      );
    }
  });

  it("rejects protocol, relative, UNC, device, batch, and root targets", () => {
    const cases: Array<[string, string]> = [
      ["steam://run/2651280", "protocol-executable"],
      [String.raw`Games\Spider-Man2.exe`, "non-local-executable"],
      [String.raw`\\server\games\Spider-Man2.exe`, "unc-or-device-path"],
      [String.raw`\\?\C:\Games\Spider-Man2.exe`, "unc-or-device-path"],
      [String.raw`\??\C:\Games\Spider-Man2.exe`, "non-local-executable"],
      [String.raw`C:\Games\launch.cmd`, "non-executable-target"],
      [String.raw`C:\Game.exe`, "drive-root-target"],
    ];
    for (const [target, reason] of cases) {
      assert.equal(
        failureReason(
          createInput({
            game: { ...createInput().game, executablePath: target },
            executablePath: target,
            canonicalExecutablePath: target,
            resolvedCommand: { command: target, args: [], env: {} },
            workingDirectory: String.raw`C:\Games`,
          })
        ),
        reason,
        target
      );
    }
  });

  it("rejects shell hosts even though they are executable files", () => {
    const shell = String.raw`C:\Windows\System32\cmd.exe`;
    assert.equal(
      failureReason(
        createInput({
          game: { ...createInput().game, executablePath: shell },
          executablePath: shell,
          canonicalExecutablePath: shell,
          resolvedCommand: { command: shell, args: [], env: {} },
          workingDirectory: String.raw`C:\Windows\System32`,
        })
      ),
      "shell-target"
    );
  });

  it("rejects a canonical or requested path unrelated to the configured game", () => {
    assert.equal(
      failureReason(
        createInput({
          canonicalExecutablePath: String.raw`C:\Windows\System32\notepad.exe`,
        })
      ),
      "unrelated-target-executable"
    );
    assert.equal(
      failureReason(
        createInput({
          executablePath: String.raw`C:\Games\Other\Other.exe`,
        })
      ),
      "unrelated-target-executable"
    );
  });

  it("rejects launcher-to-renderer handoff metadata in the direct-process slice", () => {
    assert.equal(
      failureReason(
        createInput({
          game: {
            ...createInput().game,
            nativeExecutablePath: String.raw`C:\Games\Spider Man 2\Child.exe`,
          },
        })
      ),
      "requires-child-propagation"
    );
    assert.equal(
      failureReason(
        createInput({
          game: {
            ...createInput().game,
            trackingExecutablePaths: [
              String.raw`C:\Games\Khazan\BBQ-Win64-Shipping.exe`,
            ],
          },
        })
      ),
      "requires-child-propagation"
    );
  });

  it("rejects wrappers, shells through wrappers, and a different working directory", () => {
    assert.equal(
      failureReason(
        createInput({
          resolvedCommand: {
            command: String.raw`C:\Tools\wrapper.exe`,
            args: [executable],
            env: {},
          },
        })
      ),
      "wrapper-command"
    );
    assert.equal(
      failureReason(
        createInput({ workingDirectory: String.raw`C:\Games\Other` })
      ),
      "working-directory-mismatch"
    );
  });

  it("rejects environment mutation and NUL-bearing arguments", () => {
    assert.equal(
      failureReason(
        createInput({
          resolvedCommand: {
            command: executable,
            args: [],
            env: { __COMPAT_LAYER: "RUNASADMIN" },
          },
        })
      ),
      "environment-overrides-unsupported"
    );
    assert.equal(
      failureReason(
        createInput({
          resolvedCommand: {
            command: executable,
            args: ["safe", "bad\0argument"],
            env: {},
          },
        })
      ),
      "invalid-argument"
    );
  });
});
