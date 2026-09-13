import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { findExecutableOnPath } from "./launcher-binary";

let pythonRuntime: string | null = null;
const readHeader = (file: string) => {
  const descriptor = fs.openSync(file, "r");
  try {
    const bytes = Buffer.alloc(128);
    const length = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
    return bytes.subarray(0, length).toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
};

export const getLauncherInvocation = (
  binary: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
  options: {
    platform?: NodeJS.Platform;
    header?: (file: string) => string;
    python?: () => string;
  } = {}
) => {
  if (
    (options.platform ?? process.platform) !== "linux" ||
    !/^#![^\n]*python/.test((options.header ?? readHeader)(binary))
  ) {
    return { command: binary, args, env: environment };
  }
  // These official Linux release assets are zipapps, not frozen interpreters.
  // Prefer the distro Python over a developer's activated Python 3.9 SDK.
  const env = { ...environment };
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  const resolvePython = () => {
    if (pythonRuntime) return pythonRuntime;
    const candidates = new Set([
      "/usr/bin/python3",
      findExecutableOnPath("python3", env),
    ]);
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        const version = execFileSync(candidate, ["--version"], {
          encoding: "utf8",
          timeout: 600,
          killSignal: "SIGKILL",
          env,
          stdio: ["ignore", "pipe", "ignore"],
        });
        const match = /Python (\d+)\.(\d+)/.exec(version);
        if (match && Number(match[1]) === 3 && Number(match[2]) >= 10)
          return (pythonRuntime = candidate);
      } catch {
        /* Try the other explicit interpreter, never an unbounded shell. */
      }
    }
    throw new Error(
      "Legendary and GOG downloads require Python 3.10 or newer on Linux. Install your distribution's python3 package."
    );
  };
  return {
    command: (options.python ?? resolvePython)(),
    args: [binary, ...args],
    env,
  };
};
