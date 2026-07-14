import axios from "axios";
import { logger } from "../logger";

interface UnlockResponse {
  link: string;
  hoster: string;
}

export class VikingFileApi {
  public static async getDownloadUrl(uri: string): Promise<string> {
    const nimbusApiUrl = import.meta.env.MAIN_VITE_NIMBUS_API_URL;

    // When the Nimbus API URL is configured, use it to unlock the VikingFile
    // link (resolves to a direct CDN URL). When it's empty/unconfigured (e.g.
    // in builds where the env var wasn't set), fall back to downloading the
    // VikingFile URL directly — the JS HTTP downloader will follow redirects
    // and handle the download. This isn't as fast as the Nimbus proxy but
    // it's better than ERR_INVALID_URL.
    if (nimbusApiUrl) {
      try {
        const unlockResponse = await axios.post<UnlockResponse>(
          `${nimbusApiUrl}/hosters/unlock`,
          { url: uri }
        );

        if (!unlockResponse.data.link) {
          throw new Error("Failed to unlock VikingFile URL");
        }

        const redirectUrl = unlockResponse.data.link;

        try {
          const redirectResponse = await axios.head(redirectUrl, {
            maxRedirects: 0,
            validateStatus: (status) =>
              status === 301 || status === 302 || status === 200,
          });

          if (
            redirectResponse.headers.location ||
            redirectResponse.status === 301 ||
            redirectResponse.status === 302
          ) {
            return redirectResponse.headers.location || redirectUrl;
          }

          return redirectUrl;
        } catch (error) {
          logger.error(
            `[VikingFile] Error following redirect, using redirect URL:`,
            error
          );
          return redirectUrl;
        }
      } catch (error) {
        logger.error(
          `[VikingFile] Nimbus unlock failed, falling back to direct:`,
          error
        );
        return uri;
      }
    }

    // No Nimbus API URL configured — return the VikingFile URL directly.
    // The JS HTTP downloader will follow any redirects to the actual file.
    logger.log(`[VikingFile] No Nimbus API URL — downloading directly: ${uri}`);
    return uri;
  }
}
