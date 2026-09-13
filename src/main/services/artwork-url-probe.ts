export type ArtworkUrlStatus = "reachable" | "missing" | "unknown";

const MAX_CONCURRENT_PROBES = 8;
const REACHABLE_TTL_MS = 6 * 60 * 60_000;
const MISSING_TTL_MS = 15 * 60_000;
const UNKNOWN_TTL_MS = 30_000;

const cache = new Map<
  string,
  { expiresAt: number; promise: Promise<ArtworkUrlStatus> }
>();
const waiters: Array<() => void> = [];
let activeProbes = 0;

const withProbeSlot = async <T>(run: () => Promise<T>): Promise<T> => {
  if (activeProbes >= MAX_CONCURRENT_PROBES) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  activeProbes += 1;
  try {
    return await run();
  } finally {
    activeProbes -= 1;
    waiters.shift()?.();
  }
};

const runProbe = async (url: string): Promise<ArtworkUrlStatus> => {
  if (!/^https?:\/\//i.test(url)) return "reachable";
  try {
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(5_000),
    });
    if ([403, 405, 501].includes(response.status)) {
      response = await fetch(url, {
        headers: { Range: "bytes=0-0" },
        redirect: "follow",
        signal: AbortSignal.timeout(5_000),
      });
    }
    if (response.ok || response.status === 206) return "reachable";
    if (
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500
    ) {
      return "unknown";
    }
    return "missing";
  } catch {
    // Offline/DNS/timeout is not evidence that persisted artwork is invalid.
    return "unknown";
  }
};

export function probeArtworkUrl(url: string): Promise<ArtworkUrlStatus> {
  const normalized = url.trim();
  if (!normalized) return Promise.resolve("missing");
  const existing = cache.get(normalized);
  if (existing && existing.expiresAt > Date.now()) return existing.promise;

  const promise = withProbeSlot(() => runProbe(normalized)).then((status) => {
    const ttl =
      status === "reachable"
        ? REACHABLE_TTL_MS
        : status === "missing"
          ? MISSING_TTL_MS
          : UNKNOWN_TTL_MS;
    cache.set(normalized, { expiresAt: Date.now() + ttl, promise });
    return status;
  });
  cache.set(normalized, { expiresAt: Date.now() + UNKNOWN_TTL_MS, promise });
  return promise;
}

export function chooseArtworkCandidate(
  candidates: string[],
  statuses: ArtworkUrlStatus[]
): string | null {
  const reachableIndex = statuses.findIndex((status) => status === "reachable");
  if (reachableIndex >= 0) return candidates[reachableIndex] ?? null;
  const unknownIndex = statuses.findIndex((status) => status === "unknown");
  return unknownIndex >= 0 ? (candidates[unknownIndex] ?? null) : null;
}

export async function selectReachableArtworkUrl(
  values: Array<string | null | undefined>
): Promise<string | null> {
  const candidates = [
    ...new Set(values.map((value) => value?.trim()).filter(Boolean)),
  ] as string[];
  const statuses = await Promise.all(candidates.map(probeArtworkUrl));
  return chooseArtworkCandidate(candidates, statuses);
}

export function clearArtworkUrlProbeCache(): void {
  cache.clear();
}
