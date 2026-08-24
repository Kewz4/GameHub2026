import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateOverlayStaticTargetCapabilities,
  type OverlayStaticImageInventory,
} from "./overlay-target-static-capability-policy";

const IMAGE_SHA256 = "1".repeat(64);
const HID_SCHEMA_SHA256 = "2".repeat(64);
const SCE_PAD_ABI_SHA256 = "3".repeat(64);

const image = (
  overrides: Partial<OverlayStaticImageInventory> = {}
): OverlayStaticImageInventory => ({
  canonicalPath: String.raw`C:\Games\Example\Example.exe`,
  contentSha256: IMAGE_SHA256,
  architecture: "x64",
  completeImportSnapshot: true,
  imports: [],
  ...overrides,
});

describe("overlay static target capability policy", () => {
  it("classifies Spider-Man 2's observed D3D12, HID, Raw Input and Steam surfaces", () => {
    const renderer = image({
      canonicalPath: String.raw`C:\Games\Marvel's Spider-Man 2\Spider-Man2.exe`,
      imports: [
        { module: "HID.DLL", symbol: "HidD_GetFeature" },
        { module: "USER32.dll", symbol: "GetRawInputData" },
        { module: "steam_api64.dll", symbol: null },
        { module: "amd_fidelityfx_dx12.dll", symbol: null, delayLoaded: true },
      ],
      referencedSymbols: ["nriCreateDeviceFromD3D12Device"],
      embeddedInterfaceTokens: ["Windows.Gaming.Input"],
    });
    const result = evaluateOverlayStaticTargetCapabilities({
      launchImage: renderer,
      renderImage: renderer,
      completeAdjacentModuleSnapshot: true,
      adjacentModules: [],
    });

    assert.equal(result.requiresChildPropagation, false);
    assert.deepEqual(result.candidateRenderBackends, ["dxgi-d3d12"]);
    assert.ok(result.requiredInputBackends.includes("hid-input-reports"));
    assert.ok(
      result.requiredInputBackends.includes("steam-input-interface-revisions")
    );
    assert.ok(result.requiredInputBackends.includes("wgi-gamepad"));
    assert.ok(result.requiredInputBackends.includes("wgi-raw-game-controller"));
    assert.deepEqual(result.requiredChildRoutes, []);
    assert.ok(result.blockers.includes("hid-report-schema-unverified"));
    assert.ok(result.blockers.includes("steam-interface-revision-unresolved"));
  });

  it("classifies Khazan's launcher child, D3D12, XInput 1.3, HID and libScePad surfaces", () => {
    const launchImage = image({
      canonicalPath: String.raw`C:\Games\Khazan\steamclient_loader_x64.exe`,
      imports: [{ module: "KERNEL32.dll", symbol: "CreateProcessW" }],
    });
    const renderImage = image({
      canonicalPath: String.raw`C:\Games\Khazan\BBQ\Binaries\Win64\BBQ-Win64-Shipping.exe`,
      imports: [
        { module: "d3d12.dll", symbol: null, delayLoaded: true },
        { module: "d3d11.dll", symbol: null },
        { module: "XINPUT1_3.dll", symbol: null },
        { module: "HID.DLL", symbol: "HidD_GetFeature" },
        { module: "steam_api64.dll", symbol: null, delayLoaded: true },
      ],
      embeddedInterfaceRevisions: ["SteamInput006"],
    });
    const result = evaluateOverlayStaticTargetCapabilities({
      launchImage,
      renderImage,
      completeAdjacentModuleSnapshot: true,
      adjacentModules: ["libScePad.dll"],
      hidReportSchemaDigest: HID_SCHEMA_SHA256,
    });

    assert.equal(result.requiresChildPropagation, true);
    assert.deepEqual(result.requiredChildRoutes, ["create-process-w-a"]);
    assert.deepEqual(result.candidateRenderBackends, [
      "dxgi-d3d11",
      "dxgi-d3d12",
    ]);
    for (const backend of [
      "xinput-1.3",
      "hid-input-reports",
      "steam-input-interface-revisions",
      "libscepad",
    ] as const) {
      assert.ok(result.requiredInputBackends.includes(backend), backend);
    }
    assert.deepEqual(result.observedSteamInterfaceRevisions, ["steaminput006"]);
    assert.deepEqual(result.blockers, ["libscepad-abi-unverified"]);
  });

  it("fails closed for incomplete inventories and an unresolved child/render path", () => {
    const result = evaluateOverlayStaticTargetCapabilities({
      launchImage: image({
        canonicalPath: String.raw`C:\Games\Loader.exe`,
        architecture: "x86",
        completeImportSnapshot: false,
      }),
      renderImage: image({
        canonicalPath: String.raw`C:\Games\Renderer.exe`,
        completeImportSnapshot: false,
      }),
      completeAdjacentModuleSnapshot: false,
      adjacentModules: [],
    });

    assert.deepEqual(
      new Set(result.blockers),
      new Set([
        "incomplete-launch-import-snapshot",
        "incomplete-render-import-snapshot",
        "incomplete-adjacent-module-snapshot",
        "architecture-mismatch",
        "render-backend-unresolved",
        "child-creation-route-unresolved",
      ])
    );
  });

  it("removes intrinsic middleware blockers only with explicit native verification", () => {
    const renderer = image({
      imports: [
        { module: "d3d12.dll", symbol: null },
        { module: "HID.DLL", symbol: "HidD_GetInputReport" },
        { module: "steam_api64.dll", symbol: null },
      ],
      embeddedInterfaceRevisions: ["SteamController008"],
    });
    const result = evaluateOverlayStaticTargetCapabilities({
      launchImage: renderer,
      renderImage: renderer,
      completeAdjacentModuleSnapshot: true,
      adjacentModules: ["libScePad.dll"],
      hidReportSchemaDigest: HID_SCHEMA_SHA256,
      libScePadAbiDigest: SCE_PAD_ABI_SHA256,
    });

    assert.deepEqual(result.blockers, []);
    assert.deepEqual(result.observedSteamInterfaceRevisions, [
      "steamcontroller008",
    ]);
  });

  it("conservatively classifies preparsed HID and SetupAPI report-reader paths", () => {
    const directSymbols = [
      "HidD_GetPreparsedData",
      "HidP_GetData",
      "HidP_GetUsageValueArray",
    ];
    for (const symbol of directSymbols) {
      const renderer = image({
        imports: [
          { module: "d3d11.dll", symbol: null },
          { module: "hid.dll", symbol },
        ],
      });
      const result = evaluateOverlayStaticTargetCapabilities({
        launchImage: renderer,
        renderImage: renderer,
        completeAdjacentModuleSnapshot: true,
        adjacentModules: [],
      });
      assert.ok(result.requiredInputBackends.includes("hid-input-reports"));
      assert.ok(result.blockers.includes("hid-report-schema-unverified"));
    }

    const setupApiReader = image({
      imports: [
        { module: "d3d11.dll", symbol: null },
        { module: "setupapi.dll", symbol: "SetupDiGetClassDevsW" },
        { module: "setupapi.dll", symbol: "SetupDiEnumDeviceInterfaces" },
        { module: "kernel32.dll", symbol: "CreateFileW" },
        { module: "kernel32.dll", symbol: "ReadFile" },
      ],
    });
    const setupResult = evaluateOverlayStaticTargetCapabilities({
      launchImage: setupApiReader,
      renderImage: setupApiReader,
      completeAdjacentModuleSnapshot: true,
      adjacentModules: [],
    });
    assert.ok(setupResult.requiredInputBackends.includes("hid-input-reports"));
    assert.ok(setupResult.blockers.includes("hid-report-schema-unverified"));

    const incompletePattern = image({
      imports: setupApiReader.imports.filter(
        (entry) => entry.symbol !== "ReadFile"
      ),
    });
    assert.equal(
      evaluateOverlayStaticTargetCapabilities({
        launchImage: incompletePattern,
        renderImage: incompletePattern,
        completeAdjacentModuleSnapshot: true,
        adjacentModules: [],
      }).requiredInputBackends.includes("hid-input-reports"),
      false
    );
  });
});
