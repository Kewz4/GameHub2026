import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { app } from "electron";
import type { GameArtifact, GameArtifactWithGame, GameShop } from "@types";
import { logger } from "./logger";

/**
 * Cloudflare R2 (S3-compatible) backing store for cloud saves and profile
 * images, replacing Uploadcare. Credentials are baked in deliberately: this is
 * a private build shared between friends, the same way the Uploadcare keys were
 * embedded before. R2 gives us real folders, so everything is namespaced under
 * a per-user prefix:
 *
 *   users/{userId}/saves/{shop}/{objectId}/{timestamp}.tar
 *   users/{userId}/images/{kind}.{ext}
 *   users/{userId}/preferences/settings.json
 *
 * The class keeps the exact method surface the old UploadcareSync exposed so
 * callers are unchanged; an artifact "id" is simply the R2 object key, and
 * images are served to the renderer through the local: protocol after being
 * cached on disk (no public bucket or presigner needed — every client holds
 * the same credentials and reads objects directly).
 */
const R2_ENDPOINT =
  "https://f27692e18d99d566ad3a04766f3142ef.r2.cloudflarestorage.com";
const R2_BUCKET = "gamehub";
const R2_ACCESS_KEY_ID = "d1b400e239d7d9832c70635fa56087f2";
const R2_SECRET_ACCESS_KEY =
  "97b5b7909b038b5e86387dd065b5f58e3fd5920b5cb23af659ef2b8ab58392dc";

export interface EmulationSaveMetadata {
  userId: string;
  platform: string;
  emulator: string;
  saveIdentity: string;
  fileName: string;
  label?: string | null;
  shop?: string | null;
  objectId?: string | null;
  localLastModifiedAt?: string | null;
  hostname?: string | null;
}

export interface EmulationArtifact {
  id: string;
  platform: string;
  emulator: "duckstation" | "pcsx2";
  saveIdentity: string;
  fileName: string;
  label: string | null;
  shop: string | null;
  objectId: string | null;
  artifactLengthInBytes: number;
  hostname: string;
  localLastModifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const enc = (v: string | undefined | null): string =>
  encodeURIComponent(v ?? "");
const dec = (v: string | undefined | null): string => {
  try {
    return decodeURIComponent(v ?? "");
  } catch {
    return v ?? "";
  }
};

export class R2Sync {
  private static _client: S3Client | null = null;

  private static get client(): S3Client {
    if (!this._client) {
      this._client = new S3Client({
        region: "auto",
        endpoint: R2_ENDPOINT,
        credentials: {
          accessKeyId: R2_ACCESS_KEY_ID,
          secretAccessKey: R2_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
        // aws-sdk v3 >= ~3.729 enables flexible checksums (CRC32 trailers) by
        // default, which Cloudflare R2's S3 API rejects — uploads fail with a
        // checksum/streaming-trailer error. Force checksums to WHEN_REQUIRED so
        // the SDK only sends them where the API mandates it. Without this, every
        // PutObject to R2 breaks.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
    }
    return this._client;
  }

  private static imageCacheDir(): string {
    const dir = path.join(app.getPath("userData"), "r2-image-cache");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // ── Saves ──────────────────────────────────────────────────────────────

  /**
   * Upload a save bundle. `metadata` carries userId/shop/objectId plus optional
   * label/downloadOptionTitle/gameName/hostname. Returns the R2 object key
   * (used everywhere the old code used the Uploadcare UUID).
   */
  static async uploadFile(
    filePath: string,
    metadata: Record<string, string>
  ): Promise<string> {
    const userId = metadata.userId || "anonymous";
    const shop = metadata.shop || "unknown";
    const objectId = metadata.objectId || "unknown";
    const key = `users/${userId}/saves/${shop}/${objectId}/${Date.now()}-${crypto
      .randomBytes(4)
      .toString("hex")}.tar`;

    const stat = await fs.promises.stat(filePath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentLength: stat.size,
        ContentType: "application/tar",
        // S3 metadata values must be ASCII — URI-encode anything user-facing.
        Metadata: {
          shop,
          objectid: objectId,
          gamename: enc(metadata.gameName),
          label: enc(metadata.label),
          downloadoptiontitle: enc(metadata.downloadOptionTitle),
          hostname: enc(metadata.hostname),
          platform: metadata.platform ?? "",
        },
      })
    );

    logger.log(`R2: uploaded save ${key}`);
    return key;
  }

  /** Download an object (by key) to a local path. */
  static async downloadFile(key: string, destPath: string): Promise<void> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: key })
    );
    const body = res.Body as Readable;
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(destPath);
      body.pipe(out);
      body.on("error", reject);
      out.on("finish", resolve);
      out.on("error", reject);
    });
    logger.log(`R2: downloaded ${key} → ${destPath}`);
  }

  /** Delete an object by key. */
  static async deleteFile(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key })
    );
    logger.log(`R2: deleted ${key}`);
  }

  private static async headArtifact(key: string) {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })
      );
      return head;
    } catch {
      return null;
    }
  }

  /** List save artifacts for a single game, newest first. */
  static async listArtifacts(
    userId: string,
    shop: GameShop,
    objectId: string,
    gameTitle?: string | null
  ): Promise<GameArtifact[]> {
    // Backups are normally keyed by objectId, but legacy Ludusavi imports stored
    // the game title as the objectId segment (e.g. "Neon Abyss" instead of
    // "788100"). Query both prefixes so the per-game view matches the sidebar.
    const segments = new Set<string>([objectId]);
    if (gameTitle && gameTitle !== objectId) segments.add(gameTitle);

    const lists = await Promise.all(
      Array.from(segments).map((segment) =>
        this.client
          .send(
            new ListObjectsV2Command({
              Bucket: R2_BUCKET,
              Prefix: `users/${userId}/saves/${shop}/${segment}/`,
            })
          )
          .catch(() => null)
      )
    );

    const seen = new Set<string>();
    const objects = lists
      .flatMap((list) => list?.Contents ?? [])
      .filter((o) => {
        if (!o.Key || seen.has(o.Key)) return false;
        seen.add(o.Key);
        return true;
      });

    const artifacts = await Promise.all(
      objects.map(async (o) => {
        const head = await this.headArtifact(o.Key!);
        const m = head?.Metadata ?? {};
        return {
          id: o.Key!,
          artifactLengthInBytes: o.Size ?? 0,
          downloadOptionTitle: dec(m.downloadoptiontitle) || null,
          createdAt: (o.LastModified ?? new Date()).toISOString(),
          updatedAt: (o.LastModified ?? new Date()).toISOString(),
          hostname: dec(m.hostname),
          downloadCount: 0,
          label: dec(m.label) || undefined,
          isFrozen: false,
        } as GameArtifact;
      })
    );

    return artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** List every save artifact for a user, across all games, newest first. */
  static async listAllArtifacts(
    userId: string
  ): Promise<GameArtifactWithGame[]> {
    const prefix = `users/${userId}/saves/`;
    const list = await this.client
      .send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix }))
      .catch(() => null);

    const objects = (list?.Contents ?? []).filter((o) => o.Key);
    const artifacts = await Promise.all(
      objects.map(async (o) => {
        // key: users/{userId}/saves/{shop}/{objectId}/{file}
        const rest = o.Key!.slice(prefix.length).split("/");
        const shop = rest[0] as GameShop;
        const objectId = rest[1] ?? "";
        const head = await this.headArtifact(o.Key!);
        const m = head?.Metadata ?? {};
        return {
          id: o.Key!,
          artifactLengthInBytes: o.Size ?? 0,
          downloadOptionTitle: dec(m.downloadoptiontitle) || null,
          createdAt: (o.LastModified ?? new Date()).toISOString(),
          updatedAt: (o.LastModified ?? new Date()).toISOString(),
          hostname: dec(m.hostname),
          downloadCount: 0,
          label: dec(m.label) || undefined,
          isFrozen: false,
          shop,
          objectId,
          gameName: dec(m.gamename) || undefined,
          gameTitle: "",
          gameIconUrl: null,
        } as GameArtifactWithGame;
      })
    );

    return artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ── Profile images ─────────────────────────────────────────────────────

  /**
   * Upload a profile image to a deterministic key so any client can find it by
   * (hydraUserId, kind) without a listing. Returns the R2 key.
   */
  static async uploadImage(
    filePath: string,
    metadata?: Record<string, string>
  ): Promise<string> {
    const hydraUserId = metadata?.hydraUserId || "anonymous";
    const kind = metadata?.kind || "image";
    const mimeType = await (
      await import("file-type")
    ).fileTypeFromFile(filePath);
    const ext = mimeType?.ext ?? "webp";
    const key = `users/${hydraUserId}/images/${kind}.${ext}`;

    const stat = await fs.promises.stat(filePath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentLength: stat.size,
        ContentType: mimeType?.mime ?? "image/webp",
        Metadata: { kind, hydrauserid: hydraUserId },
      })
    );

    logger.log(`R2: uploaded image ${key}`);
    return key;
  }

  /**
   * Locate a user's profile image by kind, download it to the local cache and
   * return a local: URL the renderer can display. Tries the common extensions
   * since the stored key includes the original file extension.
   */
  static async findLatestImageByKind(
    kind: string,
    hydraUserId: string
  ): Promise<string | null> {
    // One list call instead of probing each extension with 404-ing GETs: the
    // image is stored as images/{kind}.{ext}, so match by basename === kind.
    const prefix = `users/${hydraUserId}/images/`;
    const list = await this.client
      .send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix }))
      .catch(() => null);

    const match = (list?.Contents ?? []).find((o) => {
      const name = o.Key?.slice(prefix.length) ?? "";
      return name.slice(0, name.lastIndexOf(".")) === kind;
    });
    if (!match?.Key) return null;

    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: match.Key })
      );
      const ext = match.Key.slice(match.Key.lastIndexOf(".") + 1) || "img";
      const dest = path.join(
        this.imageCacheDir(),
        `${hydraUserId}-${kind}.${ext}`
      );
      const body = res.Body as Readable;
      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(dest);
        body.pipe(out);
        body.on("error", reject);
        out.on("finish", resolve);
        out.on("error", reject);
      });
      return `local:${dest.replace(/\\/g, "/")}`;
    } catch {
      return null;
    }
  }

  // ── Preferences (settings backup) ────────────────────────────────────────

  static async uploadPreferences(userId: string, json: string): Promise<void> {
    const key = `users/${userId}/preferences/settings.json`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: Buffer.from(json, "utf8"),
        ContentType: "application/json",
      })
    );
    logger.log(`R2: uploaded preferences for ${userId}`);
  }

  static async downloadPreferences(userId: string): Promise<string | null> {
    const key = `users/${userId}/preferences/settings.json`;
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: key })
      );
      const text = await res.Body?.transformToString();
      return text ?? null;
    } catch {
      return null;
    }
  }

  // ── Shared blobs (community caches, not per-user) ─────────────────────────

  /**
   * Upload a shared JSON blob under `shared/{name}`. Used for the cross-user
   * Exophase achievement-definition cache so friends share fetch work.
   */
  static async uploadSharedJson(name: string, json: string): Promise<void> {
    const key = `shared/${name}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: Buffer.from(json, "utf8"),
        ContentType: "application/json",
      })
    );
    logger.log(`R2: uploaded shared blob ${key} (${json.length} bytes)`);
  }

  static async downloadSharedJson(name: string): Promise<string | null> {
    const key = `shared/${name}`;
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: key })
      );
      const text = await res.Body?.transformToString();
      return text ?? null;
    } catch {
      return null;
    }
  }

  /** No-op kept for API parity with the old Uploadcare grouping. */
  static async createGroup(_uuids: string[]): Promise<string> {
    void _uuids;
    return "";
  }

  static generateUserId(): string {
    return crypto.randomUUID();
  }

  // ── Emulation saves ────────────────────────────────────────────────────

  /**
   * Upload an emulation save buffer to R2.
   * Key: users/{userId}/emulation-saves/{platform}/{saveIdentity}/{timestamp}-{random}.{ext}
   * Returns the R2 key.
   */
  static async uploadEmulationSave(
    buffer: Buffer,
    metadata: EmulationSaveMetadata
  ): Promise<string> {
    const ext = metadata.fileName.includes(".")
      ? metadata.fileName.slice(metadata.fileName.lastIndexOf(".") + 1)
      : "bin";
    const key = `users/${metadata.userId}/emulation-saves/${metadata.platform}/${enc(metadata.saveIdentity)}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentLength: buffer.length,
        ContentType: "application/octet-stream",
        Metadata: {
          platform: metadata.platform,
          emulator: metadata.emulator,
          saveidentity: enc(metadata.saveIdentity),
          filename: enc(metadata.fileName),
          label: enc(metadata.label ?? ""),
          shop: metadata.shop ?? "",
          objectid: metadata.objectId ?? "",
          locallastmodifiedat: metadata.localLastModifiedAt ?? "",
          hostname: enc(metadata.hostname ?? ""),
        },
      })
    );

    logger.log(`R2: uploaded emulation save ${key}`);
    return key;
  }

  /**
   * List emulation save artifacts for a user, optionally filtered by platform.
   * Fetches metadata for each object via HeadObject.
   */
  static async listEmulationSaves(
    userId: string,
    platform?: string
  ): Promise<EmulationArtifact[]> {
    const prefix = platform
      ? `users/${userId}/emulation-saves/${platform}/`
      : `users/${userId}/emulation-saves/`;

    const list = await this.client
      .send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix }))
      .catch(() => null);

    const objects = (list?.Contents ?? []).filter((o) => o.Key);

    const artifacts = await Promise.all(
      objects.map(async (o) => {
        const head = await this.headArtifact(o.Key!);
        const m = head?.Metadata ?? {};
        return {
          id: o.Key!,
          platform: m.platform ?? "",
          emulator: m.emulator ?? ("" as EmulationArtifact["emulator"]),
          saveIdentity: dec(m.saveidentity),
          fileName: dec(m.filename),
          label: dec(m.label) || null,
          shop: m.shop || null,
          objectId: m.objectid || null,
          artifactLengthInBytes: o.Size ?? 0,
          hostname: dec(m.hostname),
          localLastModifiedAt: m.locallastmodifiedat || null,
          createdAt: (o.LastModified ?? new Date()).toISOString(),
          updatedAt: (o.LastModified ?? new Date()).toISOString(),
        } as EmulationArtifact;
      })
    );

    return artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Delete an emulation save object by its R2 key. */
  static async deleteEmulationSave(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key })
    );
    logger.log(`R2: deleted emulation save ${key}`);
  }

  /** Download an emulation save by R2 key, returning a Buffer. */
  static async downloadEmulationSave(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: key })
    );
    const bytes = await (res.Body as Readable & { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }

  /**
   * Update the label on an emulation save. R2 doesn't support in-place metadata
   * updates, so we copy the object to itself with updated metadata.
   */
  static async updateEmulationSaveLabel(
    key: string,
    newLabel: string
  ): Promise<void> {
    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })
    );
    const existingMeta = head.Metadata ?? {};
    const updatedMeta = { ...existingMeta, label: enc(newLabel) };

    await this.client.send(
      new CopyObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        CopySource: `${R2_BUCKET}/${key}`,
        Metadata: updatedMeta,
        MetadataDirective: "REPLACE",
      })
    );
    logger.log(`R2: updated label for emulation save ${key}`);
  }
}
