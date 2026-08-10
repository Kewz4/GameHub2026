import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import locales from "@locales";

const settingsTranslations = locales.en.settings as Record<string, string>;

const downloadSettingsSources = [
  "settings-context-downloads.tsx",
  "settings-download-sources.tsx",
  "add-download-source-modal.tsx",
];

const hasEnglishTranslation = (key: string) => {
  if (settingsTranslations[key]) return true;

  return ["zero", "one", "other"].every(
    (pluralForm) => settingsTranslations[`${key}_${pluralForm}`]
  );
};

describe("desktop Downloads settings localization", () => {
  it("provides readable English network-interface labels and guidance", () => {
    const expectedTranslations = {
      network_interface: "Network interface",
      network_interface_default: "Automatic (recommended)",
      network_interface_unavailable: "unavailable",
      network_interface_hint:
        "Choose which network adapter torrent downloads use. Keep Automatic selected unless you need to bind downloads to a VPN or a specific adapter.",
    };

    for (const [key, expected] of Object.entries(expectedTranslations)) {
      assert.equal(settingsTranslations[key], expected);
      assert.notEqual(settingsTranslations[key], key);
    }
  });

  it("resolves every settings translation key used by the Downloads UI", () => {
    const unresolvedKeys = new Set<string>();

    for (const sourceFile of downloadSettingsSources) {
      const source = readFileSync(new URL(sourceFile, import.meta.url), "utf8");
      const translationCalls = source.matchAll(/\bt\(\s*["']([^"']+)["']/g);

      for (const match of translationCalls) {
        const key = match[1];
        if (!hasEnglishTranslation(key)) unresolvedKeys.add(key);
      }
    }

    assert.deepEqual([...unresolvedKeys].sort(), []);
  });
});
