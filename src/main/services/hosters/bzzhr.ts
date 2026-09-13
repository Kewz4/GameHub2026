import { net } from "electron";
import {
  extractBzzhrTokenPath,
  isBzzhrDirectUri,
  isSafeBzzhrIntermediateRedirect,
  parseBzzhrUri,
  validateBzzhrDirectRedirect,
} from "@shared";
import { logger } from "../logger";

const BZZHR_BASE_URL = "https://bzzhr.to";
const STEAMRIP_REFERER = "https://steamrip.com/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const RESOLUTION_TIMEOUT_MS = 30_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_INTERMEDIATE_REDIRECTS = 3;

const requestHeaders = {
  "User-Agent": USER_AGENT,
  Referer: STEAMRIP_REFERER,
};

export class BzzhrApi {
  private static requestPage(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const request = net.request({
        url,
        method: "GET",
        credentials: "omit",
        cache: "no-store",
      });
      for (const [name, value] of Object.entries(requestHeaders)) {
        request.setHeader(name, value);
      }

      let settled = false;
      const finish = (error?: Error, value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value ?? "");
      };
      const timer = setTimeout(() => {
        request.abort();
        finish(new Error("bzzhr_request_timeout"));
      }, RESOLUTION_TIMEOUT_MS);

      request.on("response", (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.on("data", () => undefined);
          finish(new Error(`bzzhr_request_http_${response.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_PAGE_BYTES) {
            request.abort();
            finish(new Error("bzzhr_response_too_large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          finish(undefined, Buffer.concat(chunks).toString("utf8"))
        );
        response.on("error", (error) => finish(error));
      });
      request.on("error", (error) => finish(error));
      request.end();
    });
  }

  private static resolveTokenRedirect(
    id: string,
    tokenPath: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const request = net.request({
        url: `${BZZHR_BASE_URL}${tokenPath}`,
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "manual",
      });
      for (const [name, value] of Object.entries(requestHeaders)) {
        request.setHeader(name, value);
      }

      let settled = false;
      let intermediateRedirects = 0;
      const finish = (error?: Error, value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value ?? "");
      };
      const timer = setTimeout(() => {
        request.abort();
        finish(new Error("bzzhr_download_resolution_timeout"));
      }, RESOLUTION_TIMEOUT_MS);

      request.on("redirect", (_status, _method, redirectUrl) => {
        try {
          if (isBzzhrDirectUri(redirectUrl)) {
            finish(undefined, validateBzzhrDirectRedirect(redirectUrl, id));
            return;
          }

          intermediateRedirects += 1;
          if (
            intermediateRedirects > MAX_INTERMEDIATE_REDIRECTS ||
            !isSafeBzzhrIntermediateRedirect(redirectUrl)
          ) {
            finish(new Error("bzzhr_download_redirect_invalid"));
            return;
          }
          request.followRedirect();
        } catch (error) {
          finish(
            error instanceof Error
              ? error
              : new Error("bzzhr_download_redirect_invalid")
          );
        }
      });
      request.on("response", (response) => {
        response.on("data", () => undefined);
        finish(new Error("bzzhr_download_redirect_missing"));
      });
      request.on("error", (error) => finish(error));
      request.end();
    });
  }

  public static async getDownloadUrl(uri: string): Promise<string> {
    const parsed = parseBzzhrUri(uri);
    if (!parsed) throw new Error("bzzhr_url_invalid");
    if (parsed.kind === "direct") return parsed.url.toString();

    logger.log(`[Bzzhr] Resolving SteamRip link (${parsed.id})`);
    const html = await this.requestPage(parsed.url.toString());
    const tokenPath = extractBzzhrTokenPath(html, parsed.id);
    return this.resolveTokenRedirect(parsed.id, tokenPath);
  }
}
