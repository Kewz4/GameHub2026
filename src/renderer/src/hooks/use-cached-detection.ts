import { useEffect, useRef, useState } from "react";

const CACHE_PREFIX = "detection-cache:";

/**
 * Renders instantly from the last known detection result (localStorage)
 * while the real lookup runs in the background — avoids the "nothing
 * detected / not connected" flash on integration panels.
 */
export function useCachedDetection<T>(
  key: string,
  fetcher: () => Promise<T>
): { data: T | null; refresh: () => void } {
  const storageKey = CACHE_PREFIX + key;

  const [data, setData] = useState<T | null>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  });

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = () => {
    fetcherRef
      .current()
      .then((result) => {
        setData(result);
        try {
          localStorage.setItem(storageKey, JSON.stringify(result));
        } catch {
          // storage full/unavailable — cache is best-effort
        }
      })
      .catch(() => {
        // keep showing cached data on failure
      });
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  return { data, refresh };
}
