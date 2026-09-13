import fs from "node:fs";
import path from "node:path";

const USER_DIRECTORIES = new Set([
  "user",
  "portable",
  "inis",
  "memcards",
  "bios",
  "system",
  "saves",
  "savestates",
  "sstates",
  "config",
  "configurations",
  "controllerprofiles",
  "inputprofiles",
  "gamesettings",
  "gameprofiles",
  "dev_hdd0",
  "dev_hdd1",
  "dev_flash",
  "dev_flash2",
  "dev_flash3",
  "guiconfigs",
  "mlc01",
  "nand",
  "sdmc",
]);
const USER_FILE_EXTENSIONS = new Set([
  ".ini",
  ".cfg",
  ".yml",
  ".yaml",
  ".json",
  ".xml",
  ".sav",
  ".srm",
  ".sram",
  ".mcd",
  ".ps2",
]);

/** Update binaries from a validated staging build without deleting portable
 * saves, user configuration, or unrelated files. Never follow archive or
 * destination symlinks. An interrupted copy can be retried; saves stay put. */
export const installPreservingEmulatorData = (
  source: string,
  destination: string,
  stageFile: (source: string, destination: string) => void = fs.copyFileSync
): void => {
  const operations: Array<{ from: string; to: string }> = [];
  const plan = (from: string, to: string, depth: number) => {
    if (depth > 32) throw new Error("Emulator archive nesting is too deep");
    const sourceInfo = fs.lstatSync(from);
    if (sourceInfo.isSymbolicLink()) return;
    const exists = fs.existsSync(to);
    if (exists && fs.lstatSync(to).isSymbolicLink())
      throw new Error("Emulator install destination contains a symbolic link");
    if (sourceInfo.isDirectory()) {
      if (
        depth > 0 &&
        exists &&
        USER_DIRECTORIES.has(path.basename(to).toLowerCase())
      )
        return;
      for (const entry of fs.readdirSync(from))
        plan(path.join(from, entry), path.join(to, entry), depth + 1);
    } else if (sourceInfo.isFile()) {
      if (
        exists &&
        (USER_FILE_EXTENSIONS.has(path.extname(to).toLowerCase()) ||
          /^portable\.(txt|ini)$/i.test(path.basename(to)))
      )
        return;
      operations.push({ from, to });
    }
  };
  plan(source, destination, 0);
  const rollback = fs.mkdtempSync(
    path.join(path.dirname(source), "_emulator-rollback-")
  );
  const changed: Array<{ to: string; backup: string | null }> = [];
  let rollbackComplete = false;
  try {
    for (const [index, operation] of operations.entries()) {
      const { from, to } = operation;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      const backup = fs.existsSync(to)
        ? path.join(rollback, `${index}.backup`)
        : null;
      if (backup) fs.copyFileSync(to, backup);
      const staged = path.join(rollback, `${index}.new`);
      stageFile(from, staged);
      if (process.platform !== "win32")
        fs.chmodSync(staged, fs.statSync(from).mode & 0o777);
      fs.renameSync(staged, to);
      changed.push({ to, backup });
    }
    rollbackComplete = true;
  } catch (error) {
    const recoveryErrors: unknown[] = [];
    for (const { to, backup } of changed.reverse()) {
      try {
        if (backup) fs.copyFileSync(backup, to);
        else fs.rmSync(to, { force: true });
      } catch (recoveryError) {
        recoveryErrors.push(recoveryError);
      }
    }
    rollbackComplete = recoveryErrors.length === 0;
    if (!rollbackComplete)
      throw new AggregateError(
        [error, ...recoveryErrors],
        `Emulator update could not be fully rolled back. Original binaries remain in ${rollback}`
      );
    throw error;
  } finally {
    if (rollbackComplete) fs.rmSync(rollback, { recursive: true, force: true });
  }
};
