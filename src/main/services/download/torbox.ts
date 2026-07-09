import axios, { AxiosInstance } from "axios";
import parseTorrent from "parse-torrent";
import type {
  TorBoxUserRequest,
  TorBoxTorrentInfoRequest,
  TorBoxAddTorrentRequest,
  TorBoxRequestLinkRequest,
} from "@types";
import { appVersion } from "@main/constants";
import { logger } from "../logger";

/** Caching-phase progress TorBox reports while preparing a download. */
export interface TorBoxPrepareProgress {
  /** 0–1 fraction cached on TorBox's side. */
  progress: number;
  /** Bytes/sec TorBox is fetching at (for an ETA + live bar). */
  downloadSpeed: number;
  /** Seconds remaining per TorBox, or -1 if unknown. */
  eta: number;
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
  private static apiToken: string;

  // How long we'll wait for TorBox to finish caching non-cached content before
  // giving up (the download can be retried, which resumes the same TorBox job).
  private static readonly READY_TIMEOUT_MS = 5 * 60 * 1000;
  private static readonly POLL_INTERVAL_MS = 4000;

  static authorize(apiToken: string) {
    this.apiToken = apiToken;
    this.instance = axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "User-Agent": `Hydra/${appVersion}`,
      },
    });
  }

  private static sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
      throw new Error(response.data.detail);
    }

    return response.data.data;
  }

  static async getTorrentInfo(id: number) {
    const response =
      await this.instance.get<TorBoxTorrentInfoRequest>("/torrents/mylist");
    const data = response.data.data;

    const info = data.find((item) => item.id === id);

    if (!info) {
      return null;
    }

    return info;
  }

  static async getUser() {
    const response = await this.instance.get<TorBoxUserRequest>(`/user/me`);
    return response.data.data;
  }

  static async requestLink(id: number, fileId?: number) {
    const params: Record<string, string> = {
      token: this.apiToken,
      torrent_id: id.toString(),
    };
    // A specific file → download just that file (no giant all-files zip). This
    // is what fixes Minerva collection torrents dumping game+update+DLC into one
    // "Minerva_Myrient" zip: we ask only for the file this repack targets.
    if (fileId != null) {
      params.file_id = fileId.toString();
    } else {
      params.zip_link = "true";
    }
    const searchParams = new URLSearchParams(params);

    const response = await this.instance.get<TorBoxRequestLinkRequest>(
      "/torrents/requestdl?" + searchParams.toString()
    );

    return response.data.data;
  }

  private static async getAllTorrentsFromUser() {
    const response =
      await this.instance.get<TorBoxTorrentInfoRequest>("/torrents/mylist");

    return response.data.data;
  }

  private static async getTorrentIdAndName(magnetUri: string) {
    const userTorrents = await this.getAllTorrentsFromUser();

    const { infoHash } = await parseTorrent(magnetUri);
    const userTorrent = userTorrents.find(
      (userTorrent) => userTorrent.hash === infoHash
    );

    if (userTorrent) return { id: userTorrent.id, name: userTorrent.name };

    const torrent = await this.addMagnet(magnetUri);
    return { id: torrent.torrent_id, name: torrent.name };
  }

  /**
   * Poll a torrent until TorBox has finished fetching it to their servers (or we
   * time out). Reports caching progress/speed/ETA via `onProgress` so the app
   * can show a real "preparing download" bar instead of a static spinner.
   */
  private static async waitForTorrentReady(
    id: number,
    onProgress?: (p: TorBoxPrepareProgress) => void
  ) {
    const deadline = Date.now() + this.READY_TIMEOUT_MS;
    for (;;) {
      const info = await this.getTorrentInfo(id);
      const progress = info?.progress ?? 0;
      // Ready when TorBox has the FULL torrent: progress complete, a terminal
      // state, or it's in TorBox's instant cache (cached === true means fully
      // available — a mid-fetch torrent reports download_present, not cached).
      // This prevents grabbing a partial file while not stalling cached ones.
      const ready =
        info != null &&
        (progress >= 1 ||
          info.cached === true ||
          info.download_state === "completed" ||
          info.download_state === "cached" ||
          info.download_state === "uploading");
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
        });
      }
      if (ready) return info;
      if (Date.now() > deadline) {
        logger.warn(
          `[torbox] torrent ${id} NOT fully cached after ${this.READY_TIMEOUT_MS / 1000}s ` +
            `(state=${info?.download_state}, progress=${progress}); proceeding anyway`
        );
        return info;
      }
      await this.sleep(this.POLL_INTERVAL_MS);
    }
  }

  // ── Web downloads (any hoster link) ─────────────────────────────────────────

  private static async addWebDownload(link: string) {
    const form = new FormData();
    form.append("link", link);
    const response = await this.instance.post<{
      success: boolean;
      detail: string;
      data?: { webdownload_id?: number; id?: number; hash?: string; name?: string };
    }>("/webdl/createwebdownload", form);
    if (!response.data.success) {
      throw new Error(response.data.detail);
    }
    const data = response.data.data ?? {};
    return {
      id: (data.webdownload_id ?? data.id) as number,
      name: data.name,
      hash: data.hash,
    };
  }

  private static async getWebDownloadInfo(id: number) {
    const response = await this.instance.get<{
      data: Array<{
        id: number;
        name: string;
        cached?: boolean;
        download_present?: boolean;
        download_finished?: boolean;
        download_state?: string;
        progress?: number;
        download_speed?: number;
        eta?: number;
      }>;
    }>("/webdl/mylist");
    return response.data.data?.find((item) => item.id === id) ?? null;
  }

  private static async waitForWebReady(
    id: number,
    onProgress?: (p: TorBoxPrepareProgress) => void
  ) {
    const deadline = Date.now() + this.READY_TIMEOUT_MS;
    for (;;) {
      const info = await this.getWebDownloadInfo(id);
      const progress = info?.progress ?? 0;
      const ready =
        info != null &&
        (info.download_finished ||
          info.download_state === "completed" ||
          progress >= 1 ||
          (info.download_present && progress >= 1));
      if (info) {
        onProgress?.({
          progress,
          downloadSpeed: info.download_speed ?? 0,
          eta: info.eta ?? -1,
        });
      }
      if (ready) return info;
      if (Date.now() > deadline) {
        logger.warn(`[torbox] web download ${id} not fully ready after wait`);
        return info;
      }
      await this.sleep(this.POLL_INTERVAL_MS);
    }
  }

  private static async requestWebLink(id: number) {
    const searchParams = new URLSearchParams({
      token: this.apiToken,
      web_id: id.toString(),
      zip_link: "true",
    });
    const response = await this.instance.get<TorBoxRequestLinkRequest>(
      "/webdl/requestdl?" + searchParams.toString()
    );
    return response.data.data;
  }

  // ── Unified entry point ─────────────────────────────────────────────────────

  /**
   * Resolve a URI (magnet OR hoster link) into a direct TorBox download link,
   * waiting for TorBox to finish caching it first when necessary. When
   * `fileIndices` selects a single file (e.g. one game inside a Minerva
   * collection torrent), we request just that file instead of a whole-torrent
   * zip — so a base-game download doesn't drag in the update + DLC.
   */
  static async getDownloadInfo(
    uri: string,
    fileIndices?: number[],
    onProgress?: (p: TorBoxPrepareProgress) => void
  ) {
    const isMagnet = uri.startsWith("magnet:");

    if (isMagnet) {
      const torrentData = await this.getTorrentIdAndName(uri);
      const info = await this.waitForTorrentReady(torrentData.id, onProgress);

      // Map a single selected index to the TorBox file id (prefer id match,
      // fall back to positional). Multiple files still fall back to the zip.
      let fileId: number | undefined;
      let fileName: string | undefined;
      if (fileIndices && fileIndices.length === 1 && info?.files?.length) {
        const idx = fileIndices[0];
        const file =
          info.files.find((f) => f.id === idx) ?? info.files[idx] ?? null;
        if (file) {
          fileId = file.id;
          fileName = file.short_name || file.name;
        }
        logger.log(
          `[torbox] selecting file idx=${idx} → id=${file?.id} ` +
            `name=${file?.name} size=${file?.size}`
        );
      }
      if (info?.files?.length) {
        logger.log(
          `[torbox] torrent "${torrentData.name}" has ${info.files.length} file(s), ` +
            `total=${info.size} bytes; fileIndices=${JSON.stringify(fileIndices ?? null)}`
        );
      }

      const url = await this.requestLink(torrentData.id, fileId);
      const name =
        fileName ??
        (torrentData.name ? `${torrentData.name}.zip` : undefined);
      logger.log(`[torbox] resolved download url (fileId=${fileId ?? "zip"})`);
      return { url, name };
    }

    // Any other http(s) hoster link → TorBox web download.
    const web = await this.addWebDownload(uri);
    const info = await this.waitForWebReady(web.id, onProgress);
    const url = await this.requestWebLink(web.id);
    const name = (info?.name ?? web.name) ?? undefined;
    return { url, name };
  }

  /** Remove a web download from TorBox (used to drop losing race candidates). */
  static async deleteWebDownload(id: number): Promise<void> {
    try {
      const form = new FormData();
      form.append("web_id", id.toString());
      form.append("operation", "delete");
      await this.instance.post("/webdl/controlwebdownload", form);
    } catch (err) {
      logger.warn(`[torbox] failed to delete web download ${id}`, err);
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
        // Already fully cached → effectively "instant", rank it highest.
        if (info?.download_finished || (info?.progress ?? 0) >= 1) {
          return { id: web.id, speed: Number.MAX_SAFE_INTEGER };
        }
        await this.sleep(1500);
      }
      return { id: web.id, speed: best };
    } catch (err) {
      logger.warn(`[torbox] speed probe failed for ${uri}`, err);
      return { id: null, speed: 0 };
    }
  }
}
