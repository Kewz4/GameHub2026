import { useCallback, useEffect, useRef, useState } from "react";
import i18n from "i18next";

import type { EmulatorSystem } from "@types";

type ScanPhase = "idle" | "scanning" | "matching" | "done" | "error";

export interface BpScanFolderInput {
  path: string;
  scanSubfolders: boolean;
}

export interface BpRomScanState {
  phase: ScanPhase;
  system: EmulatorSystem | null;
  requestId: string | null;
  processed: number;
  total: number;
  percent: number;
  currentFile: string | null;
  status: "matched" | "wrong_platform" | "unmatched" | null;
  discovered: number;
  matched: number;
  sizeBytes: number;
  unmatchedFiles: { name: string; reason: "wrong_platform" | "unmatched" }[];
  error: string | null;
}

const INITIAL_STATE: BpRomScanState = {
  phase: "idle",
  system: null,
  requestId: null,
  processed: 0,
  total: 0,
  percent: 0,
  currentFile: null,
  status: null,
  discovered: 0,
  matched: 0,
  sizeBytes: 0,
  unmatchedFiles: [],
  error: null,
};

/**
 * Big Picture-native equivalent of the desktop `useClassicsScan` hook. The
 * desktop hook drives a Redux slice that Big Picture does not host, so this
 * subscribes to `onClassicsImportProgress` directly and keeps the scan state in
 * component state instead. It uses the exact same `importLaunchboxRoms` IPC so a
 * scan started here actually imports the games into the library.
 */
export function useBpRomScan() {
  const [scan, setScan] = useState<BpRomScanState>(INITIAL_STATE);
  const requestIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = globalThis.window.electron.onClassicsImportProgress(
      (payload) => {
        if (payload.requestId !== requestIdRef.current) return;

        if (payload.type === "error") {
          setScan((prev) => ({
            ...prev,
            phase: "error",
            error: payload.message,
          }));
          return;
        }

        if (payload.type === "progress") {
          setScan((prev) => ({
            ...prev,
            phase: payload.phase,
            system: payload.system,
            processed: payload.processed,
            total: payload.total,
            percent: payload.percent,
            currentFile: payload.currentFile,
            status: payload.status,
            discovered: payload.discovered,
            matched: payload.matched,
            sizeBytes: payload.sizeBytes,
          }));
          return;
        }

        // "done" | "cancelled"
        setScan((prev) => ({
          ...prev,
          phase: "done",
          system: payload.system,
          percent: 100,
          currentFile: null,
          status: null,
          matched: payload.matched,
          sizeBytes: payload.sizeBytes,
          unmatchedFiles: payload.unmatchedFiles,
        }));
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  const start = useCallback(
    async (system: EmulatorSystem, folders: BpScanFolderInput[]) => {
      const language = i18n.language.split("-")[0] || "en";
      const { requestId } =
        await globalThis.window.electron.importLaunchboxRoms(
          system,
          folders.map((folder) => ({
            path: folder.path,
            scanSubfolders: folder.scanSubfolders,
          })),
          language
        );
      requestIdRef.current = requestId;
      setScan({
        ...INITIAL_STATE,
        phase: "scanning",
        system,
        requestId,
      });
    },
    []
  );

  const cancel = useCallback(() => {
    if (requestIdRef.current) {
      globalThis.window.electron.cancelLaunchboxImport(requestIdRef.current);
    }
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current = null;
    setScan(INITIAL_STATE);
  }, []);

  return { scan, start, cancel, reset };
}
