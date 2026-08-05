import axios, { AxiosInstance } from "axios";
import parseTorrent from "parse-torrent";
import fs from "node:fs";
import path from "node:path";
import type {
  TorBoxUserRequest,
  TorBoxTorrentInfoRequest,
  TorBoxAddTorrentRequest,
  TorBoxRequestLinkRequest,
  TorBoxFile,
} from "@types";
import { appVersion } from "@main/constants";
import { logger } from "../logger";
import {
  findMatchingTorBoxWebDownload,
  isLegacyTorBoxGeneratedZip,
  isTorBoxItemReady,
  normalizeTorBoxProgress,
  redactTorBoxSensitiveText,
  selectTorBoxDownloadFile,
  type TorBoxWebDownloadIdentity,
} from "./torbox-helpers";

interface TorBoxWebDownloadInfo extends TorBoxWebDownloadIdentity {
  cached?: boolean;
  download_present?: boolean;
  download_finished?: boolean;
  download_state?: string;
  progress?: number;
  download_speed?: number;
  eta?: number;
  size?: number;
  files?: TorBoxFile[];
}

/** Caching-phase progress TorBox reports while preparing a download. */
export interface TorBoxPrepareProgress {
  /** 0–1 fraction cached on TorBox's side. */
  progress: number;
  /** Bytes/sec TorBox is fetching at (for an ETA + live bar). */
  downloadSpeed: number;
  /** Seconds remaining per TorBox, or -1 if unknown. */
  eta: number;
  /** User-facing server-side resolution phase. */
  phase: "checking-cache" | "cached" | "preparing" | "direct-fallback";
}

/**
 * TorBox client. Handles BOTH torrents/magnets AND direct hoster links (via
 * TorBox's "web download" API), so every download in the app can be routed
 * through TorBox for high-speed, host-agnostic transfers. For content TorBox
 * hasn't cached yet, we add it and poll until TorBox finishes fetching it to
 * their servers, then hand back a direct download link.
 */
export class TorBoxClient {
  private static instance: AxiosInstance;
  private static readonly baseURL = "https://api.torbox.app/v1/api";
  private static apiToken = "";

  // Keep large uncached games in the visible Preparing phase for a practical
  // window. Cancel/pause stops polling immediately through shouldContinue.
  private static readonly READY_TIMEOUT_MS = 6 * 60 * 60 * 1000;
  private static readonly POLL_INTERVAL_MS = 4000;

  static authorize(apiToken: string) {
    const normalizedToken = apiToken.trim();
    if (!normalizedToken) {
      throw new Error(
        "Connect TorBox in Settings > Integrations before starting this download"
      );
    }

    this.apiToken = normalizedToken;
    this.instance = axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${normalizedToken}`,
        "User-Agent": `Hydra/${appVersion}`,
      },
    });
    // Axios errors retain the full request config, including the Authorization
    // header and requestdl token query. Replace them at the boundary so no
    // caller/logger can accidentally serialize credentials or signed links.
    this.instance.interceptors.response.use(
      (response) => response,
      (error: unknown) => Promise.reject(this.toSafeApiError(error))
    );
  }

  private static toSafeApiError(error: unknown) {
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;
    const detail = axios.isAxiosError(error)
      ? (error.response?.data as { detail?: unknown } | undefined)?.detail
      : undefined;
    const message = redactTorBoxSensitiveText(
      typeof detail === "string"
        ? detail
        : error instanceof Error
          ? error.message
          : "TorBox request failed",
      [this.apiToken]
    );
    const safeError = new Error(message) as Error & {
      response?: { status?: number };
      code?: string;
    };
    safeError.name = "TorBoxApiError";
    if (status != null) safeError.response = { status };
    if (axios.isAxiosError(error) && error.code) safeError.code = error.code;
    return safeError;
  }

  private static apiFailure(detail: unknown, fallback: string) {
    return new Error(
      redactTorBoxSensitiveText(
        typeof detail === "string" ? detail : fallback,
        [this.apiToken]
      )
    );
  }

  private static sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private static assertPreparationContinues(shouldContinue?: () => boolean) {
    if (!shouldContinue || shouldContinue()) return;
    const error = new Error("TorBox preparation was cancelled");
    error.name = "TorBoxPreparationCancelledError";
    throw error;
  }

  // ── Torrents / magnets ─────────────────────────────────────────────────────

  private static async addMagnet(magnet: string) {
    const form = new FormData();
    form.append("magnet", magnet);

    const response = await this.instance.post<TorBoxAddTorrentRequest>(
      "/torrents/createtorrent",
      form
    );

    if (!response.data.success) {
      throw this.apiFailure(response.data.detail, "TorBox rejected the magnet");
    }

    return response.data.data;
  }

  private static async addTorrentFile(filePath: string) {
    const buffer = await fs.promises.readFile(filePath);
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: "application/x-bittorrent" }),
      path.basename(filePath)
    );

    const response = await this.instance.post<TorBoxAddTorrentRequest>(
      "/torrents/createtorrent",
      form
    );

    if (!response.data.success) {
      throw this.apiFailure(
        response.data.detail,
        "TorBox rejected the torrent file"
      );
    }

    return response.data.data;
  }

  static async getTorrentInfo(id: number) {
    const response = await this.instance.get<TorBoxTorrentInfoRequest>(
      "/torrents/mylist",
      { params: { bypass_cache: true } }
    );
    if (!response.data.success || !Array.isArray(response.data.data)) {
      throw this.apiFailure(
        response.data.detail,
        "TorBox could not return the torrent list"
      );
    }
    const data = response.data.data;

    const info = data.find((item) => item.id === id);

    if (!info) {
      return null;
    }

    return info;
  }

  static async getUser() {
    const response = await this.instance.get<TorBoxUserRequest>(`/user/me`);
    if (!response.data.success || !response.data.data) {
      throw this.apiFailure(
        response.data.detail,
        "TorBox could not authenticate this account"
      );
    }
    return response.data.data;
  }

  static async requestLink(id: number, fileId?: number) {
    const params: Record<string, string> = {
      token: this.apiToken,
      torrent_id: id.toString(),
    };
    if (fileId != null) {
      params.file_id = fileId.toString();
    } else {
      params.zip_link = "true";
    }
    const searchParams = new URLSearchParams(params);

    const response = await this.instance.get<TorBoxRequestLinkRequest>(
      "/torrents/requestdl?" + searchParams.toString()
    );
    if (!response.data.success || typeof response.data.data !== "string") {
      throw this.apiFailure(
        response.data.detail,
        "TorBox could not create the torrent download link"
      );
    }
    return response.data.data;
  }

  private static async getAllTorrentsFromUser() {
    const response = await this.instance.get<TorBoxTorrentInfoRequest>(
      "/torrents/mylist",
      { params: { bypass_cache: true } }
    );
    if (!response.data.success || !Array.isArray(response.data.data)) {
      throw this.apiFailure(
        response.data.detail,
        "TorBox could not return the torrent list"
      );
    }
    return response.data.data;
  }

  private static async getSourceHashes(torrentSource: string) {
    const isLocalTorrent =
      path.isAbsolute(torrentSource) &&
      path.extname(torrentSource).toLowerCase() === ".torrent";
    const parsedSource = isLocalTorrent
      ? await fs.promises.readFile(torrentSource)
      : torrentSource;

    const hashes = new Set<string>();
    try {
      const { infoHash } = await parseTorrent(parsedSource);
      if (infoHash) hashes.add(infoHash.toLowerCase());
    } catch {
      // parse-torrent 11 cannot parse every BitTorrent v2-only magnet. The
      // TorBox API can, so derive its btmh identifier below and still submit it.
    }

    if (!isLocalTorrent) {
      const queryIndex = torrentSource.indexOf("?");
      const params = new URLSearchParams(
        queryIndex >= 0 ? torrentSource.slice(queryIndex + 1) : ""
      );
      for (const exactTopic of params.getAll("xt")) {
        const normalized = exactTopic.toLowerCase();
        if (normalized.startsWith("urn:btih:")) {
          hashes.add(normalized.slice("urn:btih:".length));
        } else if (normalized.startsWith("urn:btmh:")) {
          const multihash = normalized.slice("urn:btmh:".length);
          hashes.add(multihash);
          if (/^1220[a-f0-9]{64}$/.test(multihash)) {
            hashes.add(multihash.slice(4));
          }
        }
      }
    }

    return { hashes, isLocalTorrent };
  }

  private static findTorrentByHashes(
    torrents: TorBoxTorrentInfoRequest["data"],
    hashes: Set<string>
  ) {
    if (hashes.size === 0) return null;
    return (
      torrents.find((torrent) => {
        const reportedHashes = [
          torrent.hash,
          ...(torrent.alternative_hashes ?? []),
        ]
          .filter(Boolean)
          .map((hash) => hash.toLowerCase());
        return reportedHashes.some((hash) => hashes.has(hash));
      }) ?? null
    );
  }

  private static async getTorrentIdAndName(torrentSource: string) {
    const { hashes, isLocalTorrent } =
      await this.getSourceHashes(torrentSource);
    const userTorrents = await this.getAllTorrentsFromUser();
    const userTorrent = this.findTorrentByHashes(userTorrents, hashes);

    if (userTorrent) return { id: userTorrent.id, name: userTorrent.name };

    let torrent: TorBoxAddTorrentRequest["data"];
    try {
      torrent = isLocalTorrent
        ? await this.addTorrentFile(torrentSource)
        : await this.addMagnet(torrentSource);
    } catch (error) {
      // The create endpoint can report DUPLICATE_ITEM if the list cache raced
      // us. Re-read the live list so pause/resume reuses the persisted job.
      const refreshed = await this.getAllTorrentsFromUser().catch(() => []);
      const existing = this.findTorrentByHashes(refreshed, hashes);
      if (existing) return { id: existing.id, name: existing.name };
      throw error;
    }
    if (!Number.isSafeInteger(torrent?.torrent_id)) {
      throw new Error("TorBox returned an invalid torrent job identifier");
    }
    return { id: torrent.torrent_id, name: torrent.name };
  }

  /**
   * Poll a torrent until TorBox has finished caching it (or we time out).
   * Reports caching progress/speed/ETA via `onProgress` so the app can show
   * a real "preparing download" bar instead of a static spinner.
   */
  private static async waitForTorrentReady(
    id: number,
    onProgress?: (p: TorBoxPrepareProgress) => void,
    shouldContinue?: () => boolean
  ) {
    const deadline = Date.now() + this.READY_TIMEOUT_MS;
    for (;;) {
      this.assertPreparationContinues(shouldContinue);
      const info = await this.getTorrentInfo(id);
      const progress = normalizeTorBoxProgress(info?.progress);
      const ready = isTorBoxItemReady(info);
      if (info) {
        logger.log(
          `[torbox] torrent ${id} state=${info.download_state} ` +
            `progress=${(progress * 100).toFixed(1)}% cached=${info.cached} ` +
            `speed=${info.download_speed} eta=${info.eta} files=${info.files?.length ?? 0}`
        );
        onProgress?.({
          progress,
          downloadSpeed: info.download_speed ?? 0,
          eta: info.eta ?? -1,
          phase: ready ? "cached" : "preparing",
        });
      }
      if (ready) return info;
      if (Date.now() > deadline) {
        throw new Error(
          `TorBox did not finish preparing this torrent after ${Math.round(
            this.READY_TIMEOUT_MS / 3_600_000
          )} hours (state=${info?.download_state ?? "unknown"})`
        );
      }
      await this.sleep(this.POLL_INTERVAL_MS);
    }
  }

  // ── Web downloads (any hoster link) ─────────────────────────────────────────

  private static async getAllWebDownloadsFromUser() {
    const response = await this.instance.get<{
      success: boolean;
      detail: string;
      data: TorBoxWebDownloadInfo[];
    }>("/webdl/mylist", { params: { bypass_cache: true } });
    if (!response.data.success || !Array.isArray(response.data.data)) {
      throw this.apiFailure(
        response.data.detail,
        "TorBox could not return the web download list"
      );
    }
    return response.data.data;
  }

  private static async findExistingWebDownload(link: string) {
    const downloads = await this.getAllWebDownloadsFromUser();
    return findMatchingTorBoxWebDownload(downloads, link);
  }

  private static async addWebDownload(link: string) {
    // TorBox's /webdl/createwebdownload can fail with 500 when their scanner
    // can't reach the hoster (common with vik1ngfile.site — the API server's
    // scanner can't access it even though the web client can). Retry up to 3
    // times with increasing delays — sometimes the scanner succeeds on retry.
    const existing = await this.findExistingWebDownload(link).catch(() => null);
    if (existing) return existing;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const form = new FormData();
        form.append("link", link);
        const response = await this.instance.post<{
          success: boolean;
          detail: string;
          data?: {
            webdownload_id?: number;
            id?: number;
            hash?: string;
            name?: string;
          };
        }>("/webdl/createwebdownload", form);
        if (!response.data.success) {
          throw this.apiFailure(
            response.data.detail,
            "TorBox rejected the link"
          );
        }
        const data = response.data.data ?? {};
        const id = data.webdownload_id ?? data.id;
        if (!Number.isSafeInteger(id)) {
          const created = await this.findExistingWebDownload(link).catch(
            () => null
          );
          if (created) return created;
          throw new Error("TorBox returned an invalid web download identifier");
        }
        return {
          id: id as number,
          name: data.name,
          hash: data.hash,
        };
      } catch (err) {
        lastErr = err;
        // DUPLICATE_ITEM and create/list cache races are normal on resume.
        const duplicate = await this.findExistingWebDownload(link).catch(
          () => null
        );
        if (duplicate) return duplicate;

        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        if (status === 500 && attempt < 2) {
          // Retry — TorBox's scanner is intermittent for some hosters.
          const delay = 3000 * (attempt + 1);
          logger.log(
            `[torbox] web download attempt ${attempt + 1}/3 failed (500), retrying in ${delay / 1000}s…`
          );
          await this.sleep(delay);
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  private static async getWebDownloadInfo(id: number) {
    const downloads = await this.getAllWebDownloadsFromUser();
    return downloads.find((item) => item.id === id) ?? null;
  }

  private static async waitForWebReady(
    id: number,
    onProgress?: (p: TorBoxPrepareProgress) => void,
    shouldContinue?: () => boolean
  ) {
    const deadline = Date.now() + this.READY_TIMEOUT_MS;
    for (;;) {
      this.assertPreparationContinues(shouldContinue);
      const info = await this.getWebDownloadInfo(id);
      const progress = normalizeTorBoxProgress(info?.progress);
      const ready = isTorBoxItemReady(info);
      if (info) {
        onProgress?.({
          progress,
          downloadSpeed: info.download_speed ?? 0,
          eta: info.eta ?? -1,
          phase: ready ? "cached" : "preparing",
        });
      }
      if (ready) return info;
      if (Date.now() > deadline) {
        throw new Error(
          `TorBox did not finish preparing this link after ${Math.round(
            this.READY_TIMEOUT_MS / 3_600_000
          )} hours`
        );
      }
      await this.sleep(this.POLL_INTERVAL_MS);
    }
  }

  private static async requestWebLink(id: number, fileId?: number) {
    const params: Record<string, string> = {
      token: this.apiToken,
      web_id: id.toString(),
    };
    if (fileId != null) {
      params.file_id = fileId.toString();
    } else {
      params.zip_link = "true";
    }
    const searchParams = new URLSearchParams(params);
    const response = await this.instance.get<TorBoxRequestLinkRequest>(
      "/webdl/requestdl?" + searchParams.toString()
    );
    if (!response.data.success || typeof response.data.data !== "string") {
      throw this.apiFailure(
        response.data.detail,
        "TorBox could not create the web download link"
      );
    }
    return response.data.data;
  }

  // ── Unified entry point ─────────────────────────────────────────────────────

  /**
   * Resolve a URI (magnet OR hoster link) into a direct TorBox download link,
   * waiting for TorBox to finish caching it first when necessary. When
   * `targetFileName` matches a file in a multi-file torrent, we request just
   * that file instead of a whole-torrent zip.
   */
  static async getDownloadInfo(
    uri: string,
    fileIndices?: number[],
    onProgress?: (p: TorBoxPrepareProgress) => void,
    targetFileName?: string | null,
    shouldContinue?: () => boolean,
    allowDirectFallback = true,
    resumingFilename?: string
  ) {
    if (!this.instance || !this.apiToken) {
      throw new Error(
        "Connect TorBox in Settings > Integrations before starting this download"
      );
    }

    const isTorrent =
      uri.startsWith("magnet:") ||
      (path.isAbsolute(uri) && path.extname(uri).toLowerCase() === ".torrent");

    onProgress?.({
      progress: 0,
      downloadSpeed: 0,
      eta: -1,
      phase: "checking-cache",
    });

    if (isTorrent) {
      const torrentData = await this.getTorrentIdAndName(uri);
      const info = await this.waitForTorrentReady(
        torrentData.id,
        onProgress,
        shouldContinue
      );
      const files = info?.files ?? [];

      if (files.length) {
        logger.log(
          `[torbox] torrent "${torrentData.name}" has ${files.length} file(s), ` +
            `total=${info?.size} bytes; target="${targetFileName ?? ""}"`
        );
      }

      // Try to select a specific file when the torrent has multiple.
      // Priority: filename match → caller fileIndex → single file → whole zip.
      const norm = (s: string) =>
        s
          .toLowerCase()
          .replace(/^.*[\\/]/, "")
          .replace(/\.[a-z0-9]{1,5}$/, "")
          .replace(/[^a-z0-9]/g, "");
      const want = targetFileName ? norm(targetFileName) : null;

      let target: (typeof files)[number] | null = null;

      if (want && files.length > 0) {
        // Match against name and short_name for robustness.
        target =
          files.find(
            (f) => norm(f.name) === want || norm(f.short_name ?? "") === want
          ) ??
          files.find(
            (f) =>
              norm(f.name).includes(want) ||
              want.includes(norm(f.name)) ||
              norm(f.short_name ?? "").includes(want) ||
              want.includes(norm(f.short_name ?? ""))
          ) ??
          null;
      }

      if (!target && fileIndices?.length === 1) {
        const idx = fileIndices[0];
        target =
          files.find((f) => f.id === idx) ??
          (idx >= 0 && idx < files.length ? files[idx] : null);
      }

      if (!target && files.length === 1) {
        target = files[0];
      }

      if (target) {
        logger.log(
          `[torbox] selected file id=${target.id} name=${target.name} size=${target.size}`
        );
        const url = await this.requestLink(torrentData.id, target.id);
        const name = target.short_name || target.name;
        logger.log(`[torbox] resolved download url (fileId=${target.id})`);
        return { url, name };
      }

      // No specific file matched — request the whole torrent as a zip.
      // (Previously this threw a "wrong torrent" error, which was a false
      // positive when TorBox's file list wasn't populated yet. Falling back
      // to the zip is always safe — the user gets the content either way.)
      logger.log(
        `[torbox] no specific file match — requesting whole-torrent zip for "${torrentData.name}"`
      );
      const url = await this.requestLink(torrentData.id);
      const torrentName = torrentData.name || "TorBox download";
      const name = /\.zip$/i.test(torrentName)
        ? torrentName
        : `${torrentName}.zip`;
      return { url, name };
    }

    // Any other http(s) hoster link → TorBox web download.
    // TorBox's API scanner can't reach some hosters (e.g. vik1ngfile.site)
    // even though the TorBox web client can. Retry 3 times inside
    // addWebDownload; if all fail, fall back to downloading the URL directly.
    // The user still gets their file — just not through TorBox's CDN.
    try {
      const web = await this.addWebDownload(uri);
      const info = await this.waitForWebReady(
        web.id,
        onProgress,
        shouldContinue
      );
      const files = info?.files ?? [];
      const target = selectTorBoxDownloadFile(
        files,
        targetFileName,
        fileIndices
      );

      // Builds before 1.1.39 always requested an on-the-fly ZIP for web
      // downloads. Keep that exact byte stream only for an already-existing
      // legacy .zip partial; new and matching resumes use TorBox's raw file
      // endpoint, which supports Range and refreshed links.
      const legacyGeneratedZip = isLegacyTorBoxGeneratedZip(
        resumingFilename,
        target
      );

      const url = await this.requestWebLink(
        web.id,
        target && !legacyGeneratedZip ? target.id : undefined
      );
      const name = legacyGeneratedZip
        ? resumingFilename
        : target
          ? target.short_name || target.name
          : info?.name ?? web.name ?? undefined;
      logger.log(
        target && !legacyGeneratedZip
          ? `[torbox] resolved resumable web file url (fileId=${target.id})`
          : legacyGeneratedZip
            ? "[torbox] preserving legacy generated-zip identity for an existing partial"
            : "[torbox] web download has multiple files; resolved whole-download zip"
      );
      onProgress?.({
        progress: 1,
        downloadSpeed: 0,
        eta: 0,
        phase: "cached",
      });
      return { url, name };
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      if (status === 500 && allowDirectFallback) {
        logger.log(
          `[torbox] TorBox API couldn't scan this hoster after 3 retries — downloading directly from source: ${redactTorBoxSensitiveText(uri)}`
        );
        // Return the original URL for the JS HTTP downloader to fetch
        // directly. The download still works — just at the hoster's native
        // speed instead of TorBox's accelerated CDN.
        onProgress?.({
          progress: 1,
          downloadSpeed: 0,
          eta: 0,
          phase: "direct-fallback",
        });
        return { url: uri, name: undefined };
      }
      throw err;
    }
  }

  /** Remove a web download from TorBox (used to drop losing race candidates). */
  static async deleteWebDownload(id: number): Promise<void> {
    try {
      await this.instance.post("/webdl/controlwebdownload", {
        webdl_id: id,
        operation: "delete",
      });
    } catch {
      // Best-effort cleanup — a leftover web download is harmless; don't spam.
    }
  }

  /**
   * Add a hoster link to TorBox and sample how fast it's being served, for
   * racing several mirrors. Returns the TorBox web-download id (so the winner
   * resolves instantly and losers can be deleted) plus the best observed speed.
   */
  static async probeWebSpeed(
    uri: string,
    sampleMs = 10000
  ): Promise<{ id: number | null; speed: number }> {
    try {
      const web = await this.addWebDownload(uri);
      let best = 0;
      const deadline = Date.now() + sampleMs;
      while (Date.now() < deadline) {
        const info = await this.getWebDownloadInfo(web.id);
        const speed = info?.download_speed ?? 0;
        if (speed > best) best = speed;
        if (info?.download_finished || (info?.progress ?? 0) >= 1) {
          return { id: web.id, speed: Number.MAX_SAFE_INTEGER };
        }
        await this.sleep(1500);
      }
      return { id: web.id, speed: best };
    } catch {
      logger.log(
        `[torbox] mirror not usable, skipping: ${redactTorBoxSensitiveText(uri)}`
      );
      return { id: null, speed: 0 };
    }
  }
}
