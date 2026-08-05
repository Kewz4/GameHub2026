import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { logger } from "../logger";
import {
  applySkip,
  clampProgress,
  computeFileSize,
  isRetryableDownloadError,
  isRetryableHttpStatus,
  MAX_BUDGET_RESETS,
  parseRetryAfterMs,
  PROGRESS_RESET_THRESHOLD_BYTES,
  resolveResumeAction,
  shouldResetRetryBudget,
  stallDetected,
} from "./js-http-downloader-helpers";

export interface JsHttpDownloaderStatus {
  folderName: string;
  fileSize: number;
  progress: number;
  downloadSpeed: number;
  numPeers: number;
  numSeeds: number;
  status: "active" | "paused" | "complete" | "error";
  bytesDownloaded: number;
  isReconnecting: boolean;
  isRecovering: boolean;
  recoveryProgress: number;
}

export interface JsHttpDownloaderOptions {
  url: string;
  savePath: string;
  filename?: string;
  headers?: Record<string, string>;
  /** Resolve a fresh signed/mirrored URL without changing the local target. */
  refreshUrl?: () => Promise<string>;
}

const MAX_RETRY_ATTEMPTS = 10;
const MAX_STATUS_RETRY_ATTEMPTS = 4;
const MAX_RETRY_AFTER_MS = 20000;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 15000;
const STALL_TIMEOUT_MS = 30000;
const STALL_CHECK_INTERVAL_MS = 2000;
const RECONNECT_RETRY_DELAY_MS = 500;
const MAX_CONSECUTIVE_SOURCE_REFRESHES = 3;
const RESUME_PROBE_BYTES = 64 * 1024;
export const DEFAULT_DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

class HttpDownloadStatusError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly retryable = false,
    public readonly retryAfterMs: number | null = null
  ) {
    super(`The download link is not available (HTTP ${statusCode}).`);
    this.name = "HttpDownloadStatusError";
  }
}

class ResumeSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeSafetyError";
  }
}

export class JsHttpDownloader {
  private abortController: AbortController | null = null;
  private writeStream: fs.WriteStream | null = null;
  private currentOptions: JsHttpDownloaderOptions | null = null;
  private resolvedFilename: string | null = null;

  private bytesDownloaded = 0;
  private fileSize = 0;
  private downloadSpeed = 0;
  private status: "active" | "paused" | "complete" | "error" = "paused";
  private folderName = "";
  private lastSpeedUpdate = Date.now();
  private bytesAtLastSpeedUpdate = 0;
  private isDownloading = false;

  private retryCount = 0;
  private statusRetryCount = 0;
  private budgetResets = 0;
  private attemptBytesWritten = 0;
  private consecutiveSourceRefreshes = 0;
  private pendingReadSince: number | null = null;
  private stallCheckInterval: NodeJS.Timeout | null = null;
  private isPaused = false;
  private isStallRetry = false;
  private isReconnecting = false;
  private isReconnectRetry = false;
  private isRecovering = false;
  private recoverBytesTotal = 0;
  private recoverBytesDone = 0;
  private recoverSpeedLastUpdate = Date.now();
  private recoverBytesAtLastUpdate = 0;
  private maxDownloadSpeedBytesPerSecond: number | null = null;
  private throttleWindowStart = Date.now();
  private bytesTransferredInThrottleWindow = 0;

  setMaxDownloadSpeedBytesPerSecond(limit: number | null): void {
    if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
      this.maxDownloadSpeedBytesPerSecond = null;
    } else {
      this.maxDownloadSpeedBytesPerSecond = Math.floor(limit);
    }

    this.resetThrottleWindow();
  }

  async startDownload(options: JsHttpDownloaderOptions): Promise<void> {
    if (this.isDownloading) {
      logger.log(
        "[JsHttpDownloader] Download already in progress, resuming..."
      );
      return this.resumeDownload();
    }

    this.currentOptions = options;
    this.isPaused = false;
    this.retryCount = 0;
    this.statusRetryCount = 0;
    this.budgetResets = 0;
    this.attemptBytesWritten = 0;
    this.consecutiveSourceRefreshes = 0;
    this.isStallRetry = false;
    this.isReconnecting = false;
    this.isReconnectRetry = false;
    this.resetRecoveryState();
    this.fileSize = 0;
    this.resolvedFilename = null;
    this.pendingReadSince = null;
    this.resetThrottleWindow();
    await this.startDownloadWithRetry();
  }

  private async startDownloadWithRetry(): Promise<void> {
    if (!this.currentOptions) return;

    try {
      while (!this.isPaused) {
        if (!this.currentOptions) return;

        this.abortController = new AbortController();
        this.status = "active";
        this.isDownloading = true;
        this.isStallRetry = false;
        this.pendingReadSince = null;
        this.attemptBytesWritten = 0;

        const { url, savePath, filename, headers = {} } = this.currentOptions;
        const { filePath, startByte, usedFallback } = this.prepareDownloadPath(
          savePath,
          filename,
          url
        );
        const requestHeaders = this.buildRequestHeaders(headers, startByte);

        this.startStallDetection();

        try {
          await this.executeDownload(
            url,
            requestHeaders,
            filePath,
            startByte,
            savePath,
            usedFallback
          );
          break;
        } catch (err) {
          const shouldRetry = await this.handleDownloadErrorWithRetry(
            err as Error
          );
          if (!shouldRetry) {
            break;
          }
        } finally {
          this.stopStallDetection();
          this.cleanupResources();
        }
      }
    } finally {
      this.isDownloading = false;
    }
  }

  private startStallDetection(): void {
    this.stopStallDetection();
    this.stallCheckInterval = setInterval(() => {
      if (this.status !== "active" || this.isPaused || this.isStallRetry) {
        return;
      }

      if (stallDetected(this.pendingReadSince, Date.now(), STALL_TIMEOUT_MS)) {
        const blockedSeconds = Math.round(
          (Date.now() - (this.pendingReadSince ?? Date.now())) / 1000
        );
        logger.log(
          `[JsHttpDownloader] Read blocked for ${blockedSeconds}s with no data, triggering retry`
        );
        this.triggerRetry();
      }
    }, STALL_CHECK_INTERVAL_MS);
  }

  private stopStallDetection(): void {
    if (this.stallCheckInterval) {
      clearInterval(this.stallCheckInterval);
      this.stallCheckInterval = null;
    }
  }

  private triggerRetry(): void {
    this.isStallRetry = true;
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  private async handleDownloadErrorWithRetry(err: Error): Promise<boolean> {
    if (this.isPaused) {
      logger.log("[JsHttpDownloader] Download paused/cancelled by user");
      this.status = "paused";
      return false;
    }

    const wasStallRetry = this.isStallRetry;
    const wasReconnect = this.isReconnectRetry;
    this.isReconnectRetry = false;
    const isAbortError = err.name === "AbortError";
    const isRetryable =
      wasStallRetry || wasReconnect || isRetryableDownloadError(err);
    const transientStatus =
      err instanceof HttpDownloadStatusError && err.retryable;

    this.maybeResetRetryBudget();

    if (
      err instanceof ResumeSafetyError ||
      (err instanceof HttpDownloadStatusError && !err.retryable)
    ) {
      const refreshed = await this.refreshSourceUrl(err.message);
      if (refreshed) return !this.isPaused;
    }

    if (transientStatus) {
      return this.handleTransientStatusError(err as HttpDownloadStatusError);
    }

    if (wasReconnect) {
      logger.log(
        `[JsHttpDownloader] Reconnecting after a network change; resuming in ${RECONNECT_RETRY_DELAY_MS}ms`
      );
      await this.sleep(RECONNECT_RETRY_DELAY_MS);
      return !this.isPaused;
    }

    if (isRetryable && this.retryCount < MAX_RETRY_ATTEMPTS) {
      this.retryCount++;
      this.isReconnecting = true;
      this.downloadSpeed = 0;
      const delay = Math.min(
        INITIAL_RETRY_DELAY_MS * Math.pow(2, this.retryCount - 1),
        MAX_RETRY_DELAY_MS
      );

      const reason = wasStallRetry ? "stall detected" : err.message;
      logger.log(
        `[JsHttpDownloader] Retryable error (${reason}). ` +
          `Retry ${this.retryCount}/${MAX_RETRY_ATTEMPTS} in ${delay}ms`
      );

      await this.sleep(delay);
      return !this.isPaused;
    }

    if (wasStallRetry) {
      this.handleDownloadError(
        new Error(
          "Download stalled repeatedly and could not be resumed after multiple retries."
        )
      );
      return false;
    }

    if (isAbortError) {
      logger.log("[JsHttpDownloader] Download aborted");
      this.status = "paused";
      return false;
    }

    this.handleDownloadError(err);
    return false;
  }

  private async refreshSourceUrl(reason: string): Promise<boolean> {
    const refreshUrl = this.currentOptions?.refreshUrl;
    if (!refreshUrl || this.isPaused) return false;

    if (
      this.consecutiveSourceRefreshes >= MAX_CONSECUTIVE_SOURCE_REFRESHES
    ) {
      logger.warn(
        `[JsHttpDownloader] Source refresh limit reached; preserving the partial (${reason})`
      );
      return false;
    }

    this.consecutiveSourceRefreshes += 1;
    this.isReconnecting = true;
    this.downloadSpeed = 0;
    logger.log(
      `[JsHttpDownloader] Refreshing the temporary source URL (${this.consecutiveSourceRefreshes}/${MAX_CONSECUTIVE_SOURCE_REFRESHES})`
    );

    try {
      const nextUrl = (await refreshUrl()).trim();
      if (!nextUrl) throw new Error("The source returned an empty download URL");
      if (!this.currentOptions) return false;
      this.currentOptions = { ...this.currentOptions, url: nextUrl };
      return true;
    } catch (refreshError) {
      logger.warn(
        "[JsHttpDownloader] Could not refresh the temporary source URL",
        refreshError
      );
      return false;
    }
  }

  private maybeResetRetryBudget(): void {
    if (
      shouldResetRetryBudget(
        this.attemptBytesWritten,
        this.budgetResets,
        PROGRESS_RESET_THRESHOLD_BYTES,
        MAX_BUDGET_RESETS
      )
    ) {
      logger.log(
        "[JsHttpDownloader] Data is flowing again; resetting retry budget"
      );
      this.retryCount = 0;
      this.statusRetryCount = 0;
      this.budgetResets += 1;
    }
  }

  private async handleTransientStatusError(
    statusError: HttpDownloadStatusError
  ): Promise<boolean> {
    if (this.statusRetryCount >= MAX_STATUS_RETRY_ATTEMPTS) {
      this.handleDownloadError(
        new Error(
          `The download server is rate-limiting or temporarily unavailable (HTTP ${statusError.statusCode}). Try again later or use another source.`
        )
      );
      return false;
    }

    this.statusRetryCount++;
    const backoff = Math.min(
      INITIAL_RETRY_DELAY_MS * Math.pow(2, this.statusRetryCount - 1),
      MAX_RETRY_DELAY_MS
    );
    const delay =
      statusError.retryAfterMs === null
        ? backoff
        : Math.min(statusError.retryAfterMs, MAX_RETRY_AFTER_MS);
    logger.log(
      `[JsHttpDownloader] Server unavailable (HTTP ${statusError.statusCode}). ` +
        `Retry ${this.statusRetryCount}/${MAX_STATUS_RETRY_ATTEMPTS} in ${delay}ms`
    );
    await this.sleep(delay);
    return !this.isPaused;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private resetThrottleWindow(): void {
    this.throttleWindowStart = Date.now();
    this.bytesTransferredInThrottleWindow = 0;
  }

  private async applyThrottle(chunkSize: number): Promise<void> {
    const limit = this.maxDownloadSpeedBytesPerSecond;
    if (!limit) return;

    while (!this.isPaused && !this.abortController?.signal.aborted) {
      const now = Date.now();
      const elapsed = now - this.throttleWindowStart;

      if (elapsed >= 1000) {
        this.throttleWindowStart = now;
        this.bytesTransferredInThrottleWindow = 0;
      }

      const availableBytes = limit - this.bytesTransferredInThrottleWindow;
      if (
        availableBytes >= chunkSize ||
        this.bytesTransferredInThrottleWindow === 0
      ) {
        this.bytesTransferredInThrottleWindow += chunkSize;
        return;
      }

      const waitMs = Math.max(1, 1000 - elapsed);
      await this.sleep(waitMs);
    }
  }

  private prepareDownloadPath(
    savePath: string,
    filename: string | undefined,
    url: string
  ): { filePath: string; startByte: number; usedFallback: boolean } {
    const extractedFilename =
      this.resolvedFilename || filename || this.extractFilename(url);
    const usedFallback = !extractedFilename;
    const resolvedFilename = extractedFilename || "download";
    this.folderName = resolvedFilename;
    const filePath = path.join(savePath, resolvedFilename);

    if (!fs.existsSync(savePath)) {
      fs.mkdirSync(savePath, { recursive: true });
    }

    const targetDir = path.dirname(filePath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let startByte = 0;
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      startByte = stats.size;
      logger.log(`[JsHttpDownloader] Resuming download from byte ${startByte}`);
    }

    this.bytesDownloaded = startByte;
    this.resetSpeedTracking();
    return { filePath, startByte, usedFallback };
  }

  private buildRequestHeaders(
    headers: Record<string, string>,
    startByte: number
  ): Record<string, string> {
    const requestHeaders: Record<string, string> = { ...headers };

    const hasUserAgentHeader = Object.keys(requestHeaders).some(
      (key) => key.toLowerCase() === "user-agent"
    );

    if (!hasUserAgentHeader) {
      requestHeaders["User-Agent"] = DEFAULT_DOWNLOAD_USER_AGENT;
    }

    const hasAcceptEncoding = Object.keys(requestHeaders).some(
      (key) => key.toLowerCase() === "accept-encoding"
    );

    if (!hasAcceptEncoding) {
      requestHeaders["Accept-Encoding"] = "identity";
    }

    if (startByte > 0) {
      requestHeaders["Range"] = `bytes=${startByte}-`;
    }
    return requestHeaders;
  }

  private resetSpeedTracking(): void {
    this.lastSpeedUpdate = Date.now();
    this.bytesAtLastSpeedUpdate = this.bytesDownloaded;
    this.downloadSpeed = 0;
  }

  private parseFileSize(response: Response, startByte: number): void {
    const size = computeFileSize({
      status: response.status,
      contentRange: response.headers.get("content-range"),
      contentLength: response.headers.get("content-length"),
      startByte,
    });

    if (size !== null) {
      this.fileSize = size;
    }
  }

  private parseTotalSizeFrom416(response: Response): number | null {
    const contentRange = response.headers.get("content-range");
    if (!contentRange) return null;

    const match = /bytes\s+\*\/(\d+)/i.exec(contentRange);
    if (!match) return null;

    const total = Number.parseInt(match[1], 10);
    return Number.isFinite(total) && total > 0 ? total : null;
  }

  private parseContentRangeStart(response: Response): number | null {
    const contentRange = response.headers.get("content-range");
    if (!contentRange) return null;

    const match = /bytes\s+(\d+)-/i.exec(contentRange);
    if (!match) return null;

    const start = Number.parseInt(match[1], 10);
    return Number.isFinite(start) ? start : null;
  }

  private parseContentRange(response: Response): {
    start: number;
    end: number;
    total: number;
  } | null {
    const contentRange = response.headers.get("content-range");
    if (!contentRange) return null;

    const match = /bytes\s+(\d+)-(\d+)\/(\d+)/i.exec(contentRange);
    if (!match) return null;

    const start = Number.parseInt(match[1], 10);
    const end = Number.parseInt(match[2], 10);
    const total = Number.parseInt(match[3], 10);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      !Number.isSafeInteger(total)
    ) {
      return null;
    }

    return { start, end, total };
  }

  /**
   * Verify a small byte window immediately before the append point. A 206 by
   * itself only proves that a server supports Range; it does not prove that a
   * refreshed signed URL still points at the same object as the local partial.
   */
  private async verifyResumeContinuity(
    url: string,
    requestHeaders: Record<string, string>,
    filePath: string,
    startByte: number,
    downloadResponse: Response
  ): Promise<void> {
    const probeLength = Math.min(RESUME_PROBE_BYTES, startByte);
    const probeStart = startByte - probeLength;
    const probeEnd = startByte - 1;
    const expectedRange = this.parseContentRange(downloadResponse);

    if (
      downloadResponse.status !== 206 ||
      !expectedRange ||
      expectedRange.start > startByte ||
      expectedRange.total < startByte
    ) {
      throw new ResumeSafetyError(
        "The download server did not provide a trustworthy Content-Range for the append request."
      );
    }

    const probeResponse = await fetch(url, {
      headers: {
        ...requestHeaders,
        Range: `bytes=${probeStart}-${probeEnd}`,
      },
      signal: this.abortController?.signal,
    });

    try {
      if (probeResponse.status >= 400) {
        throw new HttpDownloadStatusError(
          probeResponse.status,
          isRetryableHttpStatus(probeResponse.status),
          parseRetryAfterMs(
            probeResponse.headers.get("retry-after"),
            Date.now()
          )
        );
      }

      const probeRange = this.parseContentRange(probeResponse);
      const encoding = (
        probeResponse.headers.get("content-encoding") ?? ""
      )
        .toLowerCase()
        .trim();
      if (
        probeResponse.status !== 206 ||
        !probeRange ||
        probeRange.start !== probeStart ||
        probeRange.end !== probeEnd ||
        probeRange.total !== expectedRange.total ||
        (encoding && encoding !== "identity")
      ) {
        throw new ResumeSafetyError(
          "The download server did not honor the resume verification range exactly."
        );
      }

      if (!probeResponse.body) {
        throw new ResumeSafetyError(
          "The download server returned an empty resume verification body."
        );
      }

      const remote = Buffer.alloc(probeLength);
      const reader = probeResponse.body.getReader();
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.length > probeLength) {
          await reader.cancel().catch(() => undefined);
          throw new ResumeSafetyError(
            "The download server returned more resume verification data than requested."
          );
        }
        remote.set(value, received);
        received += value.length;
      }

      if (received !== probeLength) {
        throw new ResumeSafetyError(
          "The download server returned an incomplete resume verification window."
        );
      }

      const local = Buffer.alloc(probeLength);
      const localFile = await fs.promises.open(filePath, "r");
      try {
        const { bytesRead } = await localFile.read(
          local,
          0,
          probeLength,
          probeStart
        );
        if (bytesRead !== probeLength || !local.equals(remote)) {
          throw new ResumeSafetyError(
            "The refreshed source does not match the existing partial at the resume boundary."
          );
        }
      } finally {
        await localFile.close();
      }
    } finally {
      await probeResponse.body?.cancel().catch(() => undefined);
    }
  }

  private async executeDownload(
    url: string,
    requestHeaders: Record<string, string>,
    filePath: string,
    startByte: number,
    savePath: string,
    usedFallback: boolean
  ): Promise<void> {
    const response = await fetch(url, {
      headers: requestHeaders,
      signal: this.abortController?.signal,
    });

    const contentType = response.headers.get("content-type") ?? "unknown";
    const contentLength = response.headers.get("content-length") ?? "unknown";
    logger.log(
      `[JsHttpDownloader] Response status=${response.status} content-type=${contentType} content-length=${contentLength}`
    );

    if (response.status === 416 && startByte > 0) {
      const remoteTotalSize = this.parseTotalSizeFrom416(response);

      if (remoteTotalSize !== null && startByte === remoteTotalSize) {
        this.fileSize = remoteTotalSize;
        this.bytesDownloaded = remoteTotalSize;
        this.status = "complete";
        this.retryCount = 0;
        this.downloadSpeed = 0;

        logger.log(
          "[JsHttpDownloader] Range not satisfiable but local file already complete"
        );
        return;
      }

      throw new Error(
        `[JsHttpDownloader] Range not satisfiable for resumed download (local=${startByte}, remote=${remoteTotalSize ?? "unknown"}). Keeping local file and aborting to avoid restart from zero.`
      );
    }

    if (response.status >= 400) {
      throw new HttpDownloadStatusError(
        response.status,
        isRetryableHttpStatus(response.status),
        parseRetryAfterMs(response.headers.get("retry-after"), Date.now())
      );
    }

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Detect HTML error pages served with 200 status (e.g. expired CDN links)
    if (
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml")
    ) {
      throw new Error(
        `The download link returned a web page instead of a file. It may have expired or be invalid.`
      );
    }

    if (startByte > 0 && response.status === 200) {
      const remoteSize = Number.parseInt(contentLength, 10);
      await response.body?.cancel().catch(() => undefined);

      if (Number.isSafeInteger(remoteSize) && remoteSize === startByte) {
        this.fileSize = remoteSize;
        this.bytesDownloaded = remoteSize;
        this.status = "complete";
        this.retryCount = 0;
        this.statusRetryCount = 0;
        this.consecutiveSourceRefreshes = 0;
        this.downloadSpeed = 0;
        logger.log(
          "[JsHttpDownloader] Local file size already matches the remote object; no transfer needed"
        );
        return;
      }

      throw new ResumeSafetyError(
        `The server ignored the byte-range request for a ${startByte}-byte partial. The existing file was kept unchanged; refusing to re-download and discard that prefix.`
      );
    }

    if (startByte > 0) {
      try {
        await this.verifyResumeContinuity(
          url,
          requestHeaders,
          filePath,
          startByte,
          response
        );
      } catch (error) {
        await response.body?.cancel().catch(() => undefined);
        throw error;
      }
    }

    const action = resolveResumeAction({
      startByte,
      status: response.status,
      partialStart: this.parseContentRangeStart(response),
    });

    const { flags, skipBytes } = action;

    if (action.rejectReason) {
      await response.body?.cancel().catch(() => undefined);
      throw new ResumeSafetyError(
        `The server returned an unsafe resume response (${action.rejectReason}). The ${startByte}-byte partial was kept unchanged.`
      );
    }

    const contentEncoding = (response.headers.get("content-encoding") ?? "")
      .toLowerCase()
      .trim();
    if (contentEncoding && contentEncoding !== "identity" && startByte > 0) {
      await response.body?.cancel().catch(() => undefined);
      throw new ResumeSafetyError(
        `The resumed response was ${contentEncoding}-encoded, so its byte offsets cannot be trusted. The ${startByte}-byte partial was kept unchanged.`
      );
    }

    if (skipBytes > 0) {
      logger.log(
        `[JsHttpDownloader] Partial response started before the resume offset; discarding ${skipBytes} overlapping body bytes.`
      );
    }

    this.parseFileSize(response, startByte);
    this.consecutiveSourceRefreshes = 0;

    // Resolve the on-disk filename once and pin it for the download's
    // lifetime so a later restart cannot orphan the existing partial.
    const writingFreshFile = flags === "w";
    let actualFilePath = filePath;
    if (writingFreshFile && this.resolvedFilename === null) {
      const urlDerivedFilename = path.basename(filePath);
      const headerFilename = this.parseContentDisposition(response);
      if (headerFilename) {
        if (headerFilename !== urlDerivedFilename) {
          logger.log(
            `[JsHttpDownloader] Filename mismatch detected. URL-derived="${urlDerivedFilename}" header-derived="${headerFilename}"`
          );
        }
        actualFilePath = path.join(savePath, headerFilename);
        this.folderName = headerFilename;
        this.resolvedFilename = headerFilename;
        const targetDir = path.dirname(actualFilePath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        logger.log(
          `[JsHttpDownloader] Using filename from Content-Disposition: ${headerFilename}`
        );
      } else {
        this.resolvedFilename = path.basename(actualFilePath);
        if (usedFallback) {
          logger.log(
            "[JsHttpDownloader] Content-Disposition filename not found, using fallback filename"
          );
        }
      }
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    this.writeStream = fs.createWriteStream(actualFilePath, { flags });

    const readableStream = this.createReadableStream(
      response.body.getReader(),
      skipBytes
    );
    await pipeline(readableStream, this.writeStream);

    this.status = "complete";
    this.retryCount = 0;
    this.statusRetryCount = 0;
    this.budgetResets = 0;
    this.isReconnecting = false;
    this.resetRecoveryState();
    this.downloadSpeed = 0;
    logger.log(
      `[JsHttpDownloader] Download complete (${this.bytesDownloaded} bytes)`
    );
  }

  private parseContentDisposition(response: Response): string | undefined {
    const header = response.headers.get("content-disposition");
    if (!header) return undefined;

    const filenameStarMatch = /filename\*\s*=\s*([^;]+)/i.exec(header);
    if (filenameStarMatch?.[1]) {
      const rawValue = filenameStarMatch[1].trim().replace(/^["']|["']$/g, "");
      const encodedPart = rawValue.includes("''")
        ? rawValue.split("''").slice(1).join("''")
        : rawValue;
      const decoded = this.decodeFilenameValue(encodedPart);
      if (decoded) return decoded;
    }

    const filenameMatch = /filename\s*=\s*([^;]+)/i.exec(header);
    if (filenameMatch?.[1]) {
      const rawValue = filenameMatch[1].trim().replace(/^["']|["']$/g, "");
      const decoded = this.decodeFilenameValue(rawValue);
      if (decoded) return decoded;
    }

    return undefined;
  }

  private decodeFilenameValue(value: string): string | undefined {
    const normalized = value.trim();
    if (!normalized) return undefined;

    const sanitize = (name: string) =>
      path
        .basename(name)
        .replaceAll(/[<>:"/\\|?*]/g, "_")
        .split("")
        .filter((char) => char.charCodeAt(0) >= 32)
        .join("")
        .trim();

    try {
      const decoded = decodeURIComponent(normalized);
      const sanitized = sanitize(decoded);
      return sanitized || undefined;
    } catch {
      const sanitized = sanitize(normalized);
      return sanitized || undefined;
    }
  }

  private resetRecoveryState(): void {
    this.isRecovering = false;
    this.recoverBytesTotal = 0;
    this.recoverBytesDone = 0;
    this.recoverBytesAtLastUpdate = 0;
  }

  private trackRecoveredBytes(skipped: number): void {
    if (!this.isRecovering || skipped <= 0) return;

    this.recoverBytesDone += skipped;
    const now = Date.now();
    const elapsed = (now - this.recoverSpeedLastUpdate) / 1000;
    if (elapsed >= 1) {
      this.downloadSpeed = Math.max(
        0,
        (this.recoverBytesDone - this.recoverBytesAtLastUpdate) / elapsed
      );
      this.recoverSpeedLastUpdate = now;
      this.recoverBytesAtLastUpdate = this.recoverBytesDone;
    }
  }

  private finishRecovery(): void {
    if (!this.isRecovering) return;

    this.isRecovering = false;
    this.recoverBytesDone = this.recoverBytesTotal;
    this.resetSpeedTracking();
  }

  private createReadableStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    skipBytes = 0
  ): Readable {
    const applyThrottle = this.applyThrottle.bind(this);
    const markReadPending = () => {
      this.pendingReadSince = Date.now();
    };
    const clearReadPending = () => {
      this.pendingReadSince = null;
    };
    const applyRecoveryTracking = (
      plan: ReturnType<typeof applySkip>,
      length: number
    ) => {
      const skipped = plan.shouldWrite ? plan.writeOffset : length;
      if (skipped > 0) this.trackRecoveredBytes(skipped);
      if (plan.newRemainingToSkip === 0) this.finishRecovery();
    };
    const onChunk = (length: number) => {
      if (this.isReconnecting) {
        this.isReconnecting = false;
      }
      this.attemptBytesWritten += length;
      this.bytesDownloaded += length;
      this.updateSpeed();
    };
    let remainingToSkip = skipBytes;

    return new Readable({
      read() {
        void (async () => {
          try {
            for (;;) {
              markReadPending();
              const { done, value } = await reader.read();
              clearReadPending();

              if (done) {
                if (remainingToSkip > 0) {
                  this.destroy(
                    new Error(
                      `[JsHttpDownloader] Server body shorter than the existing partial (missing ${remainingToSkip} bytes); refusing to append a truncated file.`
                    )
                  );
                  return;
                }
                this.push(null);
                return;
              }

              const plan = applySkip(remainingToSkip, value.length);
              remainingToSkip = plan.newRemainingToSkip;
              applyRecoveryTracking(plan, value.length);
              if (!plan.shouldWrite) {
                continue;
              }

              const chunk =
                plan.writeOffset > 0 ? value.subarray(plan.writeOffset) : value;
              await applyThrottle(chunk.length);
              onChunk(chunk.length);
              this.push(Buffer.from(chunk));
              return;
            }
          } catch (err) {
            clearReadPending();
            this.destroy(err as Error);
          }
        })();
      },
      destroy(err, callback) {
        reader
          .cancel()
          .catch(() => undefined)
          .finally(() => callback(err));
      },
    });
  }

  private handleDownloadError(err: Error): void {
    this.isReconnecting = false;
    this.resetRecoveryState();
    if (
      err.name === "AbortError" ||
      (err as NodeJS.ErrnoException).code === "ERR_STREAM_PREMATURE_CLOSE"
    ) {
      logger.log("[JsHttpDownloader] Download aborted");
      this.status = "paused";
    } else {
      logger.error("[JsHttpDownloader] Download error:", err);
      this.status = "error";
      throw err;
    }
  }

  private async resumeDownload(): Promise<void> {
    if (!this.currentOptions) {
      throw new Error("No download options available for resume");
    }
    this.isDownloading = false;
    this.isPaused = false;
    this.retryCount = 0;
    this.statusRetryCount = 0;
    this.budgetResets = 0;
    this.attemptBytesWritten = 0;
    this.consecutiveSourceRefreshes = 0;
    this.isStallRetry = false;
    this.isReconnecting = false;
    this.isReconnectRetry = false;
    this.resetRecoveryState();
    this.pendingReadSince = null;
    await this.startDownloadWithRetry();
  }

  setReconnecting(value: boolean): void {
    this.isReconnecting = value;
    if (value) {
      this.downloadSpeed = 0;
    }
  }

  reconnect(): void {
    if (!this.isDownloading || this.isPaused) return;

    logger.log(
      "[JsHttpDownloader] Network change detected; reconnecting and resuming"
    );
    this.isReconnecting = true;
    this.isReconnectRetry = true;
    this.downloadSpeed = 0;
    this.pendingReadSince = null;
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  stopForNoNetwork(): void {
    logger.log(
      "[JsHttpDownloader] No internet connection; pausing download and keeping the partial file"
    );
    this.isReconnecting = false;
    this.pauseDownload();
  }

  pauseDownload(): void {
    logger.log("[JsHttpDownloader] Pausing download");
    this.isPaused = true;
    this.pendingReadSince = null;
    this.stopStallDetection();
    if (this.abortController) {
      this.abortController.abort();
    }
    this.status = "paused";
    this.downloadSpeed = 0;
  }

  cancelDownload(deleteFile = true): void {
    logger.log("[JsHttpDownloader] Cancelling download");
    this.isPaused = true;
    this.pendingReadSince = null;
    this.stopStallDetection();

    if (this.abortController) {
      this.abortController.abort();
    }

    this.cleanupResources();

    if (deleteFile && this.currentOptions && this.status !== "complete") {
      const filePath = path.join(this.currentOptions.savePath, this.folderName);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          logger.log("[JsHttpDownloader] Deleted partial file");
        } catch (err) {
          logger.error(
            "[JsHttpDownloader] Failed to delete partial file:",
            err
          );
        }
      }
    }

    this.reset();
  }

  getDownloadStatus(): JsHttpDownloaderStatus | null {
    if (!this.currentOptions && this.status !== "active") {
      return null;
    }

    let progress = 0;
    if (this.status === "complete") {
      progress = 1;
    } else if (this.fileSize > 0) {
      progress = clampProgress(this.bytesDownloaded / this.fileSize);
    }

    return {
      folderName: this.folderName,
      fileSize: this.fileSize,
      progress,
      downloadSpeed: this.downloadSpeed,
      numPeers: 0,
      numSeeds: 0,
      status: this.status,
      bytesDownloaded: this.bytesDownloaded,
      isReconnecting: this.isReconnecting,
      isRecovering: this.isRecovering,
      recoveryProgress:
        this.recoverBytesTotal > 0
          ? clampProgress(this.recoverBytesDone / this.recoverBytesTotal)
          : 0,
    };
  }

  private updateSpeed(): void {
    const now = Date.now();
    const elapsed = (now - this.lastSpeedUpdate) / 1000;

    if (elapsed >= 1) {
      const bytesDelta = this.bytesDownloaded - this.bytesAtLastSpeedUpdate;
      this.downloadSpeed = bytesDelta / elapsed;
      this.lastSpeedUpdate = now;
      this.bytesAtLastSpeedUpdate = this.bytesDownloaded;
    }
  }

  private extractFilename(url: string): string | undefined {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const pathParts = pathname.split("/");
      const filename = pathParts.at(-1);

      if (filename?.includes(".") && filename.length > 0) {
        return decodeURIComponent(filename);
      }
    } catch {
      // Invalid URL
    }
    return undefined;
  }

  private cleanupResources(): void {
    if (this.writeStream) {
      this.writeStream.destroy();
      this.writeStream = null;
    }
    this.abortController = null;
  }

  private reset(): void {
    this.currentOptions = null;
    this.resolvedFilename = null;
    this.bytesDownloaded = 0;
    this.fileSize = 0;
    this.downloadSpeed = 0;
    this.status = "paused";
    this.folderName = "";
    this.isDownloading = false;
    this.retryCount = 0;
    this.statusRetryCount = 0;
    this.budgetResets = 0;
    this.attemptBytesWritten = 0;
    this.consecutiveSourceRefreshes = 0;
    this.pendingReadSince = null;
    this.isStallRetry = false;
    this.isReconnecting = false;
    this.isReconnectRetry = false;
    this.resetRecoveryState();
    this.resetThrottleWindow();
  }
}
