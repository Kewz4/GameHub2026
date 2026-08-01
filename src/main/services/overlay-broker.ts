import { app } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

import { logger } from "./logger";

const execFileAsync = promisify(execFile);

const TASK_NAME = "GameHub Overlay Broker";
const PIPE_NAME = "GameHubOverlayBroker";
// Not String.raw: a raw template cannot end in a backslash.
const PIPE_PATH = "\\\\.\\pipe\\" + PIPE_NAME;

const systemRoot = process.env.SystemRoot ?? String.raw`C:\Windows`;
const taskScheduler = path.join(systemRoot, "System32", "schtasks.exe");
const powershell = path.join(
  systemRoot,
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe"
);

/**
 * Where the elevated copy lives.
 *
 * Deliberately NOT the app directory: an auto-update rewrites that while the
 * task still points at the old path, and a per-user writable location would let
 * a non-elevated process swap the binary that Windows then runs as
 * administrator. Program Files is writable only by administrators, which is the
 * whole point.
 */
const brokerDirectory = () =>
  path.join(
    path.parse(systemRoot).root,
    "Program Files",
    "GameHub Overlay Broker"
  );

const bundledDirectory = () =>
  path.join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    "hydra-native"
  );

const presentMonSource = () =>
  path.join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    "presentmon",
    "PresentMon.exe"
  );

export type BrokerReply = {
  ok: boolean;
  fields: string[];
};

const filesMatch = (left: string, right: string) => {
  if (!fs.existsSync(left) || !fs.existsSync(right)) return false;
  return fs.readFileSync(left).equals(fs.readFileSync(right));
};

const escapePowershell = (value: string) => value.replaceAll("'", "''");

export class OverlayBroker {
  private static installing: Promise<boolean> | null = null;
  private static unavailable = false;

  private static paths() {
    const directory = brokerDirectory();
    return {
      directory,
      broker: path.join(directory, "gamehub-overlay-broker.exe"),
      inputHook: path.join(directory, "gamehub-inputhook.dll"),
      presentMon: path.join(directory, "PresentMon.exe"),
    };
  }

  /** True when the installed copies match what this build ships. */
  private static isCurrent() {
    const installed = this.paths();
    const bundled = bundledDirectory();
    return (
      filesMatch(
        installed.broker,
        path.join(bundled, "gamehub-overlay-broker.exe")
      ) &&
      filesMatch(
        installed.inputHook,
        path.join(bundled, "gamehub-inputhook.dll")
      ) &&
      fs.existsSync(installed.presentMon)
    );
  }

  private static async taskExists() {
    try {
      await execFileAsync(taskScheduler, ["/Query", "/TN", TASK_NAME], {
        windowsHide: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Register the task and stage the elevated copies. This is the one and only
   * UAC prompt: everything afterwards starts the task, which a non-elevated
   * process may do without being prompted.
   */
  private static runSetup(): Promise<boolean> {
    const installed = this.paths();
    const bundled = bundledDirectory();
    const client = process.execPath;

    const copy = (from: string, to: string) =>
      `Copy-Item -LiteralPath '${escapePowershell(from)}' -Destination '${escapePowershell(to)}' -Force`;

    const argumentLine = [
      `--pipe "${PIPE_NAME}"`,
      `--client-executable "${escapePowershell(client)}"`,
      `--allow-directory "${escapePowershell(installed.directory)}"`,
    ].join(" ");

    const script = [
      `Stop-ScheduledTask -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue`,
      `$directory = '${escapePowershell(installed.directory)}'`,
      "New-Item -ItemType Directory -Path $directory -Force | Out-Null",
      copy(path.join(bundled, "gamehub-overlay-broker.exe"), installed.broker),
      copy(path.join(bundled, "gamehub-inputhook.dll"), installed.inputHook),
      copy(presentMonSource(), installed.presentMon),
      `$action = New-ScheduledTaskAction -Execute '${escapePowershell(installed.broker)}' -Argument '${argumentLine.replaceAll("'", "''")}'`,
      // A trigger far in the future keeps the task from ever running on its
      // own; it exists purely so it can be started on demand.
      "$trigger = New-ScheduledTaskTrigger -Once -At ([datetime]'2099-01-01T00:00:00')",
      "$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest",
      "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([timespan]::Zero)",
      `Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null`,
    ].join("; ");

    // Base64/UTF-16LE avoids every quoting hazard in a nested elevated command.
    const encoded = Buffer.from(script, "utf16le").toString("base64");

    return new Promise<boolean>((resolve) => {
      execFile(
        powershell,
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Start-Process -FilePath '${escapePowershell(powershell)}' -ArgumentList '-NoProfile','-EncodedCommand','${encoded}' -Verb RunAs -Wait -WindowStyle Hidden`,
        ],
        { windowsHide: true },
        (error) => {
          if (error) {
            // Declining the prompt lands here and is not an error worth
            // shouting about — the overlay simply keeps its unelevated path.
            logger.warn("Overlay broker setup did not complete", {
              message: error.message,
            });
            resolve(false);
            return;
          }
          resolve(true);
        }
      );
    });
  }

  /**
   * Already set up? Never prompts.
   *
   * The game-launch path uses this rather than ensureInstalled(): throwing a
   * UAC dialog at somebody mid-session because they pressed the overlay
   * shortcut would be worse than the overlay simply not gating input. Setup is
   * an explicit action — see install().
   */
  public static async isInstalled() {
    if (process.platform !== "win32" || this.unavailable) return false;
    return this.isCurrent() && (await this.taskExists());
  }

  /** Explicit, user-initiated setup. This is the one UAC prompt. */
  public static install() {
    this.unavailable = false;
    return this.ensureInstalled();
  }

  /** Install if needed. Concurrent callers share one prompt. */
  public static ensureInstalled(): Promise<boolean> {
    if (process.platform !== "win32" || this.unavailable) {
      return Promise.resolve(false);
    }
    if (this.installing) return this.installing;

    this.installing = (async () => {
      try {
        if (this.isCurrent() && (await this.taskExists())) return true;
        const installed = await this.runSetup();
        if (!installed) this.unavailable = true;
        return installed;
      } catch (error) {
        logger.error("Overlay broker setup failed", error);
        this.unavailable = true;
        return false;
      } finally {
        // Cleared so a later attempt can retry after, say, the user declines
        // once and enables the feature again.
        setTimeout(() => {
          this.installing = null;
        }, 0);
      }
    })();

    return this.installing;
  }

  private static async startTask() {
    try {
      await execFileAsync(taskScheduler, ["/Run", "/TN", TASK_NAME], {
        windowsHide: true,
      });
      return true;
    } catch (error) {
      logger.warn("Could not start the overlay broker task", error);
      return false;
    }
  }

  private static connect(timeoutMs: number): Promise<net.Socket | null> {
    return new Promise((resolve) => {
      const socket = net.connect(PIPE_PATH);
      const done = (value: net.Socket | null) => {
        socket.removeAllListeners("connect");
        socket.removeAllListeners("error");
        if (!value) socket.destroy();
        resolve(value);
      };
      socket.once("connect", () => done(socket));
      socket.once("error", () => done(null));
      setTimeout(() => done(null), timeoutMs);
    });
  }

  /**
   * Send one command and read one reply. The broker is started on demand: a
   * task at RunLevel Highest launches elevated with no prompt, so the cost of
   * it having exited is a reconnect, not a dialog.
   */
  public static async request(
    ...fields: string[]
  ): Promise<BrokerReply | null> {
    if (process.platform !== "win32" || this.unavailable) return null;
    // Deliberately isInstalled(), not ensureInstalled(): a request must never
    // be the thing that raises a UAC prompt.
    if (!(await this.isInstalled())) return null;

    let socket = await this.connect(300);
    if (!socket) {
      if (!(await this.startTask())) return null;
      // The task takes a moment to create its pipe.
      for (let attempt = 0; attempt < 20 && !socket; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        socket = await this.connect(300);
      }
    }
    if (!socket) {
      logger.warn("Overlay broker did not accept a connection");
      return null;
    }

    return new Promise<BrokerReply | null>((resolve) => {
      let buffer = "";
      const finish = (reply: BrokerReply | null) => {
        socket.removeAllListeners();
        socket.end();
        resolve(reply);
      };
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        const parts = buffer.slice(0, newline).split("\t");
        finish({ ok: parts[0] === "OK", fields: parts.slice(1) });
      });
      socket.on("error", () => finish(null));
      socket.on("close", () => finish(null));
      setTimeout(() => finish(null), 8_000);
      socket.write(`${fields.join("\t")}\n`);
    });
  }

  /** Path of the input hook as the *broker* sees it, not the app copy. */
  public static inputHookPath() {
    return this.paths().inputHook;
  }

  public static presentMonPath() {
    return this.paths().presentMon;
  }

  public static async shutdown() {
    if (process.platform !== "win32") return;
    await this.request("shutdown").catch(() => null);
  }
}
