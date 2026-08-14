import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectsCommand,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { app } from "electron";
import type {
  AchievementSouvenirRecord,
  CloudSaveV2LibraryEntry,
  GameArtifact,
  GameArtifactWithGame,
  GameShop,
} from "@types";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";
import { getR2Credentials, R2_BUCKET, R2_ENDPOINT } from "./r2-credentials";
import { registerR2CredentialSessionInvalidator } from "./r2-credential-session";
import {
  assertR2CloudSaveV2HeadConsistency,
  serializeCanonicalR2CloudSaveJson,
  validateR2CloudSaveV2ControlDocument,
  validateR2CloudSaveV2SnapshotDocument,
  type R2CloudSaveV2ControlDocument,
  type R2CloudSaveV2Head,
  type R2CloudSaveV2SnapshotDocument,
} from "./cloud-save/r2-snapshot-contract";
import {
  createCloudSaveRemoteHeadConflictError,
  publishCloudSaveSnapshotProposal,
} from "./cloud-save/r2-snapshot-publication";
import { listCloudSaveV2LibraryIndex } from "./cloud-save/cloud-save-v2-library-index";
import {
  getProfileImageCacheFileName,
  sanitizeProfileImageCacheComponent,
  selectLatestProfileImageObject,
} from "./profile-image-helpers";
import { achievementSouvenirsPath } from "@main/constants";
import {
  achievementSouvenirR2Key,
  achievementSouvenirScreenshotPath,
  isAchievementSouvenirRecord,
} from "./achievements/achievement-souvenir-policy";
import { AchievementSouvenirLocalStorage } from "./achievements/achievement-souvenir-local-storage";

export type {
  R2CloudSaveV2ControlDocument,
  R2CloudSaveV2Head,
  R2CloudSaveV2SnapshotDocument,
} from "./cloud-save/r2-snapshot-contract";

/**
 * Cloudflare R2 (S3-compatible) backing store for cloud saves and profile
 * images, replacing Uploadcare. Production builds obtain short-lived,
 * user-scoped credentials from the configured broker. R2 gives us real
 * folders, so everything is namespaced under a per-user prefix:
 *
 *   users/{userId}/saves/{shop}/{objectId}/{timestamp}.tar
 *   users/{userId}/images/{kind}.{ext}
 *   users/{userId}/preferences/settings.json
 *
 * The class keeps the exact method surface the old UploadcareSync exposed so
 * callers are unchanged; an artifact "id" is simply the R2 object key, and
 * images are served to the renderer through the local: protocol after being
 * cached on disk; the bucket remains private and the parent R2 credential
 * never enters the desktop app.
 */

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

export interface SaveArtifactRestoreMetadata {
  homeDir: string | null;
  winePrefixPath: string | null;
  platform: string | null;
}

export interface R2NamespaceMigrationResult {
  copied: number;
  alreadyCopied: number;
  conflicts: number;
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

const souvenirMetadataValue = (value: string | null | undefined, max = 240) =>
  enc((value ?? "").slice(0, max));

const achievementSouvenirLocalStorage = new AchievementSouvenirLocalStorage(
  achievementSouvenirsPath
);

export class R2Sync {
  private static _client: S3Client | null = null;
  private static profileImageDownloads = new Map<
    string,
    Promise<string | null>
  >();
  private static profileImageGenerations = new Map<string, number>();

  private static get client(): S3Client {
    if (!this._client) {
      this._client = new S3Client({
        region: "auto",
        endpoint: R2_ENDPOINT,
        credentials: getR2Credentials,
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

  static invalidateCredentialSession() {
    this._client?.destroy();
    this._client = null;
    this.headCache.clear();
    for (const lookupKey of this.profileImageDownloads.keys()) {
      const nextGeneration =
        (this.profileImageGenerations.get(lookupKey) ?? 0) + 1;
      this.profileImageGenerations.set(lookupKey, nextGeneration);
    }
    this.profileImageDownloads.clear();
  }

  private static imageCacheDir(): string {
    const dir = path.join(app.getPath("userData"), "r2-image-cache");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private static profileImageLookupKey(hydraUserId: string, kind: string) {
    return JSON.stringify([hydraUserId, kind]);
  }

  private static invalidateProfileImageLookup(
    hydraUserId: string,
    kind: string
  ) {
    const lookupKey = this.profileImageLookupKey(hydraUserId, kind);
    const nextGeneration =
      (this.profileImageGenerations.get(lookupKey) ?? 0) + 1;
    this.profileImageGenerations.set(lookupKey, nextGeneration);
    this.profileImageDownloads.delete(lookupKey);
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
          homedir: enc(metadata.homeDir),
          wineprefixpath: enc(metadata.winePrefixPath),
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
    const expected = res.ContentLength ?? null;
    let written = 0;
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(destPath);
      body.on("data", (chunk: Buffer) => {
        written += chunk.length;
      });
      body.pipe(out);
      body.on("error", reject);
      out.on("finish", resolve);
      out.on("error", reject);
    });
    // Integrity guard: a truncated download must fail loudly rather than let a
    // partial tar extract over good saves (adopted from PR #2538's philosophy).
    if (expected !== null && written !== expected) {
      fs.rmSync(destPath, { force: true });
      throw new Error(
        `R2 download truncated for ${key}: expected ${expected} bytes, got ${written}`
      );
    }
    logger.log(`R2: downloaded ${key} → ${destPath} (${written} bytes)`);
  }

  /** Delete an object by key. */
  static async deleteFile(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key })
    );
    this.headCache.delete(key);
    logger.log(`R2: deleted ${key}`);
  }

  /** Uploaded artifacts are immutable, so HEAD metadata can be memoized —
   * listing N artifacts then costs one round-trip instead of N+1 on repeat
   * loads. Entries are dropped on delete. */
  private static headCache = new Map<string, HeadObjectCommandOutput>();

  private static async headArtifact(key: string) {
    const cached = this.headCache.get(key);
    if (cached) return cached;
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })
      );
      this.headCache.set(key, head);
      return head;
    } catch {
      return null;
    }
  }

  /** Source-machine paths needed to remap an artifact during restore. */
  static async getSaveArtifactRestoreMetadata(
    key: string
  ): Promise<SaveArtifactRestoreMetadata> {
    const head = await this.headArtifact(key);
    const metadata = head?.Metadata ?? {};
    return {
      homeDir: dec(metadata.homedir) || null,
      winePrefixPath: dec(metadata.wineprefixpath) || null,
      platform: metadata.platform || null,
    };
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

  // ── Cloud Saves V2 snapshots ───────────────────────────────────────────

  private static cloudSaveV2GamePrefix(
    userId: string,
    shop: GameShop,
    objectId: string
  ) {
    return `users/${enc(userId)}/cloud-saves-v2/${enc(shop)}/${enc(objectId)}`;
  }

  private static cloudSaveV2HeadKey(
    userId: string,
    shop: GameShop,
    objectId: string
  ) {
    return `${this.cloudSaveV2GamePrefix(userId, shop, objectId)}/control.json`;
  }

  private static cloudSaveV2SnapshotKey(
    userId: string,
    shop: GameShop,
    objectId: string,
    snapshotId: string,
    version: number
  ) {
    return `${this.cloudSaveV2GamePrefix(userId, shop, objectId)}/snapshots/${version}-${enc(snapshotId)}.json`;
  }

  private static cloudSaveV2BlobKey(
    userId: string,
    shop: GameShop,
    objectId: string,
    hash: string
  ) {
    return `${this.cloudSaveV2GamePrefix(userId, shop, objectId)}/blobs/${hash}`;
  }

  private static isPreconditionFailure(error: unknown) {
    if (!error || typeof error !== "object") return false;
    const record = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return (
      record.$metadata?.httpStatusCode === 409 ||
      record.$metadata?.httpStatusCode === 412 ||
      record.name === "PreconditionFailed" ||
      record.name === "ConditionalRequestConflict"
    );
  }

  private static async readCloudSaveV2Json(
    key: string
  ): Promise<{ value: unknown; etag: string | null } | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: key })
      );
      const raw = await response.Body?.transformToString();
      if (!raw) throw new Error(`R2 Cloud Save document is empty: ${key}`);
      return {
        value: JSON.parse(raw) as unknown,
        etag: response.ETag ?? null,
      };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (
        status === 404 ||
        (error as { name?: string })?.name === "NoSuchKey"
      ) {
        return null;
      }
      throw error;
    }
  }

  static async getCloudSaveV2Head(
    userId: string,
    shop: GameShop,
    objectId: string
  ): Promise<R2CloudSaveV2Head | null> {
    const result = await this.readCloudSaveV2Json(
      this.cloudSaveV2HeadKey(userId, shop, objectId)
    );
    if (!result) return null;
    const control = validateR2CloudSaveV2ControlDocument(result.value, {
      shop,
      objectId,
    });
    const pointer = control.snapshot;
    const document = pointer
      ? await this.getCloudSaveV2Snapshot(
          userId,
          shop,
          objectId,
          pointer.id,
          pointer.version
        )
      : null;
    assertR2CloudSaveV2HeadConsistency(control, document);
    return {
      control,
      document,
      etag: result.etag,
    };
  }

  static async listCloudSaveV2Snapshots(
    userId: string
  ): Promise<CloudSaveV2LibraryEntry[]> {
    const prefix = `users/${enc(userId)}/cloud-saves-v2/`;
    return listCloudSaveV2LibraryIndex({
      prefix,
      listPage: async (continuationToken) => {
        const page = await this.client.send(
          new ListObjectsV2Command({
            Bucket: R2_BUCKET,
            Prefix: prefix,
            ContinuationToken: continuationToken,
            MaxKeys: 1_000,
          })
        );
        return {
          keys: (page.Contents ?? []).map((object) => object.Key),
          isTruncated: page.IsTruncated === true,
          nextContinuationToken: page.NextContinuationToken,
        };
      },
      loadHead: ({ shop, objectId }) =>
        this.getCloudSaveV2Head(userId, shop, objectId),
      onInvalidEntry: (identity, error) => {
        logger.warn("R2: skipped invalid Cloud Save V2 library entry", {
          key: identity.controlKey,
          error,
        });
      },
    });
  }

  static async getCloudSaveV2Snapshot(
    userId: string,
    shop: GameShop,
    objectId: string,
    snapshotId: string,
    version: number
  ): Promise<R2CloudSaveV2SnapshotDocument | null> {
    const result = await this.readCloudSaveV2Json(
      this.cloudSaveV2SnapshotKey(userId, shop, objectId, snapshotId, version)
    );
    if (!result) return null;
    return validateR2CloudSaveV2SnapshotDocument(
      result.value,
      { shop, objectId, snapshotId, version },
      (input) => NativeAddon.buildSnapshotAggregateHash(input)
    );
  }

  private static async hashLocalFile(filePath: string) {
    const sha256 = crypto.createHash("sha256");
    const md5 = crypto.createHash("md5");
    await new Promise<void>((resolve, reject) => {
      const input = fs.createReadStream(filePath);
      input.on("data", (chunk) => {
        sha256.update(chunk);
        md5.update(chunk);
      });
      input.on("error", reject);
      input.on("end", resolve);
    });
    return {
      sha256: sha256.digest("hex"),
      contentMd5: md5.digest("base64"),
    };
  }

  /** Upload one content-addressed save blob, skipping an already verified blob. */
  static async uploadCloudSaveV2Blob(
    userId: string,
    shop: GameShop,
    objectId: string,
    filePath: string,
    expectedHash: string,
    expectedSizeBytes: number,
    expectedEpoch: number
  ): Promise<"uploaded" | "skipped"> {
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
      throw new Error("cloud_save_invalid_blob_hash");
    }
    const key = this.cloudSaveV2BlobKey(userId, shop, objectId, expectedHash);
    const assertEpochCurrent = async () => {
      const head = await this.getCloudSaveV2Head(userId, shop, objectId);
      if (
        head?.control.status === "deleting" ||
        (head?.control.epoch ?? 0) !== expectedEpoch
      ) {
        throw new Error("cloud_save_deletion_pending");
      }
    };
    await assertEpochCurrent();
    const existing = await this.client
      .send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }))
      .catch((error) => {
        const status = (error as { $metadata?: { httpStatusCode?: number } })
          ?.$metadata?.httpStatusCode;
        if (
          status === 404 ||
          (error as { name?: string })?.name === "NotFound"
        ) {
          return null;
        }
        throw error;
      });
    if (existing) {
      if (
        existing.ContentLength !== expectedSizeBytes ||
        existing.Metadata?.sha256 !== expectedHash
      ) {
        throw new Error("cloud_save_remote_blob_collision");
      }
      await assertEpochCurrent();
      return "skipped";
    }

    const statBeforeHash = await fs.promises.stat(filePath);
    if (!statBeforeHash.isFile() || statBeforeHash.size !== expectedSizeBytes) {
      throw new Error("cloud_save_local_blob_changed");
    }
    const hashed = await this.hashLocalFile(filePath);
    const statBeforeUpload = await fs.promises.stat(filePath);
    if (
      hashed.sha256 !== expectedHash ||
      statBeforeHash.size !== statBeforeUpload.size ||
      statBeforeHash.mtimeMs !== statBeforeUpload.mtimeMs
    ) {
      throw new Error("cloud_save_local_blob_changed");
    }

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: fs.createReadStream(filePath),
          ContentLength: expectedSizeBytes,
          ContentType: "application/octet-stream",
          ContentMD5: hashed.contentMd5,
          Metadata: { sha256: expectedHash },
          IfNoneMatch: "*",
        })
      );
    } catch (error) {
      if (!this.isPreconditionFailure(error)) throw error;
      const raced = await this.client.send(
        new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })
      );
      if (
        raced.ContentLength !== expectedSizeBytes ||
        raced.Metadata?.sha256 !== expectedHash
      ) {
        throw new Error("cloud_save_remote_blob_collision");
      }
      return "skipped";
    }
    const statAfterUpload = await fs.promises.stat(filePath);
    const hashAfterUpload = await this.hashLocalFile(filePath);
    if (
      statAfterUpload.size !== statBeforeUpload.size ||
      statAfterUpload.mtimeMs !== statBeforeUpload.mtimeMs ||
      hashAfterUpload.sha256 !== expectedHash
    ) {
      // Content-addressed blobs are shared by every proposal for this game.
      // Once PUT succeeds another client can commit a manifest referencing the
      // blob immediately, so deleting it here would corrupt that snapshot.
      // Leave an unreferenced blob for a future garbage-collection pass.
      throw new Error("cloud_save_local_blob_changed");
    }
    // The same no-delete rule applies if a deletion fence advanced while the
    // upload was in flight. The fenced delete/GC path owns remote cleanup.
    await assertEpochCurrent();
    return "uploaded";
  }

  /**
   * Publish an immutable manifest and atomically advance the active head.
   * Conditional R2 writes provide the optimistic-version behavior used by the
   * V2 three-way merge when two GameHub machines sync concurrently.
   */
  static async commitCloudSaveV2Snapshot(
    userId: string,
    document: R2CloudSaveV2SnapshotDocument,
    expectedControl: R2CloudSaveV2ControlDocument | null,
    expectedHeadEtag: string | null
  ): Promise<void> {
    const validatedDocument = validateR2CloudSaveV2SnapshotDocument(
      document,
      {
        shop: document.snapshot.shop,
        objectId: document.snapshot.objectId,
        snapshotId: document.snapshot.id,
        version: document.snapshot.version,
      },
      (input) => NativeAddon.buildSnapshotAggregateHash(input)
    );
    const { snapshot } = validatedDocument;
    if (
      expectedControl?.status === "deleting" ||
      snapshot.epoch !== (expectedControl?.epoch ?? 0)
    ) {
      throw new Error("cloud_save_deletion_pending");
    }
    const body = Buffer.from(
      serializeCanonicalR2CloudSaveJson(validatedDocument),
      "utf8"
    );
    const snapshotKey = this.cloudSaveV2SnapshotKey(
      userId,
      snapshot.shop,
      snapshot.objectId,
      snapshot.id,
      snapshot.version
    );
    const control: R2CloudSaveV2ControlDocument = {
      schemaVersion: 1,
      revision: (expectedControl?.revision ?? 0) + 1,
      epoch: snapshot.epoch,
      status: "active",
      deleteOperationId: null,
      snapshot,
      updatedAt: snapshot.updatedAt,
    };
    const validatedControl = validateR2CloudSaveV2ControlDocument(control, {
      shop: snapshot.shop,
      objectId: snapshot.objectId,
    });
    const controlBody = Buffer.from(
      serializeCanonicalR2CloudSaveJson(validatedControl),
      "utf8"
    );

    await publishCloudSaveSnapshotProposal({
      publishImmutableSnapshot: async () => {
        try {
          await this.client.send(
            new PutObjectCommand({
              Bucket: R2_BUCKET,
              Key: snapshotKey,
              Body: body,
              ContentLength: body.length,
              ContentType: "application/json",
              IfNoneMatch: "*",
            })
          );
          return "created";
        } catch (error) {
          if (!this.isPreconditionFailure(error)) throw error;
          const existing = await this.readCloudSaveV2Json(snapshotKey);
          return serializeCanonicalR2CloudSaveJson(existing?.value) ===
            serializeCanonicalR2CloudSaveJson(validatedDocument)
            ? "already-present"
            : "collision";
        }
      },
      advanceControl: async () => {
        try {
          await this.client.send(
            new PutObjectCommand({
              Bucket: R2_BUCKET,
              Key: this.cloudSaveV2HeadKey(
                userId,
                snapshot.shop,
                snapshot.objectId
              ),
              Body: controlBody,
              ContentLength: controlBody.length,
              ContentType: "application/json",
              ...(expectedHeadEtag
                ? { IfMatch: expectedHeadEtag }
                : { IfNoneMatch: "*" }),
            })
          );
        } catch (error) {
          if (this.isPreconditionFailure(error)) {
            throw createCloudSaveRemoteHeadConflictError();
          }
          throw error;
        }
      },
    });
  }

  static async downloadCloudSaveV2Blob(
    userId: string,
    shop: GameShop,
    objectId: string,
    hash: string,
    destinationPath: string
  ): Promise<void> {
    const key = this.cloudSaveV2BlobKey(userId, shop, objectId, hash);
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
    const partialPath = `${destinationPath}.part`;
    await fs.promises.rm(partialPath, { force: true });
    try {
      await this.downloadFile(key, partialPath);
      await fs.promises.rm(destinationPath, { force: true });
      await fs.promises.rename(partialPath, destinationPath);
    } catch (error) {
      await fs.promises.rm(partialPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private static async listAllKeys(prefix: string) {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: R2_BUCKET,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      keys.push(
        ...(page.Contents ?? []).flatMap((item) => (item.Key ? [item.Key] : []))
      );
      continuationToken = page.IsTruncated
        ? page.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return keys;
  }

  private static async putCloudSaveV2Control(
    userId: string,
    shop: GameShop,
    objectId: string,
    control: R2CloudSaveV2ControlDocument,
    expectedEtag: string | null
  ): Promise<void> {
    const validatedControl = validateR2CloudSaveV2ControlDocument(control, {
      shop,
      objectId,
    });
    const body = Buffer.from(
      serializeCanonicalR2CloudSaveJson(validatedControl),
      "utf8"
    );
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: this.cloudSaveV2HeadKey(userId, shop, objectId),
          Body: body,
          ContentLength: body.length,
          ContentType: "application/json",
          ...(expectedEtag ? { IfMatch: expectedEtag } : { IfNoneMatch: "*" }),
        })
      );
    } catch (error) {
      if (this.isPreconditionFailure(error)) {
        throw new Error("cloud_save_remote_head_conflict");
      }
      throw error;
    }
  }

  static async beginCloudSaveV2Deletion(
    userId: string,
    shop: GameShop,
    objectId: string,
    operationId: string
  ): Promise<R2CloudSaveV2Head> {
    const current = await this.getCloudSaveV2Head(userId, shop, objectId);
    if (current?.control.status === "deleting") {
      if (current.control.deleteOperationId === operationId) return current;
      throw new Error("cloud_save_deletion_pending");
    }
    const now = new Date().toISOString();
    const deleting: R2CloudSaveV2ControlDocument = {
      schemaVersion: 1,
      revision: (current?.control.revision ?? 0) + 1,
      epoch: (current?.control.epoch ?? 0) + 1,
      status: "deleting",
      deleteOperationId: operationId,
      snapshot: null,
      updatedAt: now,
    };
    await this.putCloudSaveV2Control(
      userId,
      shop,
      objectId,
      deleting,
      current?.etag ?? null
    );
    const fenced = await this.getCloudSaveV2Head(userId, shop, objectId);
    if (
      !fenced ||
      fenced.control.status !== "deleting" ||
      fenced.control.deleteOperationId !== operationId
    ) {
      throw new Error("cloud_save_deletion_fence_failed");
    }
    return fenced;
  }

  static async deleteCloudSaveV2GameObjects(
    userId: string,
    shop: GameShop,
    objectId: string,
    operationId: string
  ): Promise<void> {
    const fenced = await this.getCloudSaveV2Head(userId, shop, objectId);
    if (
      fenced?.control.status !== "deleting" ||
      fenced.control.deleteOperationId !== operationId
    ) {
      throw new Error("cloud_save_deletion_fence_missing");
    }
    const prefixes = [
      `${this.cloudSaveV2GamePrefix(userId, shop, objectId)}/snapshots/`,
      `${this.cloudSaveV2GamePrefix(userId, shop, objectId)}/blobs/`,
      `users/${userId}/saves/${shop}/${objectId}/`,
    ];
    const keys = (
      await Promise.all(prefixes.map((prefix) => this.listAllKeys(prefix)))
    ).flat();
    for (let index = 0; index < keys.length; index += 1000) {
      const batch = keys.slice(index, index + 1000);
      if (batch.length === 0) continue;
      const response = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: R2_BUCKET,
          Delete: {
            Objects: batch.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      );
      if (response.Errors?.length) {
        throw new Error(
          `cloud_save_remote_delete_failed:${response.Errors.map((item) => item.Key).join(",")}`
        );
      }
      for (const key of batch) this.headCache.delete(key);
    }
    logger.log(
      `R2: deleted fenced Cloud Saves V2 data for ${shop}:${objectId}`
    );
  }

  static async finishCloudSaveV2Deletion(
    userId: string,
    shop: GameShop,
    objectId: string,
    operationId: string
  ): Promise<void> {
    const current = await this.getCloudSaveV2Head(userId, shop, objectId);
    if (
      !current ||
      current.control.status !== "deleting" ||
      current.control.deleteOperationId !== operationId
    ) {
      throw new Error("cloud_save_deletion_fence_missing");
    }
    const active: R2CloudSaveV2ControlDocument = {
      ...current.control,
      revision: current.control.revision + 1,
      status: "active",
      deleteOperationId: null,
      snapshot: null,
      updatedAt: new Date().toISOString(),
    };
    await this.putCloudSaveV2Control(
      userId,
      shop,
      objectId,
      active,
      current.etag
    );
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

    this.invalidateProfileImageLookup(hydraUserId, kind);
    await this.deleteProfileImagesByKind(kind, hydraUserId, key).catch(
      (error) => {
        logger.warn(`R2: failed to remove stale ${kind} variants`, error);
      }
    );

    logger.log(`R2: uploaded image ${key}`);
    return key;
  }

  /** Remove a user's image kind, optionally retaining a freshly uploaded key. */
  static async deleteProfileImagesByKind(
    kind: string,
    hydraUserId: string,
    keepKey?: string
  ): Promise<void> {
    this.invalidateProfileImageLookup(hydraUserId, kind);
    const prefix = `users/${hydraUserId}/images/`;
    const list = await this.client.send(
      new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix })
    );
    const exactKindPrefix = `${kind}.`;
    const keys = (list.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => {
        if (!key || key === keepKey || !key.startsWith(prefix)) return false;
        const name = key.slice(prefix.length);
        return (
          name.startsWith(exactKindPrefix) &&
          name.length > exactKindPrefix.length
        );
      });

    if (keys.length > 0) {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: R2_BUCKET,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        })
      );
    }

    if (!keepKey) {
      const cacheDir = this.imageCacheDir();
      const cachePrefix = `${sanitizeProfileImageCacheComponent(
        hydraUserId
      )}-${sanitizeProfileImageCacheComponent(kind)}-`;
      const cachedFiles = await fs.promises.readdir(cacheDir).catch(() => []);
      await Promise.allSettled(
        cachedFiles
          .filter((name) => name.startsWith(cachePrefix))
          .map((name) =>
            fs.promises.rm(path.join(cacheDir, name), { force: true })
          )
      );
    }
  }

  /**
   * Locate a user's profile image by kind, download it to the local cache and
   * return a local: URL the renderer can display. The cache filename includes
   * the R2 object version so a replaced image never reuses a failed renderer URL.
   */
  static async findLatestImageByKind(
    kind: string,
    hydraUserId: string
  ): Promise<string | null> {
    const lookupKey = this.profileImageLookupKey(hydraUserId, kind);
    const existing = this.profileImageDownloads.get(lookupKey);
    if (existing) return existing;

    const generation = this.profileImageGenerations.get(lookupKey) ?? 0;
    const lookup = this.downloadLatestImageByKind(
      kind,
      hydraUserId,
      lookupKey,
      generation
    ).finally(() => {
      if (this.profileImageDownloads.get(lookupKey) === lookup) {
        this.profileImageDownloads.delete(lookupKey);
      }
    });
    this.profileImageDownloads.set(lookupKey, lookup);
    return lookup;
  }

  // ── Achievement souvenirs ─────────────────────────────────────────────

  static async uploadAchievementSouvenir(
    record: AchievementSouvenirRecord,
    filePath: string
  ): Promise<string> {
    if (
      !isAchievementSouvenirRecord(record) ||
      record.status === "pending-delete"
    ) {
      throw new Error("achievement_souvenir_record_invalid");
    }
    const key = achievementSouvenirR2Key(
      record.ownerId,
      record.shop,
      record.objectId,
      record.achievementName
    );
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 25 * 1024 * 1024) {
      throw new Error("achievement_souvenir_file_invalid");
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentLength: stat.size,
        ContentType: "image/jpeg",
        Metadata: {
          schema: "1",
          ownerid: souvenirMetadataValue(record.ownerId, 512),
          shop: souvenirMetadataValue(record.shop, 32),
          objectid: souvenirMetadataValue(record.objectId, 1_024),
          achievementname: souvenirMetadataValue(record.achievementName, 512),
          achievementdisplayname: souvenirMetadataValue(
            record.achievementDisplayName
          ),
          gametitle: souvenirMetadataValue(record.gameTitle),
          gameiconurl: souvenirMetadataValue(record.gameIconUrl, 512),
          unlocktime: String(record.unlockTime),
          updatedat: String(record.updatedAt),
        },
      })
    );
    this.headCache.delete(key);
    logger.log("R2: uploaded achievement souvenir", {
      shop: record.shop,
      objectId: record.objectId,
      achievementName: record.achievementName,
    });
    return key;
  }

  static async listAchievementSouvenirs(
    ownerId: string,
    game?: { shop: GameShop; objectId: string }
  ): Promise<AchievementSouvenirRecord[]> {
    const root = `users/${enc(ownerId)}/achievement-souvenirs/`;
    const prefix = game
      ? `${root}${enc(game.shop)}/${enc(game.objectId)}/`
      : root;
    const objects: Array<{ Key: string; LastModified?: Date }> = [];
    let continuationToken: string | undefined;

    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: R2_BUCKET,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1_000,
        })
      );
      for (const object of page.Contents ?? []) {
        if (object.Key?.startsWith(prefix)) {
          objects.push({ Key: object.Key, LastModified: object.LastModified });
        }
      }
      if (objects.length > 10_000) {
        throw new Error("achievement_souvenir_remote_limit_exceeded");
      }
      continuationToken = page.IsTruncated
        ? page.NextContinuationToken
        : undefined;
      if (page.IsTruncated && !continuationToken) {
        throw new Error("achievement_souvenir_remote_page_invalid");
      }
    } while (continuationToken);

    const records = await Promise.all(
      objects.map(async (object) => {
        const head = await this.headArtifact(object.Key);
        const metadata = head?.Metadata;
        if (!metadata || metadata.schema !== "1") return null;
        const unlockTime = Number(metadata.unlocktime);
        const updatedAt = Number(metadata.updatedat);
        const record: AchievementSouvenirRecord = {
          schemaVersion: 1,
          ownerId: dec(metadata.ownerid),
          shop: dec(metadata.shop) as GameShop,
          objectId: dec(metadata.objectid),
          achievementName: dec(metadata.achievementname),
          achievementDisplayName: dec(metadata.achievementdisplayname),
          gameTitle: dec(metadata.gametitle),
          gameIconUrl: dec(metadata.gameiconurl) || null,
          unlockTime,
          localPath: null,
          r2Key: object.Key,
          status: "synced",
          updatedAt: Number.isFinite(updatedAt)
            ? updatedAt
            : (object.LastModified?.getTime() ?? Date.now()),
        };
        if (
          record.ownerId !== ownerId ||
          !isAchievementSouvenirRecord(record) ||
          achievementSouvenirR2Key(
            record.ownerId,
            record.shop,
            record.objectId,
            record.achievementName
          ) !== object.Key
        ) {
          return null;
        }
        return record;
      })
    );
    return records.filter(
      (record): record is AchievementSouvenirRecord => record !== null
    );
  }

  static async cacheAchievementSouvenir(
    record: AchievementSouvenirRecord
  ): Promise<string> {
    if (!record.r2Key || record.status === "pending-delete") {
      throw new Error("achievement_souvenir_remote_key_missing");
    }
    const expectedKey = achievementSouvenirR2Key(
      record.ownerId,
      record.shop,
      record.objectId,
      record.achievementName
    );
    if (record.r2Key !== expectedKey) {
      throw new Error("achievement_souvenir_remote_key_invalid");
    }
    const destinationPath = achievementSouvenirScreenshotPath(
      achievementSouvenirsPath,
      {
        ownerId: record.ownerId,
        shop: record.shop,
        objectId: record.objectId,
        gameTitle: record.gameTitle,
        achievementName: record.achievementName,
        achievementDisplayName: record.achievementDisplayName,
      }
    );
    const head = await this.headArtifact(record.r2Key);
    const reconciledCachedPath =
      await achievementSouvenirLocalStorage.reconcilePersistedPath(
        record.ownerId,
        destinationPath
      );
    const cached = reconciledCachedPath
      ? await fs.promises.stat(reconciledCachedPath).catch(() => null)
      : null;
    if (
      reconciledCachedPath &&
      cached?.isFile() &&
      cached.size > 0 &&
      (head?.ContentLength == null || cached.size === head.ContentLength)
    ) {
      return reconciledCachedPath;
    }

    await achievementSouvenirLocalStorage.prepareOwnedFilePath(
      record.ownerId,
      destinationPath
    );
    const partialPath = `${destinationPath}.${process.pid}-${crypto.randomUUID()}.part`;
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: record.r2Key })
      );
      await pipeline(
        response.Body as Readable,
        fs.createWriteStream(partialPath, { flags: "wx" })
      );
      const downloaded = await fs.promises.stat(partialPath);
      if (
        downloaded.size <= 0 ||
        (response.ContentLength != null &&
          downloaded.size !== response.ContentLength)
      ) {
        throw new Error("achievement_souvenir_download_invalid");
      }
      await fs.promises.rm(destinationPath, { force: true });
      await fs.promises.rename(partialPath, destinationPath);
      return destinationPath;
    } finally {
      await fs.promises.rm(partialPath, { force: true }).catch(() => null);
    }
  }

  static async deleteAchievementSouvenir(
    ownerId: string,
    key: string
  ): Promise<void> {
    const prefix = `users/${enc(ownerId)}/achievement-souvenirs/`;
    if (!key.startsWith(prefix) || key.includes("\\")) {
      throw new Error("achievement_souvenir_remote_key_invalid");
    }
    await this.client.send(
      new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key })
    );
    this.headCache.delete(key);
  }

  private static async downloadLatestImageByKind(
    kind: string,
    hydraUserId: string,
    lookupKey: string,
    generation: number
  ): Promise<string | null> {
    const prefix = `users/${hydraUserId}/images/`;
    const list = await this.client
      .send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix }))
      .catch((error) => {
        logger.warn(`R2: failed to list ${kind} for ${hydraUserId}`, error);
        return null;
      });

    const match = selectLatestProfileImageObject(
      list?.Contents ?? [],
      prefix,
      kind
    );
    if (!match?.Key) return null;
    if ((this.profileImageGenerations.get(lookupKey) ?? 0) !== generation) {
      return null;
    }

    const ext = match.Key.slice(match.Key.lastIndexOf(".") + 1) || "img";
    const cacheDir = this.imageCacheDir();
    const cacheName = getProfileImageCacheFileName(
      hydraUserId,
      kind,
      match,
      ext
    );
    const destinationPath = path.join(cacheDir, cacheName);
    const cachedStat = await fs.promises
      .stat(destinationPath)
      .catch(() => null);
    if (
      cachedStat?.isFile() &&
      (match.Size == null
        ? cachedStat.size > 0
        : cachedStat.size === match.Size)
    ) {
      if ((this.profileImageGenerations.get(lookupKey) ?? 0) !== generation) {
        return null;
      }
      return `local:${destinationPath.replace(/\\/g, "/")}`;
    }

    const partialPath = `${destinationPath}.${process.pid}-${crypto.randomUUID()}.part`;
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: match.Key })
      );
      const body = res.Body as Readable;
      await pipeline(body, fs.createWriteStream(partialPath, { flags: "wx" }));

      const downloadedStat = await fs.promises.stat(partialPath);
      const expectedSize = res.ContentLength ?? match.Size;
      if (expectedSize != null && downloadedStat.size !== expectedSize) {
        throw new Error(
          `R2 profile image was truncated: expected ${expectedSize} bytes, got ${downloadedStat.size}`
        );
      }
      if (downloadedStat.size === 0) {
        throw new Error("R2 profile image was empty");
      }
      if ((this.profileImageGenerations.get(lookupKey) ?? 0) !== generation) {
        return null;
      }

      // A prior crash can leave a corrupt file at this exact versioned target.
      // Replace only that validated destination after the complete temp file is
      // safely on disk; never expose the in-progress stream to the renderer.
      await fs.promises.rm(destinationPath, { force: true });
      await fs.promises.rename(partialPath, destinationPath);
      if ((this.profileImageGenerations.get(lookupKey) ?? 0) !== generation) {
        return null;
      }

      const cachePrefix = `${sanitizeProfileImageCacheComponent(
        hydraUserId
      )}-${sanitizeProfileImageCacheComponent(kind)}-`;
      const staleFiles = await fs.promises.readdir(cacheDir).catch(() => []);
      await Promise.allSettled(
        staleFiles
          .filter(
            (name) =>
              name.startsWith(cachePrefix) &&
              name !== cacheName &&
              !name.endsWith(".part")
          )
          .map((name) =>
            fs.promises.rm(path.join(cacheDir, name), { force: true })
          )
      );

      if ((this.profileImageGenerations.get(lookupKey) ?? 0) !== generation) {
        return null;
      }
      return `local:${destinationPath.replace(/\\/g, "/")}`;
    } catch (error) {
      logger.warn(`R2: failed to cache ${kind} for ${hydraUserId}`, error);
      return null;
    } finally {
      await fs.promises.rm(partialPath, { force: true }).catch(() => undefined);
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

  /**
   * Copy a proven legacy install namespace into the authenticated account
   * namespace. Source objects are retained as a rollback copy. Destination
   * writes use R2's conditional CopyObject extension so a concurrent upload is
   * never overwritten by migration data.
   */
  static async migrateUserNamespace(
    legacyUserId: string,
    accountUserId: string
  ): Promise<R2NamespaceMigrationResult> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        legacyUserId
      ) ||
      !/^[a-zA-Z0-9._~-]{1,512}$/.test(accountUserId) ||
      legacyUserId === accountUserId
    ) {
      throw new Error("cloud_save_namespace_migration_invalid");
    }

    const sourcePrefix = `users/${legacyUserId}/`;
    const destinationPrefix = `users/${accountUserId}/`;
    const result: R2NamespaceMigrationResult = {
      copied: 0,
      alreadyCopied: 0,
      conflicts: 0,
    };
    let continuationToken: string | undefined;
    let objectCount = 0;

    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: R2_BUCKET,
          Prefix: sourcePrefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1_000,
        })
      );
      const objects = (page.Contents ?? []).filter(
        (object): object is typeof object & { Key: string } =>
          typeof object.Key === "string" && object.Key.startsWith(sourcePrefix)
      );
      objectCount += objects.length;
      if (objectCount > 100_000) {
        throw new Error("cloud_save_namespace_migration_too_many_objects");
      }

      for (let index = 0; index < objects.length; index += 8) {
        const batch = objects.slice(index, index + 8);
        const outcomes = await Promise.all(
          batch.map(async (source) => {
            const sourceKey = source.Key;
            const destinationKey =
              destinationPrefix + sourceKey.slice(sourcePrefix.length);
            const sourceEtag = source.ETag?.replaceAll('"', "") ?? null;
            const sourceSize = source.Size ?? null;
            const existing = await this.client
              .send(
                new HeadObjectCommand({
                  Bucket: R2_BUCKET,
                  Key: destinationKey,
                })
              )
              .catch(() => null);

            if (existing) {
              const existingEtag = existing.ETag?.replaceAll('"', "") ?? null;
              return existingEtag === sourceEtag &&
                existing.ContentLength === sourceSize
                ? "alreadyCopied"
                : "conflicts";
            }

            const command = new CopyObjectCommand({
              Bucket: R2_BUCKET,
              Key: destinationKey,
              CopySource: `${R2_BUCKET}/${sourceKey
                .split("/")
                .map(encodeURIComponent)
                .join("/")}`,
              MetadataDirective: "COPY",
            });
            command.middlewareStack.add(
              (next) => async (args) => {
                const request = args.request as {
                  headers?: Record<string, string>;
                };
                if (request.headers) {
                  request.headers["cf-copy-destination-if-none-match"] = "*";
                }
                return next(args);
              },
              {
                step: "build",
                name: "gameHubNamespaceMigrationDestinationGuard",
              }
            );

            try {
              await this.client.send(command);
            } catch (error) {
              const status = (
                error as { $metadata?: { httpStatusCode?: number } }
              ).$metadata?.httpStatusCode;
              if (status !== 412) throw error;
            }

            const copied = await this.client.send(
              new HeadObjectCommand({
                Bucket: R2_BUCKET,
                Key: destinationKey,
              })
            );
            const copiedEtag = copied.ETag?.replaceAll('"', "") ?? null;
            return copiedEtag === sourceEtag &&
              copied.ContentLength === sourceSize
              ? "copied"
              : "conflicts";
          })
        );
        for (const outcome of outcomes) result[outcome] += 1;
      }

      continuationToken = page.IsTruncated
        ? page.NextContinuationToken
        : undefined;
      if (page.IsTruncated && !continuationToken) {
        throw new Error("cloud_save_namespace_migration_invalid_page");
      }
    } while (continuationToken);

    logger.info("R2 account namespace migration pass completed", result);
    return result;
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
    const bytes = await (
      res.Body as Readable & { transformToByteArray(): Promise<Uint8Array> }
    ).transformToByteArray();
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

registerR2CredentialSessionInvalidator(() =>
  R2Sync.invalidateCredentialSession()
);
