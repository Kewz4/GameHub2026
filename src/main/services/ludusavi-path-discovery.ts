import fs from "node:fs";
import path from "node:path";

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

      candidates = candidates.flatMap((candidate) => {
        try {
          return fs
            .readdirSync(candidate || ".", { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
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
        return fs.statSync(candidate).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
};
