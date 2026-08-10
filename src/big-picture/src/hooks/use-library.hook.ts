import { useCallback, useEffect, useRef, useState } from "react";
import { IS_DESKTOP } from "../constants";
import type { LibraryGame } from "@types";

export function useLibrary() {
  const [library, setLibrary] = useState<LibraryGame[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const loadRequestIdRef = useRef(0);

  const updateLibrary = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;

    if (!IS_DESKTOP) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const updatedLibrary = await globalThis.window.electron.getLibrary();

      if (requestId !== loadRequestIdRef.current) return;

      setLibrary(updatedLibrary);
      setLoadError(null);
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) return;

      setLoadError(
        error instanceof Error ? error : new Error("Failed to load library")
      );
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    updateLibrary();

    if (!IS_DESKTOP) return;

    const unsubscribeLibraryBatch =
      globalThis.window.electron.onLibraryBatchComplete(() => {
        updateLibrary();
      });

    const unsubscribeDownloadsUpdated =
      globalThis.window.electron.onDownloadsUpdated(() => {
        updateLibrary();
      });

    const handleLibraryUpdate = () => updateLibrary();
    globalThis.window.addEventListener("library-update", handleLibraryUpdate);

    return () => {
      unsubscribeLibraryBatch();
      unsubscribeDownloadsUpdated();
      globalThis.window.removeEventListener(
        "library-update",
        handleLibraryUpdate
      );
    };
  }, [updateLibrary]);

  return { library, updateLibrary, isLoading, loadError };
}
