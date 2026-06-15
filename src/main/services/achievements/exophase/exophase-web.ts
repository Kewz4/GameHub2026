import { BrowserWindow } from "electron";
import { EXOPHASE_PARTITION } from "./constants";

/**
 * Exophase (and its `api.` subdomain) sit behind Cloudflare, which blocks plain
 * HTTP clients (axios/net get a 403 challenge page). The official Playnite
 * extension works around this by routing every request through a WebView so the
 * Chromium network stack solves the JS challenge and carries the logged-in
 * cookies.
 *
 * We mirror that here with a single hidden BrowserWindow bound to the
 * `persist:exophase` session. It is reused across many sequential fetches
 * during a sync (creating one window per game would be far too heavy) and
 * destroyed when the caller is done.
 */
export class ExophaseFetcher {
  private win: BrowserWindow | null = null;

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      show: false,
      webPreferences: {
        partition: EXOPHASE_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        // A real (non-offscreen) hidden window renders fully, which keeps
        // Cloudflare happy.
        offscreen: false,
        backgroundThrottling: false,
      },
    });
    return this.win;
  }

  private navigateAndExtract(
    url: string,
    extractor: string,
    timeoutMs = 25_000
  ): Promise<string> {
    const win = this.ensureWindow();
    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        clearTimeout(timer);
        win.webContents.off("did-finish-load", onLoad);
        win.webContents.off("did-fail-load", onFail);
      };

      const finish = async () => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          const text: string = await win.webContents.executeJavaScript(
            extractor,
            true
          );
          resolve(text ?? "");
        } catch (err) {
          reject(err);
        }
      };

      const onLoad = () => void finish();
      const onFail = (
        _e: unknown,
        errorCode: number,
        errorDescription: string
      ) => {
        // -3 (ERR_ABORTED) fires for client-side redirects; ignore it and let
        // the subsequent navigation resolve.
        if (errorCode === -3) return;
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          new Error(`Exophase load failed (${errorCode}): ${errorDescription}`)
        );
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Exophase request timed out"));
      }, timeoutMs);

      win.webContents.on("did-finish-load", onLoad);
      win.webContents.on("did-fail-load", onFail);
      win.loadURL(url).catch(onFail as never);
    });
  }

  /** Returns the fully rendered page HTML. */
  fetchHtml(url: string): Promise<string> {
    return this.navigateAndExtract(url, "document.documentElement.outerHTML");
  }

  /** Loads a JSON endpoint and parses the rendered body text. */
  async fetchJson<T>(url: string): Promise<T | null> {
    const text = await this.navigateAndExtract(
      url,
      "document.body ? document.body.innerText : ''"
    );
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  /** Reads `window.me.username` off the current page (set by Exophase when the
   *  visitor is authenticated). Returns null when logged out. */
  async readCurrentUsername(): Promise<string | null> {
    const win = this.win;
    if (!win || win.isDestroyed()) return null;
    try {
      const username: string | null = await win.webContents.executeJavaScript(
        "(window.me && window.me.username) ? String(window.me.username) : null",
        true
      );
      return username || null;
    } catch {
      return null;
    }
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
