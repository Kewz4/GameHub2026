import crypto from "node:crypto";
import path from "node:path";
import type { CloudSaveRule } from "../../../types/index";
import type { BuildGameHubEmulatorRulesInput } from "./gamehub-emulator-rules";
import { isPspSaveDirectoryForTitle } from "../emulators/psp-save-paths";

/** PSP directory names include a game-provided save-slot suffix. Preserve that
 * validated name in the rule identity so a clean machine can restore it without
 * guessing or receiving the entire shared SAVEDATA tree. */
export const pspCloudSaveRawPath = (
  shop: string,
  objectId: string,
  folder: string
): string => {
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify([shop, objectId, "ppsspp-savedata", folder]))
    .digest("hex");
  return `<gamehubEmulator>/${shop}/v3-psp-${digest}-${folder}`;
};

export const buildPspCloudSaveRules = (
  input: BuildGameHubEmulatorRulesInput
): CloudSaveRule[] => {
  const api = input.platform === "windows" ? path.win32 : path.posix;
  const comparable = (value: string) =>
    input.platform === "windows"
      ? api.resolve(value).toLowerCase()
      : api.resolve(value);
  const selections = input.restorePatterns.flatMap((pattern) => {
    const match = /^([A-Z]{4}\d{5})\*$/i.exec(api.basename(pattern));
    const root = api.dirname(pattern);
    if (
      !match ||
      !input.saveRoots.some(
        (allowed) => comparable(root) === comparable(allowed)
      )
    )
      return [];
    return [{ root, identity: match[1] }];
  });
  if (!selections.length) return [];
  const rule = (folder: string, target: string): CloudSaveRule => {
    const rawPath = pspCloudSaveRawPath(input.shop, input.objectId, folder);
    return {
      ruleId: `gamehub-emulator-${crypto.createHash("sha256").update(rawPath).digest("hex")}`,
      kind: "dir",
      rawPath,
      source: "gamehub-emulator",
      tags: ["save"],
      when: [{ os: input.platform }],
      preferredPath: target,
    };
  };
  const local = new Map<string, CloudSaveRule>();
  for (const candidate of input.backupPaths) {
    const folder = api.basename(candidate);
    const match = selections.filter(
      ({ root, identity }) =>
        comparable(api.dirname(candidate)) === comparable(root) &&
        isPspSaveDirectoryForTitle(folder, identity)
    );
    if (match.length !== 1) continue;
    const result = rule(folder, candidate);
    if (
      local.has(result.rawPath) &&
      comparable(local.get(result.rawPath)!.preferredPath!) !==
        comparable(candidate)
    )
      return [];
    local.set(result.rawPath, result);
  }
  if (input.remoteFiles === undefined) return [...local.values()];
  const result: CloudSaveRule[] = [];
  const prefix = `<gamehubEmulator>/${input.shop}/`;
  for (const rawPath of new Set(
    input.remoteFiles
      .filter((file) => file.rawPath.startsWith(prefix))
      .map((file) => file.rawPath)
  )) {
    const parsed = /^v3-psp-[a-f0-9]{64}-([A-Z]{4}\d{5}[A-Z0-9_-]*)$/i.exec(
      rawPath.slice(prefix.length)
    );
    if (!parsed) return [];
    const folder = parsed[1];
    if (rawPath !== pspCloudSaveRawPath(input.shop, input.objectId, folder))
      return [];
    const matches = selections.filter(({ identity }) =>
      isPspSaveDirectoryForTitle(folder, identity)
    );
    const existing = local.get(rawPath);
    if (existing) {
      result.push(existing);
      continue;
    }
    if (matches.length !== 1) return [];
    result.push(rule(folder, api.join(matches[0].root, folder)));
  }
  return result;
};
