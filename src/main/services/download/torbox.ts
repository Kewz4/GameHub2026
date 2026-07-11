import axios, { AxiosInstance } from "axios";
import parseTorrent from "parse-torrent";
import type {
  TorBoxUserRequest,
  TorBoxTorrentInfoRequest,
  TorBoxTorrentMetaInfoRequest,
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
  // Waiting for TorBox to pull one specific game out of a shared collection
  // torrent (from peers) can take longer than the generic cache wait; the user
  // watches a live "preparing" bar throughout, so allow a wider window.
  private static readonly TARGET_FILE_TIMEOUT_MS = 20 * 60 * 1000;
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

  /**
   * Read the torrent's file list from the BitTorrent metadata itself (NOT from
   * TorBox's cache). This lists every file in a shared collection torrent even
   * when TorBox has only cached some of them, so we can confirm the requested
   * game is really in there and wait for TorBox to fetch it instead of wrongly
   * refusing. Best-effort: returns null if the metadata can't be read in time.
   */
  static async getTorrentMetadata(magnetUri: string) {
    try {
      const searchParams = new URLSearchParams({
        magnet: magnetUri,
        timeout: "20",
      });
      const response = await this.instance.get<TorBoxTorrentMetaInfoRequest>(
        "/torrents/torrentinfo?" + searchParams.toString()
      );
      if (!response.data?.success) return null;
      return response.data.data ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Nudge a torrent that TorBox has parked. `reannounce` finds fresh peers for a
   * stalled fetch; `resume` un-pauses one. Used to push TorBox into actually
   * downloading the requested file of a partially-cached collection torrent.
   */
  private static async controlTorrent(
    id: number,
    operation: "reannounce" | "resume"
  ): Promise<void> {
    try {
      await this.instance.post("/torrents/controltorrent", {
        torrent_id: id,
        operation,
      });
    } catch {
      // Best-effort nudge — failure just means we wait for the next poll.
    }
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
    onProgress?: (p: TorBoxPrepareProgress) => void,
    /**
     * When set, "ready" means THIS specific file is available for download —
     * not merely that TorBox has some cached portion of the torrent. For shared
     * Minerva collection torrents TorBox may report `cached === true` while only
     * holding OTHER games' files; we must keep waiting (and nudging) until the
     * requested game's file actually lands, or we'd refuse a perfectly valid
     * download. Returns as soon as the file is present.
     */
    isTargetPresent?: (files: TorBoxTorrentInfoRequest["data"][number]["files"]) => boolean
  ) {
    // A per-file wait can legitimately take a while (TorBox is pulling the game
    // from peers), and the user sees a live "preparing" bar the whole time, so
    // give it a generous window before giving up.
    const timeout = isTargetPresent
      ? this.TARGET_FILE_TIMEOUT_MS
      : this.READY_TIMEOUT_MS;
    const deadline = Date.now() + timeout;
    let nudgedAt = 0;
    for (;;) {
      const info = await this.getTorrentInfo(id);
      const progress = info?.progress ?? 0;
      const files = info?.files ?? [];
      const targetHere = isTargetPresent ? isTargetPresent(files) : false;
      // With a target file we wait specifically for it; without one we fall back
      // to the whole-torrent readiness (single-file torrents / web parity).
      const ready = isTargetPresent
        ? targetHere
        : info != null &&
          (progress >= 1 ||
            info.cached === true ||
            info.download_state === "completed" ||
            info.download_state === "cached" ||
            info.download_state === "uploading");
      if (info) {
        logger.log(
          `[torbox] torrent ${id} state=${info.download_state} ` +
            `progress=${(progress * 100).toFixed(1)}% cached=${info.cached} ` +
            `speed=${info.download_speed} eta=${info.eta} files=${files.length}` +
            (isTargetPresent ? ` targetPresent=${targetHere}` : "")
        );
        onProgress?.({
          progress,
          downloadSpeed: info.download_speed ?? 0,
          eta: info.eta ?? -1,
        });
      }
      if (ready) return info;
      // Waiting on a specific file that hasn't arrived yet: if TorBox has parked
      // the fetch (stalled / paused / no active transfer), nudge it every ~20s so
      // it keeps pulling the requested file instead of sitting on the cache.
      if (isTargetPresent && info && Date.now() - nudgedAt > 20000) {
        const stalled =
          info.download_state === "stalled (no seeds)" ||
          info.download_state === "paused" ||
          (info.download_speed ?? 0) === 0;
        if (stalled) {
          nudgedAt = Date.now();
          void this.controlTorrent(
            id,
            info.download_state === "paused" ? "resume" : "reannounce"
          );
        }
      }
      if (Date.now() > deadline) {
        logger.warn(
          `[torbox] torrent ${id} target not ready after ${timeout / 1000}s ` +
            `(state=${info?.download_state}, progress=${progress})`
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
    onProgress?: (p: TorBoxPrepareProgress) => void,
    targetFileName?: string | null
  ) {
    const isMagnet = uri.startsWith("magnet:");

    if (isMagnet) {
      // Match the REQUESTED game's filename — the only reliable signal for a
      // shared collection torrent (Minerva). A fileIndex is computed against the
      // full collection and is meaningless once TorBox exposes a different/
      // partial file list, so it is NOT trusted for multi-file torrents.
      const norm = (s: string) =>
        s
          .toLowerCase()
          .replace(/^.*[\\/]/, "") // basename only
          .replace(/\.[a-z0-9]{1,5}$/, "") // drop extension
          .replace(/[^a-z0-9]/g, "");
      const want = targetFileName ? norm(targetFileName) : null;
      const matchTarget = <T extends { name: string }>(
        list: T[]
      ): T | null => {
        if (!want) return null;
        return (
          list.find((f) => norm(f.name) === want) ??
          list.find(
            (f) => norm(f.name).includes(want) || want.includes(norm(f.name))
          ) ??
          null
        );
      };

      const torrentData = await this.getTorrentIdAndName(uri);

      // Confirm the requested game is genuinely inside this torrent by reading
      // the file list from the BitTorrent metadata (independent of TorBox's
      // cache). If it's there, we KNOW waiting will pay off — TorBox just hasn't
      // fetched that file out of the shared collection yet.
      const meta = want ? await this.getTorrentMetadata(uri) : null;
      const metaHasTarget = meta?.files ? matchTarget(meta.files) != null : false;
      if (meta?.files?.length) {
        logger.log(
          `[torbox] torrent metadata "${meta.name}" lists ${meta.files.length} ` +
            `file(s); requested "${targetFileName}" present=${metaHasTarget}`
        );
      }

      // Wait until the SPECIFIC requested file is available on TorBox (not just
      // until "some cache" exists), nudging TorBox to keep fetching if it stalls.
      const info = await this.waitForTorrentReady(
        torrentData.id,
        onProgress,
        want ? (files) => matchTarget(files) != null : undefined
      );
      const files = info?.files ?? [];

      if (files.length) {
        logger.log(
          `[torbox] torrent "${torrentData.name}" has ${files.length} file(s), ` +
            `total=${info?.size} bytes; fileIndices=${JSON.stringify(fileIndices ?? null)}; ` +
            `target="${targetFileName ?? ""}"`
        );
      }

      // Select the ONE file to download. Priority:
      //   1. The requested game's filename match.
      //   2. A caller index that is actually in range (single-file torrents).
      //   3. The single file, when the torrent has exactly one.
      // If none match, we REFUSE rather than grab the largest file — guessing
      // "largest" is what downloaded the wrong game (Wind Waker not Twilight
      // Princess).
      let target: (typeof files)[number] | null = matchTarget(files);

      if (!target && fileIndices?.length === 1) {
        const idx = fileIndices[0];
        target =
          files.find((f) => f.id === idx) ??
          (idx >= 0 && idx < files.length ? files[idx] : null);
      }
      if (!target && files.length === 1) {
        target = files[0];
      }

      if (!target) {
        const available = files
          .map((f) => f.short_name || f.name)
          .join(", ");
        logger.error(
          `[torbox] no file in torrent "${torrentData.name}" matches requested ` +
            `"${targetFileName ?? "(unknown)"}" after waiting. ` +
            `Available: [${available}]. metaHasTarget=${metaHasTarget}`
        );
        // The requested file never became available on TorBox within the wait.
        // If the metadata confirms it IS in the torrent, TorBox simply couldn't
        // fetch it in time (retrying resumes the same job); otherwise the magnet
        // genuinely doesn't contain this game. Either way we surface a clear
        // TorBox error — the app is TorBox-only, so there is no fallback.
        const reason = metaHasTarget
          ? "TorBox couldn't finish fetching this game in time — please retry the download (it resumes where TorBox left off)."
          : `TorBox has the wrong torrent for this game (contains: ${available || "nothing"}).`;
        throw Object.assign(new Error(reason), { code: "TORBOX_WRONG_TORRENT" });
      }

      logger.log(
        `[torbox] selected file id=${target.id} name=${target.name} size=${target.size}`
      );
      const url = await this.requestLink(torrentData.id, target.id);
      const name = target.short_name || target.name;
      logger.log(`[torbox] resolved download url (fileId=${target.id})`);
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
      // TorBox's control endpoint expects a JSON body with `webdl_id`.
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
        // Already fully cached → effectively "instant", rank it highest.
        if (info?.download_finished || (info?.progress ?? 0) >= 1) {
          return { id: web.id, speed: Number.MAX_SAFE_INTEGER };
        }
        await this.sleep(1500);
      }
      return { id: web.id, speed: best };
    } catch {
      // TorBox can't fetch some niche hosts (500) — that mirror just loses the
      // race. Quiet: a failed probe returns 0 and is skipped.
      logger.log(`[torbox] mirror not usable, skipping: ${uri}`);
      return { id: null, speed: 0 };
    }
  }
}
