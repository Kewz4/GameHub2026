import axios from "axios";
import FormData from "form-data";
import fs from "node:fs";
import crypto from "node:crypto";
import type { GameArtifact, GameArtifactWithGame, GameShop } from "@types";
import { logger } from "./logger";

const UPLOAD_BASE = "https://upload.uploadcare.com/base/";
const API_BASE = "https://api.uploadcare.com";
const CDN_BASE = "https://ucarecdn.com";

const PUBLIC_KEY = "4d9173a6d85878abcd29";
const SECRET_KEY = "4d7348da747422d46005";

const AUTH_HEADER = `Uploadcare.Simple ${PUBLIC_KEY}:${SECRET_KEY}`;

export class UploadcareSync {
  /** Upload a file and tag it with metadata for later lookup. Returns the Uploadcare UUID. */
  static async uploadFile(
    filePath: string,
    metadata: Record<string, string>
  ): Promise<string> {
    const form = new FormData();
    form.append("UPLOADCARE_PUB_KEY", PUBLIC_KEY);
    form.append("UPLOADCARE_STORE", "1");
    form.append("file", fs.createReadStream(filePath), {
      filename: `${metadata.shop}-${metadata.objectId}-${Date.now()}.tar`,
      contentType: "application/tar",
    });

    // Embed metadata directly in the upload form so it's always stored
    for (const [key, value] of Object.entries(metadata)) {
      form.append(`metadata[${key}]`, value);
    }

    const uploadRes = await axios.post<{ file: string }>(UPLOAD_BASE, form, {
      headers: form.getHeaders(),
      timeout: 120_000,
    });

    const uuid = uploadRes.data.file;

    // Also PATCH metadata for APIs that need it via the REST endpoint
    try {
      await axios.patch(`${API_BASE}/files/${uuid}/metadata/`, metadata, {
        headers: {
          Authorization: AUTH_HEADER,
          "Content-Type": "application/json",
          Accept: "application/vnd.uploadcare-v0.7+json",
        },
      });
    } catch (metaErr) {
      logger.error(`Uploadcare: metadata patch failed for ${uuid}`, metaErr);
    }

    logger.log(`Uploadcare: uploaded ${uuid} with metadata`, metadata);
    return uuid;
  }

  /**
   * Upload an image file to Uploadcare and return its CDN URL.
   * Used for profile photos and banner images.
   */
  static async uploadImage(
    filePath: string,
    metadata?: Record<string, string>
  ): Promise<string> {
    const mimeType = await (
      await import("file-type")
    ).fileTypeFromFile(filePath);
    const form = new FormData();
    form.append("UPLOADCARE_PUB_KEY", PUBLIC_KEY);
    form.append("UPLOADCARE_STORE", "1");
    form.append("file", fs.createReadStream(filePath), {
      filename: `profile-${Date.now()}${mimeType ? `.${mimeType.ext}` : ""}`,
      contentType: mimeType?.mime ?? "image/webp",
    });

    if (metadata) {
      for (const [key, value] of Object.entries(metadata)) {
        form.append(`metadata[${key}]`, value);
      }
    }

    const res = await axios.post<{ file: string }>(UPLOAD_BASE, form, {
      headers: form.getHeaders(),
      timeout: 60_000,
    });

    const uuid = res.data.file;
    logger.log(`Uploadcare: uploaded image ${uuid}`);
    return `${CDN_BASE}/${uuid}/`;
  }

  /** Find the newest uploaded image tagged with the given kind for a Hydra
   * account (e.g. profile banner), so it can be restored on any install. */
  static async findLatestImageByKind(
    kind: string,
    hydraUserId: string
  ): Promise<string | null> {
    try {
      const results = await this.fetchAllFiles();
      const match = results.find(
        (f) =>
          f.metadata?.kind === kind && f.metadata?.hydraUserId === hydraUserId
      );
      return match ? `${CDN_BASE}/${match.uuid}/` : null;
    } catch {
      return null;
    }
  }

  /** Strip everything except letters and digits, lowercase. The Uploadcare
   * CDN does the same to filenames, so legacy uploads can only be matched
   * after normalizing both sides. */
  private static normalizeName(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/gi, "");
  }

  /** Fetch all files for the project, following pagination (up to maxPages).
   * Uploadcare's list endpoint does not support filtering by metadata, so
   * all filtering happens client-side. */
  private static async fetchAllFiles(maxPages = 5): Promise<any[]> {
    const files: any[] = [];
    let url: string | null =
      `${API_BASE}/files/?ordering=-datetime_uploaded&limit=100`;

    for (let page = 0; page < maxPages && url; page++) {
      const res = await axios.get(url, {
        headers: {
          Authorization: AUTH_HEADER,
          Accept: "application/vnd.uploadcare-v0.7+json",
        },
        timeout: 20_000,
      });
      files.push(...(res.data.results ?? []));
      url = res.data.next ?? null;
    }

    return files;
  }

  /** List save artifacts for a game, newest first. `gameTitle` enables
   * matching legacy uploads whose filename encodes the title. */
  static async listArtifacts(
    userId: string,
    shop: GameShop,
    objectId: string,
    gameTitle?: string | null
  ): Promise<GameArtifact[]> {
    const results = await this.fetchAllFiles();

    const idPrefix = this.normalizeName(`${shop}-${objectId}-`);
    const titlePrefix = gameTitle
      ? this.normalizeName(`${shop}-${gameTitle}-`)
      : null;

    return results
      .filter((f) => {
        const meta = f.metadata ?? {};
        // Note: deliberately NOT filtering by userId here — a reinstall
        // generates a fresh cloudSyncUserId and would orphan every existing
        // backup. The shop+objectId match is the real identity.
        void userId;
        if (meta.shop && meta.objectId) {
          if (meta.shop !== shop) return false;
          // Exact objectId match — or title-as-objectId legacy match
          if (meta.objectId === objectId) return true;
          if (gameTitle != null && meta.objectId === gameTitle) return true;
          // Ludusavi imports that stored the game title as objectId will have
          // the right filename even if we don't have the title available.
          // Fall through to filename matching so they still show up.
          const filename = this.normalizeName(
            (f.original_filename as string) ?? ""
          );
          if (titlePrefix && filename.startsWith(titlePrefix)) return true;
          return false;
        }
        // Legacy uploads (no metadata): match by filename.
        // Format is `{shop}-{objectId}-{timestamp}.tar`; older builds used
        // the game title instead of the objectId.
        const filename = this.normalizeName(
          (f.original_filename as string) ?? ""
        );
        if (filename.startsWith(idPrefix)) return true;
        if (titlePrefix && filename.startsWith(titlePrefix)) return true;
        return false;
      })
      .map((f) => ({
        id: f.uuid as string,
        artifactLengthInBytes: f.size as number,
        downloadOptionTitle:
          (f.metadata?.downloadOptionTitle as string) ?? null,
        createdAt: f.datetime_uploaded as string,
        updatedAt: f.datetime_uploaded as string,
        hostname: (f.metadata?.hostname as string) ?? "",
        downloadCount: 0,
        label: (f.metadata?.label as string) ?? undefined,
        isFrozen: false,
      }));
  }

  /** List all save artifacts across all games for a user, newest first. */
  static async listAllArtifacts(
    userId: string
  ): Promise<GameArtifactWithGame[]> {
    const results = await this.fetchAllFiles();

    // Note: not filtering by userId — a reinstall generates a fresh
    // cloudSyncUserId and would orphan every existing backup.
    void userId;
    return results
      .filter(
        (f) =>
          f.metadata?.shop &&
          f.metadata?.objectId &&
          f.metadata.shop !== "undefined" &&
          f.metadata.objectId !== "nan"
      )
      .map((f) => ({
        id: f.uuid as string,
        artifactLengthInBytes: f.size as number,
        downloadOptionTitle:
          (f.metadata?.downloadOptionTitle as string) ?? null,
        createdAt: f.datetime_uploaded as string,
        updatedAt: f.datetime_uploaded as string,
        hostname: (f.metadata?.hostname as string) ?? "",
        downloadCount: 0,
        label: (f.metadata?.label as string) ?? undefined,
        isFrozen: false,
        shop: f.metadata.shop as GameShop,
        objectId: f.metadata.objectId as string,
        gameName: (f.metadata?.gameName as string) ?? undefined,
        gameTitle: "",
        gameIconUrl: null,
      }));
  }

  /** Download a file by UUID to a local path. */
  static async downloadFile(uuid: string, destPath: string): Promise<void> {
    // Fetch the actual CDN URL from the REST API so we use the exact URL
    // Uploadcare has for this file (handles custom CDN domains and avoids
    // 404s from constructing the URL manually).
    let downloadUrl = `${CDN_BASE}/${uuid}/`;
    try {
      const info = await axios.get<{ original_file_url?: string; cdn_url?: string }>(
        `${API_BASE}/files/${uuid}/`,
        {
          headers: {
            Authorization: AUTH_HEADER,
            Accept: "application/vnd.uploadcare-v0.7+json",
          },
          timeout: 10_000,
        }
      );
      const url = info.data.original_file_url ?? info.data.cdn_url;
      if (url) downloadUrl = url;
    } catch {
      // ignore — fall through to the default CDN URL
    }

    const res = await axios.get(downloadUrl, {
      responseType: "arraybuffer",
      timeout: 120_000,
    });
    await fs.promises.writeFile(destPath, Buffer.from(res.data as ArrayBuffer));
    logger.log(`Uploadcare: downloaded ${uuid} → ${destPath}`);
  }

  /** Delete a file by UUID. */
  static async deleteFile(uuid: string): Promise<void> {
    // Try DELETE /files/{uuid}/ first; fall back to the storage endpoint
    // if the primary returns 405 (some account tiers restrict it).
    try {
      await axios.delete(`${API_BASE}/files/${uuid}/`, {
        headers: {
          Authorization: AUTH_HEADER,
          Accept: "application/vnd.uploadcare-v0.7+json",
        },
      });
    } catch (err: any) {
      if (err?.response?.status === 405) {
        // Use batch delete endpoint as fallback
        await axios.delete(`${API_BASE}/files/storage/`, {
          headers: {
            Authorization: AUTH_HEADER,
            Accept: "application/vnd.uploadcare-v0.7+json",
            "Content-Type": "application/json",
          },
          data: [uuid],
        });
      } else {
        throw err;
      }
    }
    logger.log(`Uploadcare: deleted ${uuid}`);
  }

  /**
   * Create an Uploadcare file group from a list of file UUIDs.
   * Useful for grouping all saves for a game or profile images per user.
   * Returns the group ID in the format "{uuid}~{count}".
   * https://uploadcare.com/docs/api/upload/#tag/Groups/operation/createFilesGroup
   */
  static async createGroup(uuids: string[]): Promise<string> {
    const form = new FormData();
    form.append("pub_key", PUBLIC_KEY);
    uuids.forEach((uuid, i) => form.append(`files[${i}]`, uuid));

    const res = await axios.post<{ id: string }>(
      "https://upload.uploadcare.com/group/",
      form,
      {
        headers:
          (
            form as unknown as { getHeaders(): Record<string, string> }
          ).getHeaders?.() ?? {},
        timeout: 20_000,
      }
    );

    logger.log(
      `Uploadcare: created group ${res.data.id} with ${uuids.length} files`
    );
    return res.data.id;
  }

  /** Generate a stable user ID to namespace uploads. */
  static generateUserId(): string {
    return crypto.randomUUID();
  }
}
