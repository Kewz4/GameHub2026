import fs from "node:fs";
import path from "node:path";

import { inspectOverlayPeImports } from "./overlay-pe-import-inspector";
import {
  evaluateOverlayStaticTargetCapabilities,
  type OverlayStaticImageInventory,
  type OverlayStaticTargetCapabilityProfile,
  type OverlayStaticTargetInventory,
} from "./overlay-target-static-capability-policy";

const MAX_IMAGE_IMPORTS = 65_536;
const MAX_IMAGE_STRINGS = 65_536;
const MAX_IMPORT_STRING_CODE_UNITS = 512;
const MAX_CANONICAL_PATH_CODE_UNITS = 32_767;
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/u;

export const OVERLAY_STATIC_TARGET_PREFLIGHT_LIMITS = Object.freeze({
  maxDirectories: 2,
  maxEntriesPerDirectory: 4_096,
  maxDlls: 2_048,
  maxFileNameCodeUnits: 1_024,
});

export interface OverlayStaticTargetPreflightRequest {
  launchTargetPath: string;
  /** Omit only when the launch image is also the render image. */
  renderTargetPath?: string;
}

export type OverlayStaticTargetPreflightRejectionReason =
  | "invalid-request"
  | "launch-image-inspection-failed"
  | "render-image-inspection-failed"
  | "launch-image-path-mismatch"
  | "render-image-path-mismatch"
  | "incomplete-launch-image-snapshot"
  | "incomplete-render-image-snapshot"
  | "ambiguous-same-target-snapshot"
  | "adjacent-module-inventory-failed"
  | "incomplete-adjacent-module-snapshot"
  | "ambiguous-adjacent-module-snapshot"
  | "capability-verification-failed"
  | "capability-blocked";

export interface OverlayStaticTargetPreflightAccepted {
  readonly allowed: true;
  readonly inventory: OverlayStaticTargetInventory;
  readonly profile: OverlayStaticTargetCapabilityProfile;
  readonly scannedAdjacentDirectories: readonly string[];
}

export type OverlayStaticTargetPreflightRejected =
  | Readonly<{
      allowed: false;
      reason: Exclude<
        OverlayStaticTargetPreflightRejectionReason,
        "capability-blocked"
      >;
    }>
  | Readonly<{
      allowed: false;
      reason: "capability-blocked";
      inventory: OverlayStaticTargetInventory;
      profile: OverlayStaticTargetCapabilityProfile;
      scannedAdjacentDirectories: readonly string[];
    }>;

export type OverlayStaticTargetPreflightDecision =
  | OverlayStaticTargetPreflightAccepted
  | OverlayStaticTargetPreflightRejected;

/** Narrow dependency seam consumed before a supervised launch is prepared. */
export interface OverlayStaticTargetPreflightDependency {
  inspect(
    request: OverlayStaticTargetPreflightRequest,
    signal: AbortSignal
  ): Promise<OverlayStaticTargetPreflightDecision>;
}

type MaybePromise<T> = T | Promise<T>;

export interface OverlayStaticTargetImageInspector {
  inspect(
    targetPath: string,
    signal: AbortSignal
  ): MaybePromise<OverlayStaticImageInventory>;
}

export interface OverlayAdjacentDllInventory {
  complete: boolean;
  scannedDirectories: readonly string[];
  modules: readonly string[];
  /** Case-insensitive names whose source file could not be selected exactly. */
  ambiguousModuleNames: readonly string[];
}

export interface OverlayAdjacentDllInventoryProvider {
  inventory(
    directories: readonly string[],
    signal: AbortSignal
  ): MaybePromise<OverlayAdjacentDllInventory>;
}

export interface OverlayTrustedStaticCapabilityEvidence {
  /** Proof emitted only after exact native report-schema verification. */
  hidReportSchemaDigest?: string;
  /** Proof retained only while the exact libScePad ABI remains pinned. */
  libScePadAbiDigest?: string;
}

export interface OverlayStaticCapabilityVerificationContext {
  launchImage: OverlayStaticImageInventory;
  renderImage: OverlayStaticImageInventory;
  adjacentModules: readonly string[];
  scannedAdjacentDirectories: readonly string[];
}

/** Trusted constructor-owned seam; untrusted launch requests cannot set it. */
export interface OverlayStaticCapabilityEvidenceVerifier {
  verify(
    context: OverlayStaticCapabilityVerificationContext,
    signal: AbortSignal
  ): MaybePromise<OverlayTrustedStaticCapabilityEvidence>;
}

interface OverlayAdjacentDllInventoryLimits {
  maxEntriesPerDirectory: number;
  maxDlls: number;
  maxFileNameCodeUnits: number;
}

export interface OverlayStaticTargetPreflightOptions {
  imageInspector?: OverlayStaticTargetImageInspector;
  adjacentDllInventory?: OverlayAdjacentDllInventoryProvider;
  capabilityEvidenceVerifier?: OverlayStaticCapabilityEvidenceVerifier;
}

const defaultImageInspector: OverlayStaticTargetImageInspector = {
  inspect(targetPath, signal) {
    throwIfAborted(signal);
    const result = inspectOverlayPeImports(targetPath);
    throwIfAborted(signal);
    return result;
  },
};

const noTrustedCapabilityEvidence: OverlayStaticCapabilityEvidenceVerifier = {
  verify() {
    return Object.freeze({});
  },
};

const throwIfAborted = (signal: AbortSignal) => {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Operation aborted", "AbortError");
};

const normalizedPathKey = (value: string) =>
  path.normalize(value).toLowerCase();

const samePath = (left: string, right: string) =>
  normalizedPathKey(left) === normalizedPathKey(right);

const validAbsolutePath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_CANONICAL_PATH_CODE_UNITS &&
  !value.includes("\0") &&
  path.isAbsolute(value);

const REQUEST_KEYS = new Set(["launchTargetPath", "renderTargetPath"]);

const reject = <
  T extends Exclude<
    OverlayStaticTargetPreflightRejectionReason,
    "capability-blocked"
  >,
>(
  reason: T
): Readonly<{ allowed: false; reason: T }> =>
  Object.freeze({ allowed: false, reason });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const boundedString = (
  value: unknown,
  maximumCodeUnits: number,
  allowEmpty = false
): value is string =>
  typeof value === "string" &&
  value.length <= maximumCodeUnits &&
  (allowEmpty || value.length > 0) &&
  !value.includes("\0");

const freezeImageInventory = (
  unsafeInventory: OverlayStaticImageInventory
): OverlayStaticImageInventory => {
  if (
    !isRecord(unsafeInventory) ||
    !validAbsolutePath(unsafeInventory.canonicalPath) ||
    !LOWERCASE_SHA256.test(unsafeInventory.contentSha256) ||
    (unsafeInventory.architecture !== "x86" &&
      unsafeInventory.architecture !== "x64") ||
    typeof unsafeInventory.completeImportSnapshot !== "boolean" ||
    !Array.isArray(unsafeInventory.imports) ||
    unsafeInventory.imports.length > MAX_IMAGE_IMPORTS ||
    (unsafeInventory.referencedSymbols !== undefined &&
      (!Array.isArray(unsafeInventory.referencedSymbols) ||
        unsafeInventory.referencedSymbols.length > MAX_IMAGE_STRINGS)) ||
    (unsafeInventory.embeddedInterfaceRevisions !== undefined &&
      (!Array.isArray(unsafeInventory.embeddedInterfaceRevisions) ||
        unsafeInventory.embeddedInterfaceRevisions.length > 64)) ||
    (unsafeInventory.embeddedInterfaceTokens !== undefined &&
      (!Array.isArray(unsafeInventory.embeddedInterfaceTokens) ||
        unsafeInventory.embeddedInterfaceTokens.length > 64))
  ) {
    throw new TypeError("Invalid static PE image inventory.");
  }

  const imports = unsafeInventory.imports.map((entry) => {
    if (
      !isRecord(entry) ||
      !boundedString(entry.module, MAX_IMPORT_STRING_CODE_UNITS) ||
      !(
        entry.symbol === null ||
        boundedString(entry.symbol, MAX_IMPORT_STRING_CODE_UNITS)
      ) ||
      (entry.delayLoaded !== undefined &&
        typeof entry.delayLoaded !== "boolean")
    ) {
      throw new TypeError("Invalid static PE import entry.");
    }
    return Object.freeze({
      module: entry.module,
      symbol: entry.symbol,
      ...(entry.delayLoaded === undefined
        ? {}
        : { delayLoaded: entry.delayLoaded }),
    });
  });
  const referencedSymbols = unsafeInventory.referencedSymbols?.map((value) => {
    if (!boundedString(value, MAX_IMPORT_STRING_CODE_UNITS)) {
      throw new TypeError("Invalid referenced PE symbol.");
    }
    return value;
  });
  const embeddedInterfaceRevisions =
    unsafeInventory.embeddedInterfaceRevisions?.map((value) => {
      if (!boundedString(value, MAX_IMPORT_STRING_CODE_UNITS)) {
        throw new TypeError("Invalid embedded interface revision.");
      }
      return value;
    });
  const embeddedInterfaceTokens = unsafeInventory.embeddedInterfaceTokens?.map(
    (value) => {
      if (!boundedString(value, MAX_IMPORT_STRING_CODE_UNITS)) {
        throw new TypeError("Invalid embedded interface token.");
      }
      return value;
    }
  );

  return Object.freeze({
    canonicalPath: path.normalize(unsafeInventory.canonicalPath),
    contentSha256: unsafeInventory.contentSha256,
    architecture: unsafeInventory.architecture,
    completeImportSnapshot: unsafeInventory.completeImportSnapshot,
    imports: Object.freeze(imports),
    ...(referencedSymbols
      ? { referencedSymbols: Object.freeze(referencedSymbols) }
      : {}),
    ...(embeddedInterfaceRevisions
      ? {
          embeddedInterfaceRevisions: Object.freeze(embeddedInterfaceRevisions),
        }
      : {}),
    ...(embeddedInterfaceTokens
      ? { embeddedInterfaceTokens: Object.freeze(embeddedInterfaceTokens) }
      : {}),
  });
};

const imageFingerprint = (image: OverlayStaticImageInventory) =>
  JSON.stringify({
    contentSha256: image.contentSha256,
    architecture: image.architecture,
    completeImportSnapshot: image.completeImportSnapshot,
    imports: image.imports
      .map(
        (entry) =>
          `${entry.module.toLowerCase()}\0${entry.symbol?.toLowerCase() ?? ""}\0${entry.delayLoaded === true}`
      )
      .sort(),
    referencedSymbols: [...(image.referencedSymbols ?? [])]
      .map((value) => value.toLowerCase())
      .sort(),
    embeddedInterfaceRevisions: [...(image.embeddedInterfaceRevisions ?? [])]
      .map((value) => value.toLowerCase())
      .sort(),
    embeddedInterfaceTokens: [...(image.embeddedInterfaceTokens ?? [])]
      .map((value) => value.toLowerCase())
      .sort(),
  });

const directoryStamp = (directoryPath: string) => {
  const stat = fs.statSync(directoryPath, { bigint: true });
  if (!stat.isDirectory()) {
    throw new TypeError("Adjacent module root is not a directory.");
  }
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  });
};

const sameDirectoryStamp = (
  left: ReturnType<typeof directoryStamp>,
  right: ReturnType<typeof directoryStamp>
) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;

const normalizeInventoryLimits = (
  configured: Partial<OverlayAdjacentDllInventoryLimits>
): Readonly<OverlayAdjacentDllInventoryLimits> => {
  const limits = {
    maxEntriesPerDirectory:
      configured.maxEntriesPerDirectory ??
      OVERLAY_STATIC_TARGET_PREFLIGHT_LIMITS.maxEntriesPerDirectory,
    maxDlls:
      configured.maxDlls ?? OVERLAY_STATIC_TARGET_PREFLIGHT_LIMITS.maxDlls,
    maxFileNameCodeUnits:
      configured.maxFileNameCodeUnits ??
      OVERLAY_STATIC_TARGET_PREFLIGHT_LIMITS.maxFileNameCodeUnits,
  };
  for (const [name, value] of Object.entries(limits)) {
    const maximum =
      OVERLAY_STATIC_TARGET_PREFLIGHT_LIMITS[
        name as keyof OverlayAdjacentDllInventoryLimits
      ];
    if (!Number.isInteger(value) || value < 1 || value > maximum) {
      throw new TypeError(`Invalid adjacent DLL inventory limit: ${name}.`);
    }
  }
  return Object.freeze(limits);
};

/**
 * Bounded, non-recursive directory-name prefilter. It never loads a DLL or PE.
 * Exact runtime module identity still belongs to the native evidence boundary.
 */
export class NodeOverlayAdjacentDllInventoryProvider
  implements OverlayAdjacentDllInventoryProvider
{
  private readonly limits: Readonly<OverlayAdjacentDllInventoryLimits>;

  public constructor(limits: Partial<OverlayAdjacentDllInventoryLimits> = {}) {
    this.limits = normalizeInventoryLimits(limits);
  }

  public inventory(
    unsafeDirectories: readonly string[],
    signal: AbortSignal
  ): OverlayAdjacentDllInventory {
    throwIfAborted(signal);
    if (
      !Array.isArray(unsafeDirectories) ||
      unsafeDirectories.length < 1 ||
      unsafeDirectories.length >
        OVERLAY_STATIC_TARGET_PREFLIGHT_LIMITS.maxDirectories ||
      unsafeDirectories.some((value) => !validAbsolutePath(value))
    ) {
      throw new TypeError("Invalid adjacent DLL inventory roots.");
    }

    const canonicalDirectories: string[] = [];
    const seenDirectories = new Set<string>();
    for (const unsafeDirectory of unsafeDirectories) {
      throwIfAborted(signal);
      const canonicalDirectory = fs.realpathSync.native(unsafeDirectory);
      const key = normalizedPathKey(canonicalDirectory);
      if (seenDirectories.has(key)) continue;
      seenDirectories.add(key);
      canonicalDirectories.push(canonicalDirectory);
    }

    const modules = new Map<string, { name: string; identity: string }>();
    const ambiguous = new Set<string>();
    let dllCount = 0;
    let complete = true;

    for (const directoryPath of canonicalDirectories) {
      throwIfAborted(signal);
      const before = directoryStamp(directoryPath);
      const directory = fs.opendirSync(directoryPath);
      let entryCount = 0;
      try {
        for (;;) {
          throwIfAborted(signal);
          const entry = directory.readSync();
          if (!entry) break;
          entryCount += 1;
          if (entryCount > this.limits.maxEntriesPerDirectory) {
            throw new RangeError(
              "Adjacent directory entry count exceeded its bound."
            );
          }
          if (entry.name.length > this.limits.maxFileNameCodeUnits) {
            throw new RangeError("Adjacent module name exceeded its bound.");
          }
          if (!entry.name.toLowerCase().endsWith(".dll")) continue;
          if (entry.isDirectory()) continue;

          const moduleKey = entry.name.toLowerCase();
          const modulePath = path.join(directoryPath, entry.name);
          const moduleStat = fs.lstatSync(modulePath, { bigint: true });
          if (entry.isSymbolicLink() || !moduleStat.isFile()) {
            ambiguous.add(moduleKey);
            continue;
          }
          dllCount += 1;
          if (dllCount > this.limits.maxDlls) {
            throw new RangeError("Adjacent DLL count exceeded its bound.");
          }
          const identity =
            moduleStat.ino === 0n
              ? normalizedPathKey(modulePath)
              : `${moduleStat.dev.toString(16)}:${moduleStat.ino.toString(16)}`;
          const prior = modules.get(moduleKey);
          if (prior && prior.identity !== identity) {
            ambiguous.add(moduleKey);
          } else if (!prior) {
            modules.set(moduleKey, { name: moduleKey, identity });
          }
        }
      } finally {
        directory.closeSync();
      }
      const after = directoryStamp(directoryPath);
      if (!sameDirectoryStamp(before, after)) complete = false;
    }

    throwIfAborted(signal);
    return Object.freeze({
      complete,
      scannedDirectories: Object.freeze([...canonicalDirectories]),
      modules: Object.freeze(
        [...modules.values()].map((value) => value.name).sort()
      ),
      ambiguousModuleNames: Object.freeze([...ambiguous].sort()),
    });
  }
}

const freezeAdjacentInventory = (
  unsafeInventory: OverlayAdjacentDllInventory,
  expectedDirectories: readonly string[]
): OverlayAdjacentDllInventory => {
  if (
    !isRecord(unsafeInventory) ||
    typeof unsafeInventory.complete !== "boolean" ||
    !Array.isArray(unsafeInventory.scannedDirectories) ||
    !Array.isArray(unsafeInventory.modules) ||
    !Array.isArray(unsafeInventory.ambiguousModuleNames) ||
    unsafeInventory.scannedDirectories.length >
      OVERLAY_STATIC_TARGET_PREFLIGHT_LIMITS.maxDirectories ||
    unsafeInventory.modules.length >
      OVERLAY_STATIC_TARGET_PREFLIGHT_LIMITS.maxDlls ||
    unsafeInventory.ambiguousModuleNames.length >
      OVERLAY_STATIC_TARGET_PREFLIGHT_LIMITS.maxDlls
  ) {
    throw new TypeError("Invalid adjacent DLL inventory.");
  }

  const directories = unsafeInventory.scannedDirectories.map((value) => {
    if (!validAbsolutePath(value)) {
      throw new TypeError("Invalid scanned adjacent directory.");
    }
    return path.normalize(value);
  });
  const modules = unsafeInventory.modules.map((value) => {
    if (
      !boundedString(
        value,
        OVERLAY_STATIC_TARGET_PREFLIGHT_LIMITS.maxFileNameCodeUnits
      ) ||
      path.basename(value) !== value ||
      !value.toLowerCase().endsWith(".dll")
    ) {
      throw new TypeError("Invalid adjacent DLL name.");
    }
    return value.toLowerCase();
  });
  const ambiguousModuleNames = unsafeInventory.ambiguousModuleNames.map(
    (value) => {
      if (
        !boundedString(
          value,
          OVERLAY_STATIC_TARGET_PREFLIGHT_LIMITS.maxFileNameCodeUnits
        ) ||
        path.basename(value) !== value ||
        !value.toLowerCase().endsWith(".dll")
      ) {
        throw new TypeError("Invalid ambiguous adjacent DLL name.");
      }
      return value.toLowerCase();
    }
  );

  const expectedKeys = new Set(expectedDirectories.map(normalizedPathKey));
  const scannedKeys = new Set(directories.map(normalizedPathKey));
  if (
    expectedKeys.size !== scannedKeys.size ||
    [...expectedKeys].some((value) => !scannedKeys.has(value))
  ) {
    throw new TypeError("Adjacent DLL inventory roots were incomplete.");
  }
  if (new Set(modules).size !== modules.length) {
    ambiguousModuleNames.push(...modules);
  }

  return Object.freeze({
    complete: unsafeInventory.complete,
    scannedDirectories: Object.freeze(directories),
    modules: Object.freeze([...new Set(modules)].sort()),
    ambiguousModuleNames: Object.freeze(
      [...new Set(ambiguousModuleNames)].sort()
    ),
  });
};

const freezeTrustedCapabilityEvidence = (
  unsafeEvidence: unknown
): Readonly<OverlayTrustedStaticCapabilityEvidence> => {
  const allowedKeys = new Set(["hidReportSchemaDigest", "libScePadAbiDigest"]);
  const hidReportSchemaDigest = isRecord(unsafeEvidence)
    ? unsafeEvidence.hidReportSchemaDigest
    : undefined;
  const libScePadAbiDigest = isRecord(unsafeEvidence)
    ? unsafeEvidence.libScePadAbiDigest
    : undefined;
  if (
    !isRecord(unsafeEvidence) ||
    Object.keys(unsafeEvidence).some((key) => !allowedKeys.has(key)) ||
    (hidReportSchemaDigest !== undefined &&
      (typeof hidReportSchemaDigest !== "string" ||
        !LOWERCASE_SHA256.test(hidReportSchemaDigest))) ||
    (libScePadAbiDigest !== undefined &&
      (typeof libScePadAbiDigest !== "string" ||
        !LOWERCASE_SHA256.test(libScePadAbiDigest)))
  ) {
    throw new TypeError("Invalid trusted static capability evidence.");
  }
  return Object.freeze({
    ...(hidReportSchemaDigest === undefined
      ? {}
      : {
          hidReportSchemaDigest: hidReportSchemaDigest as string,
        }),
    ...(libScePadAbiDigest === undefined
      ? {}
      : { libScePadAbiDigest: libScePadAbiDigest as string }),
  });
};

export class OverlayStaticTargetPreflightService
  implements OverlayStaticTargetPreflightDependency
{
  private readonly imageInspector: OverlayStaticTargetImageInspector;
  private readonly adjacentDllInventory: OverlayAdjacentDllInventoryProvider;
  private readonly capabilityEvidenceVerifier: OverlayStaticCapabilityEvidenceVerifier;

  public constructor(options: OverlayStaticTargetPreflightOptions = {}) {
    this.imageInspector = options.imageInspector ?? defaultImageInspector;
    this.adjacentDllInventory =
      options.adjacentDllInventory ??
      new NodeOverlayAdjacentDllInventoryProvider();
    this.capabilityEvidenceVerifier =
      options.capabilityEvidenceVerifier ?? noTrustedCapabilityEvidence;
  }

  public async inspect(
    request: OverlayStaticTargetPreflightRequest,
    signal: AbortSignal
  ): Promise<OverlayStaticTargetPreflightDecision> {
    throwIfAborted(signal);
    if (
      !isRecord(request) ||
      Object.keys(request).some((key) => !REQUEST_KEYS.has(key)) ||
      !validAbsolutePath(request.launchTargetPath) ||
      (request.renderTargetPath !== undefined &&
        !validAbsolutePath(request.renderTargetPath))
    ) {
      return reject("invalid-request");
    }

    let launchImage: OverlayStaticImageInventory;
    try {
      launchImage = freezeImageInventory(
        await this.imageInspector.inspect(request.launchTargetPath, signal)
      );
    } catch {
      throwIfAborted(signal);
      return reject("launch-image-inspection-failed");
    }
    throwIfAborted(signal);
    if (!samePath(launchImage.canonicalPath, request.launchTargetPath)) {
      return reject("launch-image-path-mismatch");
    }
    if (!launchImage.completeImportSnapshot) {
      return reject("incomplete-launch-image-snapshot");
    }

    let renderImage = launchImage;
    if (request.renderTargetPath !== undefined) {
      try {
        renderImage = freezeImageInventory(
          await this.imageInspector.inspect(request.renderTargetPath, signal)
        );
      } catch {
        throwIfAborted(signal);
        return reject("render-image-inspection-failed");
      }
      throwIfAborted(signal);
      if (!samePath(renderImage.canonicalPath, request.renderTargetPath)) {
        return reject("render-image-path-mismatch");
      }
      if (!renderImage.completeImportSnapshot) {
        return reject("incomplete-render-image-snapshot");
      }
      if (samePath(launchImage.canonicalPath, renderImage.canonicalPath)) {
        if (imageFingerprint(launchImage) !== imageFingerprint(renderImage)) {
          return reject("ambiguous-same-target-snapshot");
        }
        renderImage = launchImage;
      }
    }

    const adjacentDirectories = Object.freeze([
      ...new Map(
        [
          path.dirname(launchImage.canonicalPath),
          path.dirname(renderImage.canonicalPath),
        ].map((value) => [normalizedPathKey(value), value])
      ).values(),
    ]);
    let adjacentInventory: OverlayAdjacentDllInventory;
    try {
      adjacentInventory = freezeAdjacentInventory(
        await this.adjacentDllInventory.inventory(adjacentDirectories, signal),
        adjacentDirectories
      );
    } catch {
      throwIfAborted(signal);
      return reject("adjacent-module-inventory-failed");
    }
    throwIfAborted(signal);
    if (!adjacentInventory.complete) {
      return reject("incomplete-adjacent-module-snapshot");
    }
    if (adjacentInventory.ambiguousModuleNames.length > 0) {
      return reject("ambiguous-adjacent-module-snapshot");
    }

    const verificationContext: OverlayStaticCapabilityVerificationContext =
      Object.freeze({
        launchImage,
        renderImage,
        adjacentModules: adjacentInventory.modules,
        scannedAdjacentDirectories: adjacentInventory.scannedDirectories,
      });
    let trustedEvidence: Readonly<OverlayTrustedStaticCapabilityEvidence>;
    try {
      trustedEvidence = freezeTrustedCapabilityEvidence(
        await this.capabilityEvidenceVerifier.verify(
          verificationContext,
          signal
        )
      );
    } catch {
      throwIfAborted(signal);
      return reject("capability-verification-failed");
    }
    throwIfAborted(signal);

    const inventory: OverlayStaticTargetInventory = Object.freeze({
      launchImage,
      renderImage,
      completeAdjacentModuleSnapshot: true,
      adjacentModules: adjacentInventory.modules,
      ...(trustedEvidence.hidReportSchemaDigest === undefined
        ? {}
        : {
            hidReportSchemaDigest: trustedEvidence.hidReportSchemaDigest,
          }),
      ...(trustedEvidence.libScePadAbiDigest === undefined
        ? {}
        : { libScePadAbiDigest: trustedEvidence.libScePadAbiDigest }),
    });
    const profile = evaluateOverlayStaticTargetCapabilities(inventory);
    const scannedAdjacentDirectories = adjacentInventory.scannedDirectories;
    throwIfAborted(signal);

    if (profile.blockers.length > 0) {
      return Object.freeze({
        allowed: false,
        reason: "capability-blocked",
        inventory,
        profile,
        scannedAdjacentDirectories,
      });
    }
    return Object.freeze({
      allowed: true,
      inventory,
      profile,
      scannedAdjacentDirectories,
    });
  }
}
