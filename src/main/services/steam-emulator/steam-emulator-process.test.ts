import assert from "node:assert/strict";
import { spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  releaseUnverifiedProcessHandles,
  runProcessWithTreeTimeout,
  SerializedOperationQueue,
} from "./steam-emulator-process";

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

test("serialized tool queue never overlaps operations", async () => {
  const queue = new SerializedOperationQueue();
  let active = 0;
  let maximumActive = 0;
  const order: number[] = [];

  await Promise.all(
    [1, 2, 3].map((id) =>
      queue.run(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        order.push(id);
        await delay(20);
        active -= 1;
      })
    )
  );

  assert.equal(maximumActive, 1);
  assert.deepEqual(order, [1, 2, 3]);
});

test("unverified termination releases every process handle", () => {
  const released: string[] = [];
  const child = {
    stdin: { destroy: () => released.push("stdin") },
    stdout: { destroy: () => released.push("stdout") },
    stderr: { destroy: () => released.push("stderr") },
    unref: () => released.push("process"),
  } as unknown as ChildProcess;

  releaseUnverifiedProcessHandles(child);

  assert.deepEqual(released, ["stdin", "stdout", "stderr", "process"]);
});

test(
  "Windows timeout kills and waits for the complete descendant tree",
  { skip: process.platform !== "win32", timeout: 30_000 },
  async () => {
    const scratch = fs.mkdtempSync(
      path.join(os.tmpdir(), "gamehub-steam-tree-kill-")
    );
    const pidPath = path.join(scratch, "descendant.pid");
    let descendantPid: number | null = null;
    try {
      const childSource = "setInterval(() => {}, 1000)";
      const parentSource = [
        'const { spawn } = require("node:child_process")',
        'const fs = require("node:fs")',
        `const child = spawn(process.execPath, ["-e", ${JSON.stringify(
          childSource
        )}], { stdio: "ignore" })`,
        `fs.writeFileSync(${JSON.stringify(pidPath)}, String(child.pid))`,
        "setInterval(() => {}, 1000)",
      ].join(";");

      const result = await runProcessWithTreeTimeout({
        executable: process.execPath,
        args: ["-e", parentSource],
        timeoutMs: 500,
        sanitizeOutput: (value) => value,
      });
      assert.equal(result.exitCode, null);
      assert.equal(result.terminationVerified, true);
      descendantPid = Number(fs.readFileSync(pidPath, "utf8"));

      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          process.kill(descendantPid, 0);
          await delay(100);
        } catch {
          descendantPid = null;
          break;
        }
      }
      assert.equal(descendantPid, null, "descendant process survived timeout");
    } finally {
      if (descendantPid) {
        spawnSync("taskkill.exe", ["/PID", String(descendantPid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      }
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
);
