import crypto from "node:crypto";

export interface TorBoxReadyState {
  cached?: boolean;
  download_finished?: boolean;
  download_present?: boolean;
  download_state?: string;
}

export interface TorBoxWebDownloadIdentity {
  id: number;
  hash?: string;
  name?: string;
  original_url?: string;
}

export interface TorBoxDownloadFileIdentity {
  id: number;
  name: string;
  short_name?: string;
}

export function normalizeTorBoxFileName(value: string) {
  return (value.replaceAll("\\", "/").split("/").at(-1) ?? "").toLowerCase();
}

export function selectTorBoxDownloadFile<T extends TorBoxDownloadFileIdentity>(
  files: T[],
  targetFileName?: string | null,
  fileIndices?: number[]
) {
  const wantedName = targetFileName
    ? normalizeTorBoxFileName(targetFileName)
    : null;
  let target = wantedName
    ? files.find(
        (file) =>
          normalizeTorBoxFileName(file.name) === wantedName ||
          normalizeTorBoxFileName(file.short_name ?? "") === wantedName
      )
    : undefined;

  if (!target && fileIndices?.length === 1) {
    const index = fileIndices[0];
    target =
      files.find((file) => file.id === index) ??
      (index >= 0 && index < files.length ? files[index] : undefined);
  }

  if (!target && files.length === 1) target = files[0];
  return target;
}

export function isLegacyTorBoxGeneratedZip(
  resumingFilename: string | undefined,
  target: TorBoxDownloadFileIdentity | undefined
) {
  return Boolean(
    target &&
      resumingFilename &&
      /\.zip$/i.test(resumingFilename) &&
      normalizeTorBoxFileName(resumingFilename) !==
        normalizeTorBoxFileName(target.short_name || target.name)
  );
}

export function normalizeTorBoxProgress(progress: unknown) {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return 0;
  const normalized = progress > 1 ? progress / 100 : progress;
  return Math.max(0, Math.min(normalized, 1));
}

/** TorBox only exposes a downloadable item once it is finished and present. */
export function isTorBoxItemReady(item: TorBoxReadyState | null | undefined) {
  return Boolean(item?.download_finished && item.download_present);
}

export function findMatchingTorBoxWebDownload<
  T extends TorBoxWebDownloadIdentity,
>(entries: T[], sourceUrl: string) {
  const expectedHash = crypto.createHash("md5").update(sourceUrl).digest("hex");

  return (
    entries.find((entry) => entry.original_url === sourceUrl) ??
    entries.find(
      (entry) => entry.hash?.trim().toLowerCase() === expectedHash
    ) ??
    null
  );
}

export function redactTorBoxSensitiveText(
  input: unknown,
  secrets: string[] = []
) {
  let value = input instanceof Error ? input.message : String(input ?? "");
  for (const secret of secrets) {
    if (secret) value = value.replaceAll(secret, "[redacted]");
  }

  value = value
    .replace(/bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/magnet:\?[^\s]+/gi, "magnet:?[redacted]")
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, "$1?[redacted]")
    .replace(
      /([?&](?:token|api[_-]?key|apikey|authorization|signature|sig)=)[^&\s]+/gi,
      "$1[redacted]"
    )
    .replace(/[\r\n\t]+/g, " ")
    .trim();

  return value.slice(0, 500) || "TorBox request failed";
}
