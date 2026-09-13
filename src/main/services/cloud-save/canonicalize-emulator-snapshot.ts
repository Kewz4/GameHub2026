import path from "node:path";
import type {
  CloudSaveRule,
  LocalGameSnapshotPipelineResult,
  BuildSnapshotAggregateHashInput,
} from "../../../types/index";

/** Rebind the logical filename only after native hashing. Absolute source
 * paths, original bytes/hashes, variants and portable rule IDs never change. */
export const canonicalizeEmulatorSnapshot = <
  T extends LocalGameSnapshotPipelineResult,
>(
  snapshot: T,
  rules: readonly CloudSaveRule[],
  platform: "windows" | "linux" | "mac",
  aggregate: (input: BuildSnapshotAggregateHashInput) => string
): T => {
  const aliases = new Map(
    rules
      .filter(
        (rule) =>
          rule.source === "gamehub-emulator" &&
          rule.kind === "file" &&
          rule.canonicalRelativePath
      )
      .map((rule) => [rule.rawPath, rule])
  );
  if (aliases.size === 0) return snapshot;
  const api = platform === "windows" ? path.win32 : path.posix;
  const convert = <F extends { rawPath: string; relativePath: string }>(
    file: F
  ): F => {
    const alias = aliases.get(file.rawPath);
    if (!alias) return file;
    const expected = api.basename(alias.preferredPath!);
    const matches =
      platform === "windows"
        ? expected.toLowerCase() === file.relativePath.toLowerCase()
        : expected === file.relativePath;
    if (!matches || /[/\\]/.test(alias.canonicalRelativePath!))
      throw new Error(
        "SRAM snapshot filename does not match its validated alias binding"
      );
    return { ...file, relativePath: alias.canonicalRelativePath! };
  };
  const files = snapshot.files.map(convert);
  const sourceFiles = snapshot.sourceFiles.map(convert);
  const identities = files.map((file) =>
    JSON.stringify([file.variantId, file.rawPath, file.relativePath])
  );
  if (new Set(identities).size !== identities.length)
    throw new Error("SRAM alias would merge multiple save identities");
  const coverage = snapshot.coverage.map((item) =>
    item.rawPath && item.relativePath && aliases.has(item.rawPath)
      ? convert({
          ...item,
          rawPath: item.rawPath,
          relativePath: item.relativePath,
        })
      : item
  );
  return {
    ...snapshot,
    files,
    sourceFiles,
    coverage,
    aggregateHash: aggregate({ variants: snapshot.variants, files }),
  };
};
