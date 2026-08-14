import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export interface ProcessRunResult {
  exitCode: number | null;
  output: string;
  /** Present for timeouts; false quarantines all later tool mutations. */
  terminationVerified?: boolean;
}

export interface ProcessRunOptions {
  executable: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  sanitizeOutput: (output: string) => string;
  onTimeout?: () => void;
  onError?: (error: unknown) => void;
}

/** A failure-tolerant FIFO used to guard one shared CLI workspace. */
export class SerializedOperationQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

const waitForProcessClose = (
  child: ChildProcess,
  timeoutMs: number
): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (closed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off("close", onClose);
      resolve(closed);
    };
    const onClose = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    child.once("close", onClose);
  });
};

/**
 * A failed kill must not leave a referenced process or stdio pipe keeping the
 * launcher (or its test worker) alive forever. This does not claim that the
 * process was terminated: callers still return `terminationVerified: false`
 * and quarantine later emulator-tool mutations.
 */
export const releaseUnverifiedProcessHandles = (child: ChildProcess): void => {
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    try {
      stream?.destroy();
    } catch {
      // Continue releasing the remaining handles.
    }
  }
  try {
    child.unref();
  } catch {
    // The process may already have disposed its native handle.
  }
};

/** Kill the complete process tree and wait before allowing another mutation. */
interface WindowsProcessIdentity {
  pid: number;
  parentPid: number;
  creationDate: string;
}

const PROCESS_HELPER_TIMEOUT_MS = 5_000;

const parseWmicProcessSnapshot = (output: string): WindowsProcessIdentity[] => {
  const identities: WindowsProcessIdentity[] = [];
  let current: Partial<WindowsProcessIdentity> = {};
  const flush = () => {
    if (
      Number.isInteger(current.pid) &&
      Number.isInteger(current.parentPid) &&
      current.creationDate
    ) {
      identities.push(current as WindowsProcessIdentity);
    }
    current = {};
  };

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      if (current.pid !== undefined) flush();
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === "ProcessId") current.pid = Number(value);
    if (key === "ParentProcessId") current.parentPid = Number(value);
    if (key === "CreationDate") current.creationDate = value;
  }
  flush();
  return identities;
};

const collectWindowsProcessSnapshot = (): Promise<
  WindowsProcessIdentity[] | null
> => {
  const wmicPath = path.join(
    process.env.WINDIR || "C:\\Windows",
    "System32",
    "wbem",
    "WMIC.exe"
  );
  const useWmic = existsSync(wmicPath);
  const script = [
    "$ErrorActionPreference='Stop'",
    "Get-CimInstance Win32_Process -OperationTimeoutSec 3 | ForEach-Object {",
    "  [Console]::Out.WriteLine(('{0}|{1}|{2}' -f $_.ProcessId,$_.ParentProcessId,$_.CreationDate.ToString('o')))",
    "}",
  ].join(";");

  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const finish = (result: WindowsProcessIdentity[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    let processList: ChildProcess;
    try {
      processList = spawn(
        useWmic ? wmicPath : "powershell.exe",
        useWmic
          ? [
              "process",
              "get",
              "ProcessId,ParentProcessId,CreationDate",
              "/value",
            ]
          : ["-NoProfile", "-NonInteractive", "-Command", script],
        {
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        }
      );
    } catch {
      resolve(null);
      return;
    }
    const timeout = setTimeout(() => {
      try {
        processList.kill("SIGKILL");
      } catch {
        // Ignore exit races.
      }
      releaseUnverifiedProcessHandles(processList);
      finish(null);
    }, PROCESS_HELPER_TIMEOUT_MS);
    processList.stdout?.on("data", (chunk) => {
      output = `${output}${String(chunk)}`.slice(-2_000_000);
    });
    processList.once("error", () => {
      releaseUnverifiedProcessHandles(processList);
      finish(null);
    });
    processList.once("close", (code) => {
      if (code !== 0) return finish(null);
      const identities = useWmic
        ? parseWmicProcessSnapshot(output)
        : output
            .split(/\r?\n/)
            .map((line) => line.trim().split("|"))
            .filter((parts) => parts.length === 3)
            .map(([pid, parentPid, creationDate]) => ({
              pid: Number(pid),
              parentPid: Number(parentPid),
              creationDate,
            }))
            .filter(
              (identity) =>
                Number.isInteger(identity.pid) &&
                Number.isInteger(identity.parentPid) &&
                Boolean(identity.creationDate)
            );
      finish(identities);
    });
  });
};

const descendantsOf = (rootPid: number, snapshot: WindowsProcessIdentity[]) => {
  const selected = new Map<number, WindowsProcessIdentity>();
  const pending = [rootPid];
  while (pending.length) {
    const parentPid = pending.pop()!;
    for (const identity of snapshot) {
      if (identity.parentPid !== parentPid || selected.has(identity.pid)) {
        continue;
      }
      selected.set(identity.pid, identity);
      pending.push(identity.pid);
    }
  }
  const root = snapshot.find((identity) => identity.pid === rootPid);
  if (root) selected.set(root.pid, root);
  return [...selected.values()];
};

const runTaskkill = (pid: number): Promise<boolean> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(success);
    };
    let taskkill: ChildProcess;
    try {
      taskkill = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      resolve(false);
      return;
    }
    const timeout = setTimeout(() => {
      try {
        taskkill.kill("SIGKILL");
      } catch {
        // Ignore exit races.
      }
      releaseUnverifiedProcessHandles(taskkill);
      finish(false);
    }, PROCESS_HELPER_TIMEOUT_MS);
    taskkill.once("error", () => {
      releaseUnverifiedProcessHandles(taskkill);
      finish(false);
    });
    taskkill.once("close", (code) => finish(code === 0));
  });

export const terminateProcessTree = async (
  child: ChildProcess
): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return true;

  if (process.platform === "win32" && child.pid) {
    const before = await collectWindowsProcessSnapshot();
    const identities = before ? descendantsOf(child.pid, before) : null;
    const taskkillSucceeded = await runTaskkill(child.pid);
    const parentClosed = await waitForProcessClose(
      child,
      PROCESS_HELPER_TIMEOUT_MS
    );
    const after = await collectWindowsProcessSnapshot();
    if (!identities || !after) {
      releaseUnverifiedProcessHandles(child);
      return false;
    }
    const survivors = identities.filter((identity) =>
      after.some(
        (candidate) =>
          candidate.pid === identity.pid &&
          candidate.creationDate === identity.creationDate
      )
    );
    const verified =
      taskkillSucceeded && parentClosed && survivors.length === 0;
    if (!verified) releaseUnverifiedProcessHandles(child);
    return verified;
  } else {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may have exited between the status check and kill.
    }
  }

  if (await waitForProcessClose(child, 10_000)) return true;

  // Last-resort parent kill if taskkill itself failed. The caller still waits
  // before releasing its lock, so a timeout cannot race the next operation.
  try {
    child.kill("SIGKILL");
  } catch {
    // Ignore exit races.
  }
  const verified = await waitForProcessClose(child, 5_000);
  if (!verified) releaseUnverifiedProcessHandles(child);
  return verified;
};

export const runProcessWithTreeTimeout = (
  options: ProcessRunOptions
): Promise<ProcessRunResult> => {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    let timedOut = false;

    const appendOutput = (chunk: unknown) => {
      output = `${output}${String(chunk)}`.slice(-16_000);
    };
    const finish = (exitCode: number | null, terminationVerified?: boolean) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode,
        output: options.sanitizeOutput(output),
        terminationVerified,
      });
    };

    let child: ChildProcess;
    try {
      child = spawn(options.executable, options.args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        cwd: options.cwd,
      });
    } catch (error) {
      options.onError?.(error);
      resolve({
        exitCode: null,
        output: options.sanitizeOutput(String(error)),
      });
      return;
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      options.onTimeout?.();
      void terminateProcessTree(child).then(
        (verified) => finish(null, verified),
        () => finish(null, false)
      );
    }, options.timeoutMs);

    child.stdout?.on("data", appendOutput);
    child.stderr?.on("data", appendOutput);
    child.once("error", (error) => {
      clearTimeout(timeout);
      appendOutput(error);
      options.onError?.(error);
      if (!timedOut) finish(null);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (!timedOut) finish(code);
    });
  });
};
