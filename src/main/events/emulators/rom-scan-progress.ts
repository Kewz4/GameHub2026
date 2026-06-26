import { randomUUID } from "node:crypto";
import type { EmulatorSystem } from "@types";
import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";
import { KNOWN_BINARIES } from "@main/services/emulators/known-binaries";
import { scanRomFolder } from "@main/services/emulators/scan-rom-folder";

/**
 * Folder-preview scan used by the emulator setup wizard. The renderer calls
 * `startRomScan(system, folderPath, scanSubfolders)`, then listens on the
 * per-request channel `on-rom-scan-progress-<requestId>` for `{ type, ... }`
 * payloads ending in `done`/`cancelled`/`error`. Previously only
 * `cancelRomScan` was registered, so every scan rejected with "No handler
 * registered for 'startRomScan'" and the wizard hung at "Scanning… 0 games".
 */

const inflight = new Map<string, { cancelled: boolean }>();

const channelFor = (requestId: string) => `on-rom-scan-progress-${requestId}`;

const startRomScan = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  folderPath: string,
  scanSubfolders: boolean
) => {
  const requestId = randomUUID();
  const signal = { cancelled: false };
  inflight.set(requestId, signal);

  const channel = channelFor(requestId);
  const binary = KNOWN_BINARIES[system];

  void (async () => {
    try {
      if (!binary) {
        WindowManager.sendToAppWindows(channel, {
          type: "error",
          requestId,
          message: `Unknown system: ${system}`,
        });
        return;
      }

      const result = await scanRomFolder(folderPath, binary, scanSubfolders, {
        signal,
        onProgress: (p) => {
          WindowManager.sendToAppWindows(channel, {
            type: "progress",
            requestId,
            processed: p.processed,
            total: p.total,
            currentFile: p.currentFile,
            kept: p.kept,
          });
        },
      });

      WindowManager.sendToAppWindows(channel, {
        type: signal.cancelled ? "cancelled" : "done",
        requestId,
        // "games found" count shown by the wizard.
        fileCount: result.fileCount,
        sizeBytes: result.sizeBytes,
      });
    } catch (err) {
      WindowManager.sendToAppWindows(channel, {
        type: "error",
        requestId,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inflight.delete(requestId);
    }
  })();

  return { requestId };
};

const cancelRomScan = async (
  _event: Electron.IpcMainInvokeEvent,
  requestId: string
) => {
  const signal = inflight.get(requestId);
  if (signal) signal.cancelled = true;
};

registerEvent("startRomScan", startRomScan);
registerEvent("cancelRomScan", cancelRomScan);
