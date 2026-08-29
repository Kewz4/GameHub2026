import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

describe("production overlay runtime policy", () => {
  it("has no injected input-gate path in the manager or native adapter", () => {
    const mainEntry = read("src/main/index.ts");
    const eventEntry = read("src/main/events/index.ts");
    const overlayEvents = read("src/main/events/overlay/index.ts");
    const manager = read("src/main/services/overlay-manager.ts");
    const nativeAdapter = read("src/main/services/native-addon.ts");

    for (const source of [
      mainEntry,
      eventEntry,
      overlayEvents,
      manager,
      nativeAdapter,
    ]) {
      assert.doesNotMatch(source, /injectInputHook|gamehub-inputhook/u);
      assert.doesNotMatch(
        source,
        /createOverlayInputGate|setOverlayInputGate/u
      );
      assert.doesNotMatch(
        source,
        /overlay-(?:supervised-launch|input-gate|injection-policy)/u
      );
    }
    assert.match(manager, /resolveWindowModeEligibility/u);
    assert.match(manager, /overlay-unavailable/u);
  });

  it("does not build or package the historical DLL and broker", () => {
    const nativeBuild = read("scripts/build-native-addon.cjs");
    const releaseWorkflow = read(".github/workflows/build-installer.yml");
    const packageScripts = read("package.json");
    const builder = read("electron-builder.yml");
    const cargo = read("native/hydra-native/Cargo.toml");
    const nativeLibrary = read("native/hydra-native/src/lib.rs");

    assert.doesNotMatch(nativeBuild, /inputHookManifestPath|cargo.*inputhook/u);
    assert.match(nativeBuild, /obsoleteOverlayHookArtifacts/u);
    assert.doesNotMatch(packageScripts, /test:overlay-native-qa/u);
    assert.doesNotMatch(
      releaseWorkflow,
      /gamehub-(?:inputhook|overlay-supervisor)|overlay-hook-qa/u
    );
    assert.doesNotMatch(builder, /@asdf-overlay/u);
    assert.match(builder, /!native\{,\/\*\*\}/u);
    assert.match(builder, /!scripts\/qa-live-overlay-acceptance\.mjs/u);
    assert.match(cargo, /autobins = false/u);
    assert.match(cargo, /name = "presentmon-bridge"/u);
    assert.match(cargo, /default = \[\]/u);
    assert.match(cargo, /overlay-hook-qa = \[\]/u);
    assert.doesNotMatch(nativeBuild, /overlay-hook-qa/u);
    assert.doesNotMatch(nativeLibrary, /^mod win_inject;/mu);
    assert.doesNotMatch(nativeLibrary, /win_inject::inject_dll/u);
    for (const moduleName of [
      "overlay_process_access_qa",
      "overlay_injection_risk_qa",
      "overlay_input_gate_qa",
    ]) {
      assert.match(
        nativeLibrary,
        new RegExp(
          `#\\[cfg\\(feature = "overlay-hook-qa"\\)\\]\\nmod ${moduleName}`,
          "u"
        )
      );
    }
  });
});
