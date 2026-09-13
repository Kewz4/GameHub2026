import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("desktop Cloud Saves sidebar is wired only to the V2 library and manager", () => {
  const routes = read("src/renderer/src/components/sidebar/routes.tsx");
  const mainRouter = read("src/renderer/src/main.tsx");
  const page = read("src/renderer/src/pages/cloud-saves/cloud-saves.tsx");
  const preload = read("src/preload/index.ts");
  const event = read("src/main/events/cloud-save/get-cloud-save-v2-library.ts");
  const service = read(
    "src/main/services/cloud-save/list-cloud-save-v2-library.ts"
  );

  assert.match(routes, /path:\s*["']\/cloud-saves["']/);
  assert.match(mainRouter, /path=["']\/cloud-saves["']/);
  assert.match(page, /electron\.getCloudSaveV2Library\(\)/);
  assert.match(page, /openCloudSaveManager=1/);
  assert.doesNotMatch(page, /listEmulationSaves|GameArtifact|cloudSaveV1/i);
  assert.match(
    preload,
    /getCloudSaveV2Library:\s*\(\)\s*=>\s*\n?\s*ipcRenderer\.invoke\(["']getCloudSaveV2Library["']\)/
  );
  assert.match(event, /listCloudSaveV2Library\(\)/);
  assert.match(service, /R2Sync\.listCloudSaveV2Snapshots/);
  assert.match(service, /mergeCloudSaveV2LibraryMetadata/);
});

test("memory-card cloud saves keep account and restore IPC wiring aligned", () => {
  const preload = read("src/preload/index.ts");
  const renderer = read(
    "src/renderer/src/pages/settings/emulation/emulation-save-modals.tsx"
  );
  const restoreEvent = read(
    "src/main/events/emulators/restore-emulation-save.ts"
  );
  const service = read("src/main/services/emulators/emulation-cloud-saves.ts");

  assert.match(
    preload,
    /restoreEmulationSave:\s*\([\s\S]{0,160}platform[\s\S]{0,80}saveId[\s\S]{0,80}targetCardFilePath/
  );
  assert.match(
    renderer,
    /restoreEmulationSave\(\s*platform,\s*save\.id,\s*selected\s*\)/
  );
  assert.match(
    restoreEvent,
    /restoreEmulationSave\s*=\s*async\s*\([\s\S]{0,180}platform[\s\S]{0,80}saveId[\s\S]{0,80}cardFilePath/
  );
  assert.match(restoreEvent, /requiresManualImport:\s*true/);
  assert.match(service, /runWithCloudSaveAccountSession/);
  assert.match(service, /getCloudSaveAccountUserId/);
  assert.match(service, /assertCloudSaveAccountSessionCurrent/);
  assert.doesNotMatch(service, /cloudSyncUserId/);
});
