import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateOverlayInjectionEligibility,
  findOverlayAntiCheatProcess,
  isExactOverlayTargetProcess,
} from "./overlay-injection-policy";

describe("overlay injection policy", () => {
  it("allows a manually managed local render executable", () => {
    assert.deepEqual(
      evaluateOverlayInjectionEligibility(
        {
          libraryOrigin: "catalog",
          executablePath: String.raw`C:\Games\Khazan\steamclient_loader_x64.exe`,
          nativeExecutablePath: null,
          trackingExecutablePaths: [
            String.raw`C:\Games\Khazan\BBQ\Binaries\Win64\BBQ-Win64-Shipping.exe`,
          ],
        },
        String.raw`C:\Games\Khazan\BBQ\Binaries\Win64\BBQ-Win64-Shipping.exe`
      ),
      { allowed: true }
    );
  });

  it("refuses synced, unstamped, and protocol-owned titles", () => {
    for (const libraryOrigin of ["sync", undefined] as const) {
      assert.equal(
        evaluateOverlayInjectionEligibility(
          {
            libraryOrigin,
            executablePath: String.raw`C:\Games\Online\Online.exe`,
            nativeExecutablePath: null,
            trackingExecutablePaths: [],
          },
          String.raw`C:\Games\Online\Online.exe`
        ).allowed,
        false
      );
    }
    assert.equal(
      evaluateOverlayInjectionEligibility(
        {
          libraryOrigin: "catalog",
          executablePath: "steam://run/123",
          nativeExecutablePath: null,
          trackingExecutablePaths: [],
        },
        String.raw`C:\Games\Online\Online.exe`
      ).allowed,
      false
    );
  });

  it("refuses an executable outside every configured game root", () => {
    assert.deepEqual(
      evaluateOverlayInjectionEligibility(
        {
          libraryOrigin: "catalog",
          executablePath: String.raw`C:\Games\Example\Example.exe`,
          nativeExecutablePath: null,
          trackingExecutablePaths: [],
        },
        String.raw`C:\Windows\System32\Example.exe`
      ),
      { allowed: false, reason: "unrelated-target-executable" }
    );
  });

  it("detects an anti-cheat sibling but ignores an unrelated install", () => {
    const processes = [
      {
        pid: 10,
        name: "EasyAntiCheat_EOS.exe",
        exe: String.raw`C:\Games\Online\EasyAntiCheat\EasyAntiCheat_EOS.exe`,
      },
      {
        pid: 11,
        name: "BEService.exe",
        exe: String.raw`D:\Other\BEService.exe`,
      },
    ];
    assert.equal(
      findOverlayAntiCheatProcess(
        processes,
        String.raw`C:\Games\Online\Online.exe`
      )?.pid,
      10
    );
    assert.equal(
      findOverlayAntiCheatProcess(
        processes.slice(1),
        String.raw`C:\Games\Online\Online.exe`
      ),
      null
    );
  });

  it("recognizes common EA, Ricochet, Vanguard, and PunkBuster services", () => {
    for (const [index, name] of [
      "EAAntiCheat.GameService.exe",
      "Randgrid.sys",
      "vgc.exe",
      "PnkBstrB.exe",
    ].entries()) {
      assert.equal(
        findOverlayAntiCheatProcess(
          [
            {
              pid: 100 + index,
              name,
              exe: String.raw`C:\Games\Example\AntiCheat\${name}`,
            },
          ],
          String.raw`C:\Games\Example\Example.exe`
        )?.pid,
        100 + index,
        name
      );
    }
  });

  it("scans from a configured launcher root when the renderer is nested", () => {
    const processes = [
      {
        pid: 12,
        name: "EasyAntiCheat_EOS.exe",
        exe: String.raw`C:\Games\Khazan\EasyAntiCheat\EasyAntiCheat_EOS.exe`,
      },
    ];
    assert.equal(
      findOverlayAntiCheatProcess(
        processes,
        String.raw`C:\Games\Khazan\BBQ\Binaries\Win64\BBQ-Win64-Shipping.exe`,
        [String.raw`C:\Games\Khazan\steamclient_loader_x64.exe`]
      )?.pid,
      12
    );
  });

  it("revalidates the exact selected PID and executable before injection", () => {
    const processes = [
      {
        pid: 42,
        name: "BBQ-Win64-Shipping.exe",
        exe: String.raw`C:\Games\Khazan\BBQ\Binaries\Win64\BBQ-Win64-Shipping.exe`,
      },
    ];
    assert.equal(
      isExactOverlayTargetProcess(
        processes,
        42,
        String.raw`c:\games\khazan\BBQ\Binaries\Win64\BBQ-Win64-Shipping.exe`
      ),
      true
    );
    assert.equal(
      isExactOverlayTargetProcess(
        processes,
        41,
        String.raw`C:\Games\Khazan\BBQ\Binaries\Win64\BBQ-Win64-Shipping.exe`
      ),
      false
    );
    assert.equal(
      isExactOverlayTargetProcess(
        processes,
        42,
        String.raw`C:\Games\Spider-Man 2\Spider-Man2.exe`
      ),
      false
    );
  });
});
