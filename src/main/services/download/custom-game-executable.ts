import path from "node:path";

export interface CustomExecutableCandidate {
  path: string;
  size: number;
}

const NEVER_LAUNCH_DIRECTORY_PATTERN =
  /(?:^|[\\/])(?:_?commonredist|_?redists?|redistributables?|support|installers?|prerequisites?|crash(?:reporter|handler)?|tools?|utilities|thirdparty|directx|dotnet)(?:[\\/]|$)/i;

const NEVER_LAUNCH_EXECUTABLE_PATTERN =
  /(?:setup|install(?:er)?|unins|uninstall|redist|vcredist|dxsetup|autorun|prereq|crash|helper|updater?|patcher|bootstrap|bugreport|reporter|sendrpt|configurator|diagnostic|benchmark|easyanticheat|battleye)/i;

const LIKELY_AUXILIARY_EXECUTABLE_PATTERN =
  /(?:^|[-_.\s])(?:launcher|server|editor|tool)(?:[-_.\s]|$)/i;

function isSafeGameExecutable(candidatePath: string) {
  if (path.extname(candidatePath).toLowerCase() !== ".exe") return false;
  if (NEVER_LAUNCH_DIRECTORY_PATTERN.test(candidatePath)) return false;

  const executableName = path.basename(candidatePath, ".exe");
  return !NEVER_LAUNCH_EXECUTABLE_PATTERN.test(executableName);
}

function normalizedTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/\.exe$/i, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

/** Rank portable-game executables without ever selecting installers/redists. */
export function selectCustomGameExecutable(
  title: string,
  candidates: CustomExecutableCandidate[]
) {
  const titleTokens = normalizedTokens(title);
  const safeCandidates = candidates.filter((candidate) =>
    isSafeGameExecutable(candidate.path)
  );

  const ranked = safeCandidates
    .map((candidate) => {
      const fileTokens = normalizedTokens(path.basename(candidate.path));
      const tokenMatches = titleTokens.filter((token) =>
        fileTokens.some(
          (fileToken) => fileToken === token || fileToken.includes(token)
        )
      ).length;
      const relativeDepth = candidate.path.split(/[\\/]+/).length;
      const sizeScore = Math.min(Math.log2(Math.max(candidate.size, 1)), 32);
      const executableName = path.basename(candidate.path, ".exe");
      const gameBinaryBonus = /(?:shipping|^game$)/i.test(executableName)
        ? 20
        : 0;
      const auxiliaryPenalty = LIKELY_AUXILIARY_EXECUTABLE_PATTERN.test(
        executableName
      )
        ? 25
        : 0;
      const score =
        tokenMatches * 100 +
        sizeScore +
        gameBinaryBonus -
        auxiliaryPenalty -
        relativeDepth * 2;
      return { ...candidate, score };
    })
    .sort((left, right) => right.score - left.score || right.size - left.size);

  return ranked[0]?.path ?? null;
}
