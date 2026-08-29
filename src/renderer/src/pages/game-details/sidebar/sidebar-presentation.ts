import type { HowLongToBeatCategory } from "@types";

const stripMarkup = (value: string) =>
  value
    .replaceAll(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, "")
    .replaceAll(/<[^>]*>/g, "")
    .replaceAll(/&(nbsp|#160|#x0*a0);/gi, " ")
    .trim();

export const hasRenderableRequirements = (
  requirements?: Readonly<Record<string, string>> | null
) =>
  Object.values(requirements ?? {}).some(
    (requirement) => stripMarkup(requirement).length > 0
  );

export const shouldRenderHowLongToBeat = (
  data: readonly HowLongToBeatCategory[] | null,
  isLoading: boolean
) => isLoading || Boolean(data?.length);
