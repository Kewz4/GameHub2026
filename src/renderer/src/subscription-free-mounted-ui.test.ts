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

const forbiddenPaywallPatterns = [
  /\bhasActiveSubscription\b/,
  /\buseSubscription\b/,
  /\bHydraCloudModal\b/,
  /\bshowHydraCloudModal\b/,
  /\.openCheckout\s*\(/,
  /subscription_needed/,
  /subscription-required/,
  /subscription\s*\/\s*network/i,
  /(?:GameHub|Hydra) Cloud (?:subscription|plan)/i,
];

const mountedComponents = () => {
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
};

describe("subscription-free mounted GameHub UI", () => {
  it("does not gate GameHub/R2/profile/achievement features behind a plan", () => {
    for (const relativePath of mountedComponents()) {
      const source = fs.readFileSync(
        path.join(repositoryRoot, relativePath),
        "utf8"
      );

      for (const pattern of forbiddenPaywallPatterns) {
        assert.equal(
          pattern.test(source),
          false,
          `${relativePath} contains mounted GameHub paywall UI: ${pattern}`
        );
      }
    }
  });

  it("keeps the retired checkout modal and UI state out of the renderer", () => {
    for (const relativePath of [
      "src/renderer/src/pages/shared-modals/hydra-cloud/hydra-cloud-modal.tsx",
      "src/renderer/src/hooks/use-subscription.ts",
      "src/renderer/src/features/subscription-slice.ts",
    ]) {
      assert.equal(
        fs.existsSync(path.join(repositoryRoot, relativePath)),
        false,
        `${relativePath} must not be restored`
      );
    }
  });
});
