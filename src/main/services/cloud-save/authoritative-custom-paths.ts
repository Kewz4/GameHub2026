import type { CloudSaveCustomPathBindings, CloudSaveRule } from "@types";

export const getAuthoritativeCloudSaveCustomPathRawPaths = (
  bindings: CloudSaveCustomPathBindings,
  gameHubRules: readonly CloudSaveRule[]
) =>
  [
    ...new Set([
      ...bindings.ready.map(({ rawPath }) => rawPath),
      ...gameHubRules
        .filter(
          ({ source, rawPath }) =>
            source === "custom" && rawPath.startsWith("<custom>")
        )
        .map(({ rawPath }) => rawPath),
    ]),
  ].sort((left, right) => left.localeCompare(right));
