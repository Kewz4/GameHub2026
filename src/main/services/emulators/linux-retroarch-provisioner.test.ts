import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  installLinuxRetroCore,
  linuxRetroArchInstallPlan,
  linuxRetroCoreUrl,
  validateLinuxRetroCore,
  validateLinuxRetroCoreArchive,
  RETROARCH_FLATPAK_REF,
} from "./linux-retroarch-provisioner";

const elf = (machine = 62) => {
  const data = Buffer.alloc(64);
  data.writeUInt32BE(0x7f454c46, 0);
  data[4] = 2;
  data[5] = 1;
  data.writeUInt16LE(3, 16);
  data.writeUInt16LE(machine, 18);
  return data;
};

test("RetroArch provisioning is Linux-only, user-scoped, architecture-specific, and does not bypass Flatpak trust", () => {
  for (const [arch, expected] of [
    ["x64", "x86_64"],
    ["arm64", "aarch64"],
  ] as const) {
    const plan = linuxRetroArchInstallPlan("linux", arch);
    assert.equal(plan.arch, expected);
    assert.deepEqual(plan.args, [
      "install",
      "--user",
      "--noninteractive",
      "--assumeyes",
      `--arch=${expected}`,
      "--from",
      RETROARCH_FLATPAK_REF,
    ]);
    assert.doesNotMatch(
      plan.args.join(" "),
      /sudo|no-gpg|override|filesystem|device/
    );
  }
  assert.throws(() => linuxRetroArchInstallPlan("win32", "x64"), /Linux-only/);
  assert.throws(
    () => linuxRetroArchInstallPlan("linux", "ia32"),
    /matching native RetroArch/
  );
});

test("core URLs are restricted to official buildbot, exact core names, and supported architectures", () => {
  assert.equal(
    linuxRetroCoreUrl("mgba_libretro", "aarch64"),
    "https://buildbot.libretro.com/nightly/linux/aarch64/latest/mgba_libretro.so.zip"
  );
  assert.throws(() => linuxRetroCoreUrl("../../bad", "x86_64"));
  assert.throws(() => linuxRetroCoreUrl("mgba_libretro", "i386"));
});

test("core validation rejects Windows DLLs, wrong CPU, 32-bit ELF and non-shared executables", () => {
  assert.doesNotThrow(() => validateLinuxRetroCore(elf(), "x86_64"));
  assert.doesNotThrow(() => validateLinuxRetroCore(elf(183), "aarch64"));
  assert.throws(() => validateLinuxRetroCore(elf(183), "x86_64"));
  assert.throws(() => validateLinuxRetroCore(Buffer.from("MZ DLL"), "x86_64"));
  const elf32 = elf();
  elf32[4] = 1;
  assert.throws(() => validateLinuxRetroCore(elf32, "x86_64"));
  const executable = elf();
  executable.writeUInt16LE(2, 16);
  assert.throws(() => validateLinuxRetroCore(executable, "x86_64"));
});

test("core archives cannot introduce path traversal, extra files, or the wrong core", () => {
  validateLinuxRetroCoreArchive(["mgba_libretro.so"], "mgba_libretro");
  for (const entries of [
    ["../mgba_libretro.so"],
    ["/mgba_libretro.so"],
    ["other.so"],
    ["mgba_libretro.so", "config.cfg"],
  ]) {
    assert.throws(() =>
      validateLinuxRetroCoreArchive(entries, "mgba_libretro")
    );
  }
});

test("core publication is verified and idempotent without replacing user files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retro-core-unit-"));
  let downloads = 0;
  const tools = {
    listFiles: async () => ["mgba_libretro.so"],
    extractFile: async ({ outputPath }: { outputPath: string }) => {
      await fs.writeFile(path.join(outputPath, "mgba_libretro.so"), elf());
      return { success: true, extractedFiles: ["mgba_libretro.so"] };
    },
  };
  try {
    const download = async (_url: string, file: string) => {
      downloads++;
      await fs.writeFile(file, "archive fixture");
    };
    const installed = await installLinuxRetroCore(
      root,
      "mgba_libretro",
      "x86_64",
      tools,
      download
    );
    assert.equal(downloads, 1);
    assert.deepEqual(await fs.readFile(installed), elf());
    await installLinuxRetroCore(
      root,
      "mgba_libretro",
      "x86_64",
      tools,
      download
    );
    assert.equal(downloads, 1);
    await fs.writeFile(installed, "user-owned wrong file");
    await assert.rejects(
      installLinuxRetroCore(root, "mgba_libretro", "x86_64", tools, download),
      /not a valid/
    );
    assert.equal(await fs.readFile(installed, "utf8"), "user-owned wrong file");
    assert.deepEqual(await fs.readdir(root), ["mgba_libretro.so"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("unexpected archives are rejected before extraction and staging is cleaned", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retro-core-unit-"));
  try {
    await assert.rejects(
      installLinuxRetroCore(
        root,
        "mgba_libretro",
        "x86_64",
        {
          listFiles: async () => ["../saves/important"],
          extractFile: async () => {
            throw new Error("must not extract");
          },
        },
        (url, file) => fs.writeFile(file, url)
      ),
      /unexpected paths/
    );
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
