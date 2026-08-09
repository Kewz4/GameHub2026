import fs from "node:fs";
import path from "node:path";
import { dialog } from "electron";

import { logsPath } from "@main/constants";
import {
  clearConsoleLogBuffer,
  getConsoleLogSnapshot,
  WindowManager,
} from "@main/services";
import { registerEvent } from "../register-event";

registerEvent("getConsoleLogSnapshot", (_event, afterId?: number) =>
  getConsoleLogSnapshot(Number.isFinite(afterId) ? Number(afterId) : 0)
);

registerEvent("clearConsoleLogs", () => clearConsoleLogBuffer());

registerEvent("exportConsoleLogs", async () => {
  const snapshot = getConsoleLogSnapshot();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const options = {
    title: "Export GameHub diagnostics",
    defaultPath: path.join(logsPath, `gamehub-diagnostics-${timestamp}.log`),
    filters: [{ name: "Log file", extensions: ["log", "txt"] }],
  };
  const result = WindowManager.consoleWindow
    ? await dialog.showSaveDialog(WindowManager.consoleWindow, options)
    : await dialog.showSaveDialog(options);

  if (result.canceled || !result.filePath) {
    return { canceled: true, path: null };
  }

  const lines = snapshot.entries.map((entry) => {
    const date = new Date(entry.ts).toISOString();
    return `${date} [${entry.scope}] ${entry.level.toUpperCase()} ${entry.text}`;
  });
  await fs.promises.mkdir(path.dirname(result.filePath), { recursive: true });
  await fs.promises.writeFile(result.filePath, `${lines.join("\n")}\n`, "utf8");
  return { canceled: false, path: result.filePath };
});
