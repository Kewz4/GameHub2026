import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import type { OverlayStaticImageInventory } from "./overlay-target-static-capability-policy";
import {
  NodeOverlayAdjacentDllInventoryProvider,
  OverlayStaticTargetPreflightService,
  type OverlayAdjacentDllInventoryProvider,
  type OverlayStaticTargetImageInspector,
} from "./overlay-static-target-preflight";

const temporaryRoots: string[] = [];
const IMAGE_SHA256 = "1".repeat(64);
const HID_SCHEMA_SHA256 = "b".repeat(64);

const temporaryRoot = () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "overlay-static-preflight-")
  );
  temporaryRoots.push(root);
  return fs.realpathSync.native(root);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const image = (
  canonicalPath: string,
  overrides: Partial<OverlayStaticImageInventory> = {}
): OverlayStaticImageInventory => ({
  canonicalPath,
  contentSha256: IMAGE_SHA256,
  architecture: "x64",
  completeImportSnapshot: true,
  imports: [{ module: "d3d12.dll", symbol: null }],
  ...overrides,
});

const mappedInspector = (
  images: Readonly<Record<string, OverlayStaticImageInventory>>,
  onInspect?: (targetPath: string) => void
): OverlayStaticTargetImageInspector => ({
  inspect(targetPath) {
    onInspect?.(targetPath);
    const result = images[targetPath];
    if (!result) throw new Error("unexpected target");
    return result;
  },
});

describe("overlay static target preflight", () => {
  it("scans a same-target directory once, non-recursively, and freezes its decision", async () => {
    const root = temporaryRoot();
    const target = path.join(root, "Game.exe");
    fs.writeFileSync(target, "fixture");
    fs.writeFileSync(path.join(root, "Visible.DLL"), "fixture");
    const nested = path.join(root, "nested");
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, "hidden.dll"), "fixture");
    let inspections = 0;
    const preflight = new OverlayStaticTargetPreflightService({
      imageInspector: mappedInspector(
        { [target]: image(target) },
        () => (inspections += 1)
      ),
    });

    const decision = await preflight.inspect(
      { launchTargetPath: target },
      new AbortController().signal
    );

    assert.equal(decision.allowed, true);
    assert.equal(inspections, 1);
    if (!decision.allowed) return;
    assert.deepEqual(decision.inventory.adjacentModules, ["visible.dll"]);
    assert.equal(decision.profile.requiresChildPropagation, false);
    assert.equal(Object.isFrozen(decision), true);
    assert.equal(Object.isFrozen(decision.inventory), true);
    assert.equal(Object.isFrozen(decision.inventory.launchImage.imports), true);
    assert.equal(Object.isFrozen(decision.scannedAdjacentDirectories), true);
  });

  it("supports a distinct explicit renderer and inventories only both direct directories", async () => {
    const root = temporaryRoot();
    const launchRoot = path.join(root, "launcher");
    const renderRoot = path.join(root, "renderer");
    fs.mkdirSync(launchRoot);
    fs.mkdirSync(renderRoot);
    const launchTarget = path.join(launchRoot, "Launcher.exe");
    const renderTarget = path.join(renderRoot, "Renderer.exe");
    fs.writeFileSync(path.join(launchRoot, "launcher-only.dll"), "fixture");
    fs.writeFileSync(path.join(renderRoot, "renderer-only.dll"), "fixture");
    const preflight = new OverlayStaticTargetPreflightService({
      imageInspector: mappedInspector({
        [launchTarget]: image(launchTarget, {
          imports: [{ module: "kernel32.dll", symbol: "CreateProcessW" }],
        }),
        [renderTarget]: image(renderTarget, {
          imports: [{ module: "d3d11.dll", symbol: null }],
        }),
      }),
    });

    const decision = await preflight.inspect(
      { launchTargetPath: launchTarget, renderTargetPath: renderTarget },
      new AbortController().signal
    );

    assert.equal(decision.allowed, true);
    if (!decision.allowed) return;
    assert.deepEqual(decision.inventory.adjacentModules, [
      "launcher-only.dll",
      "renderer-only.dll",
    ]);
    assert.equal(decision.profile.requiresChildPropagation, true);
    assert.deepEqual(decision.profile.requiredChildRoutes, [
      "create-process-w-a",
    ]);
    assert.deepEqual(decision.profile.candidateRenderBackends, ["dxgi-d3d11"]);
  });

  it("refuses incomplete and inconsistent same-target image snapshots before directory access", async () => {
    const root = temporaryRoot();
    const launchTarget = path.join(root, "Launch.exe");
    let inventories = 0;
    const adjacentDllInventory: OverlayAdjacentDllInventoryProvider = {
      inventory() {
        inventories += 1;
        throw new Error("must not run");
      },
    };

    const incomplete = new OverlayStaticTargetPreflightService({
      imageInspector: mappedInspector({
        [launchTarget]: image(launchTarget, {
          completeImportSnapshot: false,
        }),
      }),
      adjacentDllInventory,
    });
    assert.deepEqual(
      await incomplete.inspect(
        { launchTargetPath: launchTarget },
        new AbortController().signal
      ),
      { allowed: false, reason: "incomplete-launch-image-snapshot" }
    );

    const renderTarget = path.join(root, "Render.exe");
    const incompleteRenderer = new OverlayStaticTargetPreflightService({
      imageInspector: mappedInspector({
        [launchTarget]: image(launchTarget, {
          imports: [{ module: "kernel32.dll", symbol: "CreateProcessW" }],
        }),
        [renderTarget]: image(renderTarget, {
          completeImportSnapshot: false,
        }),
      }),
      adjacentDllInventory,
    });
    assert.deepEqual(
      await incompleteRenderer.inspect(
        { launchTargetPath: launchTarget, renderTargetPath: renderTarget },
        new AbortController().signal
      ),
      { allowed: false, reason: "incomplete-render-image-snapshot" }
    );

    let sameTargetInspection = 0;
    const inconsistent = new OverlayStaticTargetPreflightService({
      imageInspector: {
        inspect() {
          sameTargetInspection += 1;
          return image(launchTarget, {
            imports: [
              {
                module: sameTargetInspection === 1 ? "d3d12.dll" : "d3d11.dll",
                symbol: null,
              },
            ],
          });
        },
      },
      adjacentDllInventory,
    });
    assert.deepEqual(
      await inconsistent.inspect(
        { launchTargetPath: launchTarget, renderTargetPath: launchTarget },
        new AbortController().signal
      ),
      { allowed: false, reason: "ambiguous-same-target-snapshot" }
    );

    let digestInspection = 0;
    const digestChanged = new OverlayStaticTargetPreflightService({
      imageInspector: {
        inspect() {
          digestInspection += 1;
          return image(launchTarget, {
            contentSha256:
              digestInspection === 1 ? IMAGE_SHA256 : "f".repeat(64),
          });
        },
      },
      adjacentDllInventory,
    });
    assert.deepEqual(
      await digestChanged.inspect(
        { launchTargetPath: launchTarget, renderTargetPath: launchTarget },
        new AbortController().signal
      ),
      { allowed: false, reason: "ambiguous-same-target-snapshot" }
    );
    assert.equal(inventories, 0);
  });

  it("refuses an inspector result for any path other than the requested target", async () => {
    const root = temporaryRoot();
    const launchTarget = path.join(root, "Launch.exe");
    const renderTarget = path.join(root, "Render.exe");
    const otherTarget = path.join(root, "Other.exe");

    const mismatchedLaunch = new OverlayStaticTargetPreflightService({
      imageInspector: mappedInspector({
        [launchTarget]: image(otherTarget),
      }),
    });
    assert.deepEqual(
      await mismatchedLaunch.inspect(
        { launchTargetPath: launchTarget },
        new AbortController().signal
      ),
      { allowed: false, reason: "launch-image-path-mismatch" }
    );

    const mismatchedRender = new OverlayStaticTargetPreflightService({
      imageInspector: mappedInspector({
        [launchTarget]: image(launchTarget),
        [renderTarget]: image(otherTarget),
      }),
    });
    assert.deepEqual(
      await mismatchedRender.inspect(
        { launchTargetPath: launchTarget, renderTargetPath: renderTarget },
        new AbortController().signal
      ),
      { allowed: false, reason: "render-image-path-mismatch" }
    );
  });

  it("refuses incomplete injected adjacent inventories", async () => {
    const root = temporaryRoot();
    const target = path.join(root, "Game.exe");
    const preflight = new OverlayStaticTargetPreflightService({
      imageInspector: mappedInspector({ [target]: image(target) }),
      adjacentDllInventory: {
        inventory(directories) {
          return {
            complete: false,
            scannedDirectories: directories,
            modules: [],
            ambiguousModuleNames: [],
          };
        },
      },
    });

    assert.deepEqual(
      await preflight.inspect(
        { launchTargetPath: target },
        new AbortController().signal
      ),
      { allowed: false, reason: "incomplete-adjacent-module-snapshot" }
    );
  });

  it("refuses ambiguous duplicate DLLs across launch and render directories", async () => {
    const root = temporaryRoot();
    const launchRoot = path.join(root, "launch");
    const renderRoot = path.join(root, "render");
    fs.mkdirSync(launchRoot);
    fs.mkdirSync(renderRoot);
    const launchTarget = path.join(launchRoot, "Launch.exe");
    const renderTarget = path.join(renderRoot, "Render.exe");
    fs.writeFileSync(path.join(launchRoot, "common.dll"), "one");
    fs.writeFileSync(path.join(renderRoot, "COMMON.DLL"), "two");
    const preflight = new OverlayStaticTargetPreflightService({
      imageInspector: mappedInspector({
        [launchTarget]: image(launchTarget, {
          imports: [{ module: "kernel32.dll", symbol: "CreateProcessW" }],
        }),
        [renderTarget]: image(renderTarget),
      }),
    });

    assert.deepEqual(
      await preflight.inspect(
        { launchTargetPath: launchTarget, renderTargetPath: renderTarget },
        new AbortController().signal
      ),
      { allowed: false, reason: "ambiguous-adjacent-module-snapshot" }
    );
  });

  it("enforces configurable test bounds beneath immutable production ceilings", async () => {
    const root = temporaryRoot();
    const target = path.join(root, "Game.exe");
    fs.writeFileSync(path.join(root, "one.txt"), "fixture");
    fs.writeFileSync(path.join(root, "two.txt"), "fixture");
    fs.writeFileSync(path.join(root, "three.txt"), "fixture");
    const preflight = new OverlayStaticTargetPreflightService({
      imageInspector: mappedInspector({ [target]: image(target) }),
      adjacentDllInventory: new NodeOverlayAdjacentDllInventoryProvider({
        maxEntriesPerDirectory: 2,
      }),
    });

    assert.deepEqual(
      await preflight.inspect(
        { launchTargetPath: target },
        new AbortController().signal
      ),
      { allowed: false, reason: "adjacent-module-inventory-failed" }
    );
  });

  it("returns the frozen blocking profile instead of authorizing unresolved HID", async () => {
    const root = temporaryRoot();
    const target = path.join(root, "Game.exe");
    const preflight = new OverlayStaticTargetPreflightService({
      imageInspector: mappedInspector({
        [target]: image(target, {
          imports: [
            { module: "d3d12.dll", symbol: null },
            { module: "hid.dll", symbol: "HidD_GetFeature" },
          ],
        }),
      }),
    });

    const decision = await preflight.inspect(
      { launchTargetPath: target },
      new AbortController().signal
    );

    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "capability-blocked");
    if (decision.reason !== "capability-blocked") return;
    assert.deepEqual(decision.profile.blockers, [
      "hid-report-schema-unverified",
    ]);
    assert.equal(Object.isFrozen(decision.profile), true);
    assert.equal(Object.isFrozen(decision.profile.blockers), true);
  });

  it("rejects raw request capability assertions and accepts them only from its trusted verifier", async () => {
    const root = temporaryRoot();
    const target = path.join(root, "Game.exe");
    const targetImage = image(target, {
      imports: [
        { module: "d3d12.dll", symbol: null },
        { module: "hid.dll", symbol: "HidD_GetFeature" },
      ],
    });
    const untrusted = new OverlayStaticTargetPreflightService({
      imageInspector: mappedInspector({ [target]: targetImage }),
    });
    const untrustedDecision = await untrusted.inspect(
      {
        launchTargetPath: target,
        hidReportSchemasVerified: true,
      } as unknown as { launchTargetPath: string },
      new AbortController().signal
    );
    assert.deepEqual(untrustedDecision, {
      allowed: false,
      reason: "invalid-request",
    });

    const unresolvedDecision = await untrusted.inspect(
      { launchTargetPath: target },
      new AbortController().signal
    );
    assert.equal(unresolvedDecision.allowed, false);
    if (
      unresolvedDecision.allowed ||
      unresolvedDecision.reason !== "capability-blocked"
    )
      return;
    assert.deepEqual(unresolvedDecision.profile.blockers, [
      "hid-report-schema-unverified",
    ]);

    let verifiedContextFrozen = false;
    const trusted = new OverlayStaticTargetPreflightService({
      imageInspector: mappedInspector({ [target]: targetImage }),
      capabilityEvidenceVerifier: {
        verify(context) {
          verifiedContextFrozen =
            Object.isFrozen(context) &&
            Object.isFrozen(context.adjacentModules) &&
            context.renderImage.canonicalPath === target;
          return { hidReportSchemaDigest: HID_SCHEMA_SHA256 };
        },
      },
    });
    const trustedDecision = await trusted.inspect(
      { launchTargetPath: target },
      new AbortController().signal
    );
    assert.equal(trustedDecision.allowed, true);
    assert.equal(verifiedContextFrozen, true);
    if (trustedDecision.allowed) {
      assert.equal(
        trustedDecision.inventory.hidReportSchemaDigest,
        HID_SCHEMA_SHA256
      );
    }

    for (const evidence of [
      { hidReportSchemaDigest: HID_SCHEMA_SHA256.toUpperCase() },
      { hidReportSchemasVerified: true },
    ]) {
      const malformed = new OverlayStaticTargetPreflightService({
        imageInspector: mappedInspector({ [target]: targetImage }),
        capabilityEvidenceVerifier: {
          verify: () => evidence as never,
        },
      });
      assert.deepEqual(
        await malformed.inspect(
          { launchTargetPath: target },
          new AbortController().signal
        ),
        { allowed: false, reason: "capability-verification-failed" }
      );
    }
  });

  it("observes cancellation before and immediately after an injected image scan", async () => {
    const root = temporaryRoot();
    const target = path.join(root, "Game.exe");
    let calls = 0;
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const neverCalled = new OverlayStaticTargetPreflightService({
      imageInspector: {
        inspect() {
          calls += 1;
          return image(target);
        },
      },
    });
    await assert.rejects(
      neverCalled.inspect({ launchTargetPath: target }, alreadyAborted.signal),
      { name: "AbortError" }
    );
    assert.equal(calls, 0);

    const controller = new AbortController();
    const aborting = new OverlayStaticTargetPreflightService({
      imageInspector: {
        inspect() {
          calls += 1;
          controller.abort();
          return image(target);
        },
      },
    });
    await assert.rejects(
      aborting.inspect({ launchTargetPath: target }, controller.signal),
      { name: "AbortError" }
    );
    assert.equal(calls, 1);
  });
});
