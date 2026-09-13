import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

interface ForbiddenPattern {
  label: string;
  expression: RegExp;
}

const forbiddenPcV1Patterns: ForbiddenPattern[] = [
  {
    label: "legacy PC artifact IPC API",
    expression:
      /\b(?:uploadSaveGame|downloadGameArtifact|getGameArtifacts|getAllArtifacts|deleteGameArtifact|getGameBackupPreview|selectGameBackupPath|onCloudArtifactsUpdated|onBackupDownloadComplete|onBackupDownloadProgress|onUploadComplete)\b/,
  },
  {
    label: "legacy automatic artifact backend",
    expression:
      /\b(?:restoreGameArtifact|shouldRunLegacyAutomaticCloudSave|CloudSync\s*\.\s*uploadSaveGame(?:IfChanged)?)\b/,
  },
  {
    label: "Hydra cloud-save artifact endpoint",
    expression: /\/profile\/(?:cloud-saves|games\/artifacts)/,
  },
  {
    label: "legacy Uploadcare-named storage facade",
    expression: /\bUploadcareSync\b/,
  },
];

const compatibilityAllowlist = new Map<string, ReadonlySet<string>>([
  [
    "src/main/services/uploadcare-sync.ts",
    new Set(["legacy Uploadcare-named storage facade"]),
  ],
  [
    "src/main/services/r2-sync.ts",
    new Set(["legacy Uploadcare-named storage facade"]),
  ],
]);

const read = (relativePath: string) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

const sourceFilesUnder = (relativeDirectory: string): string[] => {
  const result: string[] = [];
  const visit = (relativePath: string) => {
    const absolutePath = path.join(repositoryRoot, relativePath);
    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      const child = path.join(relativePath, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (
        /\.(?:ts|tsx)$/.test(entry.name) &&
        !/\.test\.(?:ts|tsx)$/.test(entry.name)
      ) {
        result.push(child.split(path.sep).join("/"));
      }
    }
  };
  visit(relativeDirectory);
  return result;
};

const assertNoForbiddenPatterns = (
  relativePath: string,
  allowedLabels: ReadonlySet<string> = new Set()
) => {
  const source = read(relativePath);
  for (const { label, expression } of forbiddenPcV1Patterns) {
    if (allowedLabels.has(label)) continue;
    assert.equal(
      expression.test(source),
      false,
      `${relativePath} contains ${label}`
    );
  }
};

test("production Cloud Saves code exposes only V2 PC APIs", () => {
  const runtimeFiles = new Set([
    ...sourceFilesUnder("src/main"),
    "src/preload/index.ts",
    "scripts/verify-save-mapper.mjs",
    ...sourceFilesUnder("src/renderer/src"),
    ...sourceFilesUnder("src/big-picture/src"),
  ]);

  for (const relativePath of runtimeFiles) {
    assertNoForbiddenPatterns(
      relativePath,
      compatibilityAllowlist.get(relativePath)
    );
  }
});

test("every registered cloud-save event avoids PC V1 storage", () => {
  const eventIndex = "src/main/events/cloud-save/index.ts";
  const imports = [
    ...read(eventIndex).matchAll(/import\s+["']\.\/([^"']+)["'];/g),
  ].map((match) => match[1]);
  assert.ok(
    imports.length > 0,
    "cloud-save event index should register events"
  );

  for (const moduleName of imports) {
    const relativePath = `src/main/events/cloud-save/${moduleName}.ts`;
    assertNoForbiddenPatterns(
      relativePath,
      compatibilityAllowlist.get(relativePath)
    );
  }
  assert.ok(imports.includes("import-ludusavi-backup"));
});
