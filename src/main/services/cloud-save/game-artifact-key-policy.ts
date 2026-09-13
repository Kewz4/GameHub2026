const MAX_ARTIFACT_KEY_LENGTH = 2_048;

const hasUnsafeKeyCharacter = (value: string) => {
  if (value.includes("\\")) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

const isSafeNamespaceSegment = (value: string) =>
  value.length > 0 &&
  value.length <= 512 &&
  !value.includes("/") &&
  !hasUnsafeKeyCharacter(value);

const hasSafeKeySegments = (
  key: string,
  prefix: string,
  expectedSegmentCount: number
) => {
  if (!key.startsWith(prefix)) return false;
  const segments = key.slice(prefix.length).split("/");
  return (
    segments.length === expectedSegmentCount &&
    segments.every(
      (segment) => segment.length > 0 && segment !== "." && segment !== ".."
    )
  );
};

export const isGameArtifactKeyForUser = (
  artifactId: unknown,
  userId: unknown
): artifactId is string => {
  if (
    typeof artifactId !== "string" ||
    artifactId.length === 0 ||
    artifactId.length > MAX_ARTIFACT_KEY_LENGTH ||
    hasUnsafeKeyCharacter(artifactId) ||
    typeof userId !== "string" ||
    !isSafeNamespaceSegment(userId)
  ) {
    return false;
  }

  return hasSafeKeySegments(artifactId, `users/${userId}/saves/`, 3);
};

export const assertGameArtifactKeyForUser = (
  artifactId: unknown,
  userId: unknown
) => {
  if (!isGameArtifactKeyForUser(artifactId, userId)) {
    throw new Error("Invalid game artifact key");
  }
};

export const isEmulationSaveKeyForUser = (
  artifactId: unknown,
  userId: unknown
): artifactId is string => {
  if (
    typeof artifactId !== "string" ||
    artifactId.length === 0 ||
    artifactId.length > MAX_ARTIFACT_KEY_LENGTH ||
    hasUnsafeKeyCharacter(artifactId) ||
    typeof userId !== "string" ||
    !isSafeNamespaceSegment(userId)
  ) {
    return false;
  }

  return hasSafeKeySegments(artifactId, `users/${userId}/emulation-saves/`, 3);
};

export const assertEmulationSaveKeyForUser = (
  artifactId: unknown,
  userId: unknown
) => {
  if (!isEmulationSaveKeyForUser(artifactId, userId)) {
    throw new Error("Invalid emulation save key");
  }
};
