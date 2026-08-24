import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  inspectOverlayPeImports,
  OverlayPeImportInspectionError,
} from "./overlay-pe-import-inspector";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-pe-imports-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const writeAscii = (buffer: Buffer, offset: number, value: string) => {
  buffer.write(value, offset, "ascii");
  buffer[offset + value.length] = 0;
};

const buildPe64Fixture = () => {
  const buffer = Buffer.alloc(0x1200);
  buffer.writeUInt16LE(0x5a4d, 0);
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.writeUInt32LE(0x0000_4550, 0x80);
  buffer.writeUInt16LE(0x8664, 0x84);
  buffer.writeUInt16LE(1, 0x86);
  buffer.writeUInt16LE(0xf0, 0x94);
  const optional = 0x98;
  buffer.writeUInt16LE(0x20b, optional);
  buffer.writeBigUInt64LE(0x0000_0001_4000_0000n, optional + 24);
  buffer.writeUInt32LE(0x200, optional + 60);
  buffer.writeUInt32LE(16, optional + 108);
  buffer.writeUInt32LE(0x1100, optional + 112 + 8);
  buffer.writeUInt32LE(40, optional + 112 + 12);
  buffer.writeUInt32LE(0x1200, optional + 112 + 13 * 8);
  buffer.writeUInt32LE(64, optional + 112 + 13 * 8 + 4);

  const section = optional + 0xf0;
  buffer.write(".rdata", section, "ascii");
  buffer.writeUInt32LE(0x1000, section + 8);
  buffer.writeUInt32LE(0x1000, section + 12);
  buffer.writeUInt32LE(0x1000, section + 16);
  buffer.writeUInt32LE(0x200, section + 20);

  const normalDescriptor = 0x300;
  buffer.writeUInt32LE(0x1300, normalDescriptor);
  buffer.writeUInt32LE(0x1400, normalDescriptor + 12);
  buffer.writeUInt32LE(0x1310, normalDescriptor + 16);
  buffer.writeBigUInt64LE(0x1500n, 0x500);
  buffer.writeBigUInt64LE((1n << 63n) | 7n, 0x508);
  buffer.writeBigUInt64LE(0n, 0x510);
  writeAscii(buffer, 0x600, "HID.DLL");
  buffer.writeUInt16LE(0, 0x700);
  writeAscii(buffer, 0x702, "HidD_GetFeature");

  const delayDescriptor = 0x400;
  buffer.writeUInt32LE(1, delayDescriptor);
  buffer.writeUInt32LE(0x1420, delayDescriptor + 4);
  buffer.writeUInt32LE(0x1320, delayDescriptor + 12);
  buffer.writeUInt32LE(0x1340, delayDescriptor + 16);
  buffer.writeBigUInt64LE(0x1520n, 0x540);
  buffer.writeBigUInt64LE(0n, 0x548);
  writeAscii(buffer, 0x620, "d3d12.dll");
  buffer.writeUInt16LE(0, 0x720);
  writeAscii(buffer, 0x722, "D3D12CreateDevice");
  writeAscii(buffer, 0x900, "SteamInput006");
  writeAscii(buffer, 0x940, "Windows.Gaming.Input");
  buffer.write("GameInputCreate", 0x980, "utf16le");
  return buffer;
};

describe("overlay PE import inspector", () => {
  it("reads imports plus exact ASCII/UTF-16 interface tokens", () => {
    const filePath = path.join(root, "fixture-x64.exe");
    fs.writeFileSync(filePath, buildPe64Fixture());
    const result = inspectOverlayPeImports(filePath);

    assert.equal(result.architecture, "x64");
    assert.equal(
      result.contentSha256,
      createHash("sha256").update(buildPe64Fixture()).digest("hex")
    );
    assert.match(result.contentSha256, /^[0-9a-f]{64}$/u);
    assert.equal(result.completeImportSnapshot, true);
    assert.deepEqual(
      result.imports.map((item) => [
        item.module,
        item.symbol,
        item.delayLoaded,
      ]),
      [
        ["HID.DLL", "HidD_GetFeature", false],
        ["HID.DLL", "#7", false],
        ["d3d12.dll", "D3D12CreateDevice", true],
      ]
    );
    assert.deepEqual(result.embeddedInterfaceRevisions, ["SteamInput006"]);
    assert.deepEqual(result.embeddedInterfaceTokens, [
      "GameInputCreate",
      "SteamInput006",
      "Windows.Gaming.Input",
    ]);
  });

  it("rejects a non-PE file and an unterminated descriptor table", () => {
    const invalid = path.join(root, "invalid.exe");
    fs.writeFileSync(invalid, Buffer.alloc(64));
    assert.throws(() => inspectOverlayPeImports(invalid), {
      name: "OverlayPeImportInspectionError",
      code: "invalid-pe",
    });

    const unterminated = buildPe64Fixture();
    unterminated.fill(1, 0x314, 0x328);
    const unterminatedPath = path.join(root, "unterminated.exe");
    fs.writeFileSync(unterminatedPath, unterminated);
    assert.throws(
      () => inspectOverlayPeImports(unterminatedPath),
      (error) =>
        error instanceof OverlayPeImportInspectionError &&
        ["invalid-rva", "invalid-import-string"].includes(error.code)
    );
  });

  it("rejects overlapping virtual and raw section mappings", () => {
    const variants = [
      {
        name: "overlapping-virtual-sections.exe",
        mutate(section: number, buffer: Buffer) {
          buffer.writeUInt32LE(0x1800, section + 12);
          buffer.writeUInt32LE(0x200, section + 20);
        },
      },
      {
        name: "overlapping-raw-sections.exe",
        mutate(section: number, buffer: Buffer) {
          buffer.writeUInt32LE(0x3000, section + 12);
          buffer.writeUInt32LE(0x800, section + 20);
        },
      },
    ];

    for (const variant of variants) {
      const fixture = buildPe64Fixture();
      fixture.writeUInt16LE(2, 0x86);
      const secondSection = 0x98 + 0xf0 + 40;
      fixture.write(".data", secondSection, "ascii");
      fixture.writeUInt32LE(0x800, secondSection + 8);
      fixture.writeUInt32LE(0x2000, secondSection + 12);
      fixture.writeUInt32LE(0x400, secondSection + 16);
      fixture.writeUInt32LE(0x800, secondSection + 20);
      variant.mutate(secondSection, fixture);
      const filePath = path.join(root, variant.name);
      fs.writeFileSync(filePath, fixture);
      assert.throws(() => inspectOverlayPeImports(filePath), {
        name: "OverlayPeImportInspectionError",
        code: "invalid-pe",
      });
    }
  });

  it("requires an absolute path", () => {
    assert.throws(() => inspectOverlayPeImports("relative.exe"), {
      name: "OverlayPeImportInspectionError",
      code: "invalid-path",
    });
  });

  it("rejects a file whose retained identity stamp changes during inspection", (context) => {
    const filePath = path.join(root, "changed-during-inspection.exe");
    fs.writeFileSync(filePath, buildPe64Fixture());
    const fstatApi = fs as unknown as {
      fstatSync(file: number, options: { bigint: true }): fs.BigIntStats;
    };
    const originalFstat = fstatApi.fstatSync.bind(fs);
    let calls = 0;
    context.mock.method(fstatApi, "fstatSync", (file, options) => {
      const result = originalFstat(file, options);
      calls += 1;
      if (calls !== 2) return result;
      return new Proxy(result, {
        get(target, property) {
          if (property === "mtimeNs") return target.mtimeNs + 1n;
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });

    assert.throws(() => inspectOverlayPeImports(filePath), {
      name: "OverlayPeImportInspectionError",
      code: "file-changed",
    });
    assert.equal(calls, 2);
  });
});
