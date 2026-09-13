interface RequirementDetails {
  minimum?: string;
  recommended?: string;
}

interface GameRequirementSources {
  pc_requirements?: RequirementDetails;
  linux_requirements?: RequirementDetails;
  mac_requirements?: RequirementDetails;
}

const hasContent = (requirements?: RequirementDetails) =>
  Object.values(requirements ?? {}).some(
    (value) =>
      typeof value === "string" &&
      value.replace(/<[^>]*>|&nbsp;|&#160;/gi, "").trim().length > 0
  );

/** Keep Windows fallback explicit: hardware requirements do not establish
 * Wine/Proton compatibility. Never combine requirements from different OSes. */
export function selectGameRequirements(
  sources: GameRequirementSources | null | undefined,
  platform: string
) {
  if (platform === "linux" && hasContent(sources?.linux_requirements)) {
    return {
      requirements: normalize(sources?.linux_requirements),
      source: "linux" as const,
    };
  }
  if (platform === "darwin" && hasContent(sources?.mac_requirements)) {
    return {
      requirements: normalize(sources?.mac_requirements),
      source: "mac" as const,
    };
  }
  return {
    requirements: normalize(sources?.pc_requirements),
    source: "windows" as const,
  };
}

const normalize = (requirements?: RequirementDetails) => ({
  minimum: requirements?.minimum ?? "",
  recommended: requirements?.recommended ?? "",
});
