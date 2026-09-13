import { useMemo, useState } from "react";
import {
  AlertFillIcon,
  CheckCircleFillIcon,
  FileDirectoryIcon,
} from "@primer/octicons-react";

import { Button, SelectField } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import type {
  GameShop,
  LudusaviBackupScanEntry,
  LudusaviBackupLibraryTarget,
} from "@types";

type ImportStatus = "idle" | "importing" | "confirm" | "done" | "error";

interface ImportState {
  status: ImportStatus;
  targetKey?: string;
  expectedSnapshotId?: string;
}

const targetKey = (
  target: Pick<LudusaviBackupLibraryTarget, "shop" | "objectId">
) => JSON.stringify([target.shop, target.objectId]);

const parseTargetKey = (value: string) => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { shop: parsed[0] as GameShop, objectId: parsed[1] };
    }
  } catch {
    // The empty option deliberately has no JSON value.
  }
  return null;
};

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
};

const friendlyImportError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ludusavi_import_unmapped_files")) {
    return "Some archived files do not match this game's current save map. Open the game once or configure its save folders, then scan again.";
  }
  if (message.includes("ludusavi_import_remote_changed")) {
    return "The cloud save changed while you were reviewing the import. Scan it again before replacing anything.";
  }
  if (message.includes("ludusavi_import_hash_mismatch")) {
    return "Ludusavi's recorded checksum does not match the archived file. The import was stopped without uploading anything.";
  }
  if (message.includes("ludusavi_import_target_not_in_library")) {
    return "Choose an active game from your GameHub library.";
  }
  return "The backup could not be verified and nothing was uploaded.";
};

export function SettingsLudusaviImport() {
  const { showSuccessToast, showErrorToast } = useToast();
  const library = useAppSelector((state) => state.library.value).filter(
    (game) => !game.isDeleted
  );
  const [scanning, setScanning] = useState(false);
  const [entries, setEntries] = useState<LudusaviBackupScanEntry[]>([]);
  const [importStates, setImportStates] = useState<Record<string, ImportState>>(
    {}
  );
  const [scannedPath, setScannedPath] = useState("");

  const gameOptions = useMemo(
    () => [
      { key: "unselected", value: "", label: "Choose a library game" },
      ...library
        .slice()
        .sort((left, right) => left.title.localeCompare(right.title))
        .map((game) => ({
          key: targetKey(game),
          value: targetKey(game),
          label: `${game.title} · ${game.shop}`,
        })),
    ],
    [library]
  );

  const handlePickFolder = async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Ludusavi Backup Folder",
    });
    if (!result || result.canceled || !result.filePaths[0]) return;
    const folderPath = result.filePaths[0];
    setScannedPath(folderPath);
    setScanning(true);
    setEntries([]);
    setImportStates({});
    try {
      const found = await window.electron.scanLudusaviBackupFolder(folderPath);
      setEntries(found);
      setImportStates(
        Object.fromEntries(
          found.map((entry) => [
            entry.folderPath,
            {
              status: "idle" as const,
              targetKey: entry.suggestedGame
                ? targetKey(entry.suggestedGame)
                : undefined,
            },
          ])
        )
      );
      if (found.length === 0) {
        showErrorToast("Ludusavi Import", "No valid backup folders found.");
      }
    } catch {
      showErrorToast("Ludusavi Import", "Failed to scan folder.");
    } finally {
      setScanning(false);
    }
  };

  const handleImport = async (
    entry: LudusaviBackupScanEntry,
    replaceExisting = false
  ) => {
    const state = importStates[entry.folderPath] ?? { status: "idle" };
    const target = parseTargetKey(state.targetKey ?? "");
    if (!target) {
      showErrorToast(
        "Choose a game",
        "Select the GameHub library game that owns this backup."
      );
      return;
    }
    setImportStates((previous) => ({
      ...previous,
      [entry.folderPath]: { ...state, status: "importing" },
    }));
    try {
      const result = await window.electron.importLudusaviBackup(
        entry.folderPath,
        target.objectId,
        target.shop,
        replaceExisting
          ? {
              replaceExisting: true,
              expectedSnapshotId: state.expectedSnapshotId,
            }
          : undefined
      );
      if (!result.ok && result.status === "confirmation-required") {
        setImportStates((previous) => ({
          ...previous,
          [entry.folderPath]: {
            ...state,
            status: "confirm",
            expectedSnapshotId: result.expectedSnapshotId,
          },
        }));
        return;
      }
      setImportStates((previous) => ({
        ...previous,
        [entry.folderPath]: { ...state, status: "done" },
      }));
      showSuccessToast(
        "Ludusavi Import",
        result.status === "already-current"
          ? `“${entry.gameName}” already matches the cloud save.`
          : `Imported “${entry.gameName}” into GameHub Cloud Saves.`
      );
    } catch (error) {
      setImportStates((previous) => ({
        ...previous,
        [entry.folderPath]: { ...state, status: "error" },
      }));
      showErrorToast("Ludusavi Import", friendlyImportError(error));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <p style={{ margin: 0, opacity: 0.7, fontSize: "0.875rem" }}>
        Bring verified Ludusavi files into GameHub Cloud Saves. GameHub checks
        the archive, maps every file to the selected game, and never changes an
        existing cloud save without asking you first.
      </p>

      <div>
        <Button type="button" theme="outline" onClick={handlePickFolder}>
          <FileDirectoryIcon size={14} />
          {scanning ? "Scanning…" : "Pick Backup Folder"}
        </Button>
      </div>

      {scannedPath && !scanning && entries.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <p style={{ margin: 0, fontSize: "0.8rem", opacity: 0.6 }}>
            Found {entries.length} verified backup
            {entries.length !== 1 ? "s" : ""} in <code>{scannedPath}</code>
          </p>
          {entries.map((entry) => {
            const state = importStates[entry.folderPath] ?? { status: "idle" };
            const isDone = state.status === "done";
            const isImporting = state.status === "importing";
            const needsConfirmation = state.status === "confirm";

            return (
              <div
                key={entry.folderPath}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  padding: "12px 14px",
                  borderRadius: "8px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  opacity: isDone ? 0.72 : 1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: "0.9rem" }}>
                      {entry.gameName}
                    </strong>
                    <div style={{ opacity: 0.6, fontSize: "0.78rem" }}>
                      {entry.fileCount} files ·{" "}
                      {formatBytes(entry.totalSizeBytes)} ·{" "}
                      {new Date(entry.capturedAt).toLocaleString()}
                    </div>
                  </div>
                  {isDone && <CheckCircleFillIcon size={18} />}
                </div>

                {!isDone && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(220px, 1fr) auto",
                      alignItems: "end",
                      gap: "10px",
                    }}
                  >
                    <SelectField
                      label="Import into"
                      options={gameOptions}
                      value={state.targetKey ?? ""}
                      disabled={isImporting || needsConfirmation}
                      onChange={(event) =>
                        setImportStates((previous) => ({
                          ...previous,
                          [entry.folderPath]: {
                            status: "idle",
                            targetKey: event.target.value,
                          },
                        }))
                      }
                    />
                    <Button
                      type="button"
                      theme="outline"
                      disabled={isImporting || !(state.targetKey ?? "")}
                      onClick={() => handleImport(entry)}
                    >
                      {isImporting ? "Verifying…" : "Import to Cloud"}
                    </Button>
                  </div>
                )}

                {needsConfirmation && (
                  <div
                    role="alert"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "8px",
                      padding: "10px",
                      borderRadius: "6px",
                      background: "rgba(255,255,255,0.08)",
                    }}
                  >
                    <AlertFillIcon size={16} />
                    <span style={{ flex: 1, fontSize: "0.8rem" }}>
                      A different cloud save already exists. Replacing it makes
                      this verified Ludusavi backup the active cloud version.
                    </span>
                    <Button
                      type="button"
                      theme="outline"
                      onClick={() =>
                        setImportStates((previous) => ({
                          ...previous,
                          [entry.folderPath]: {
                            ...state,
                            status: "idle",
                            expectedSnapshotId: undefined,
                          },
                        }))
                      }
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={() => handleImport(entry, true)}
                    >
                      Replace cloud save
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
