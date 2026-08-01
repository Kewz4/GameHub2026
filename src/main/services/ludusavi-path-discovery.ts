import fs from "node:fs";
import path from "node:path";

const UNRESOLVED_TOKEN = /<[^<>]+>/g;
const HAS_GLOB = /[*?]/;

const escapeRegex = (value: string) =>
  value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");

const tokenizedSegmentRegex = (segment: string): RegExp => {
  let source = "";
  for (let index = 0; index < segment.length; index++) {
    if (segment[index] === "<") {
      const end = segment.indexOf(">", index + 1);
      if (end !== -1) {
        source += "[^\\\\/]+";
        index = end;
        continue;
      }
    }
    source += escapeRegex(segment[index]);
  }
  return new RegExp(`^${source}$`, process.platform === "win32" ? "i" : "");
};

const concretePrefixBeforeGlob = (value: string): string => {
  const normalized = path.normalize(value);
  const root = path.parse(normalized).root;
  const parts = normalized.slice(root.length).split(path.sep).filter(Boolean);
  const firstGlob = parts.findIndex((part) => HAS_GLOB.test(part));
  return firstGlob === -1
    ? normalized
    : path.join(root, ...parts.slice(0, firstGlob));
};

/** Convert unresolved account/profile tokens to a safe one-segment glob. */
export const toProspectiveLudusaviPath = (template: string): string | null => {
  const prospective = path.normalize(template.replace(UNRESOLVED_TOKEN, "*"));
  return path.isAbsolute(prospective) && !prospective.includes("<")
    ? prospective
    : null;
};

/**
 * Resolve every existing directory represented by unresolved Ludusavi path
 * tokens. A token represents one directory level, and more than one matching
 * account/profile directory may legitimately contain saves for the same game.
 */
export const resolveLudusaviPathMatches = (template: string): string[] => {
  try {
    const normalized = path.normalize(template);
    const root = path.parse(normalized).root;
    const parts = normalized.slice(root.length).split(path.sep).filter(Boolean);

    if (!parts.some((part) => part.includes("<"))) return [];

    let candidates = [root];

    for (const part of parts) {
      if (!part.includes("<")) {
        candidates = candidates.map((candidate) => path.join(candidate, part));
        continue;
      }

      const segmentPattern = tokenizedSegmentRegex(part);
      candidates = candidates.flatMap((candidate) => {
        try {
          return fs
            .readdirSync(candidate || ".", { withFileTypes: true })
            .filter(
              (entry) => entry.isDirectory() && segmentPattern.test(entry.name)
            )
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((entry) => path.join(candidate, entry.name));
        } catch {
          return [];
        }
      });

      if (candidates.length === 0) return [];
    }

    return candidates.filter((candidate) => {
      try {
        if (HAS_GLOB.test(candidate)) {
          return fs.statSync(concretePrefixBeforeGlob(candidate)).isDirectory();
        }
        return fs.statSync(candidate).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
};
