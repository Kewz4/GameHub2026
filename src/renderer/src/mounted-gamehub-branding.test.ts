import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

const mountedUiRoots = ["src/renderer/src", "src/big-picture/src"];

// Hydra API is still the explicit upstream provider for catalogue, profile,
// social, and achievement endpoints. These patterns only reject wording that
// presents Hydra as the launcher or as GameHub's subscription/cloud product.
const staleLauncherBrandingPatterns = [
  /\bLaunch Hydra\b/i,
  /\bHydra (?:could|couldn't|should|will)\b/i,
  /\bforce Hydra\b/i,
  /\bPopular on Hydra\b/i,
  /\bHydra (?:archive|icon)\b/i,
  /\bHydra Cloud\b/i,
  /\b(?:Become|Enjoy|Renew) Hydra\b/i,
];

const retiredGameHubPaywallPatterns = [
  /\bGameHub Cloud (?:subscription|plan)\b/i,
  /\b(?:Subscribe now|Manage subscription|Renew GameHub Cloud)\b/i,
  /\b(?:GameHub Cloud subscription|subscription.*GameHub Cloud).*required\b/i,
];

function collectMountedComponents() {
  const result: string[] = [];

  const visit = (relativePath: string) => {
    const absolutePath = path.join(repositoryRoot, relativePath);

    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      const child = path.join(relativePath, entry.name);

      if (entry.isDirectory()) visit(child);
      else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
        result.push(child.split(path.sep).join("/"));
      }
    }
  };

  mountedUiRoots.forEach(visit);
  return result;
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];

  if (Array.isArray(value)) {
    return value.flatMap(collectStringValues);
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectStringValues);
  }

  return [];
}

describe("mounted GameHub branding", () => {
  it("does not present Hydra as the launcher or GameHub cloud product", () => {
    for (const relativePath of collectMountedComponents()) {
      const source = fs.readFileSync(
        path.join(repositoryRoot, relativePath),
        "utf8"
      );

      for (const pattern of staleLauncherBrandingPatterns) {
        assert.equal(
          pattern.test(source),
          false,
          `${relativePath} contains stale launcher branding: ${pattern}`
        );
      }
    }
  });

  it("keeps English launcher copy GameHub-branded and subscription-free", () => {
    for (const relativePath of [
      "src/locales/en/translation.json",
      "src/big-picture/src/locales/en/translation.json",
    ]) {
      const document = JSON.parse(
        fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8")
      ) as unknown;
      const copy = collectStringValues(document).join("\n");

      for (const pattern of [
        ...staleLauncherBrandingPatterns,
        ...retiredGameHubPaywallPatterns,
      ]) {
        assert.equal(
          pattern.test(copy),
          false,
          `${relativePath} contains stale English launcher copy: ${pattern}`
        );
      }
    }
  });
});
