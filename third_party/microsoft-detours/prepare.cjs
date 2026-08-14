const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPOSITORY = "https://github.com/microsoft/Detours.git";
const COMMIT = "e4bfd6b03e50de46b47abfbd1e46b384f0c5f833";
const TREE = "600b4d42793cbefd55070c43b8d4b3d4a569cb8c";
const FILES = [
  "LICENSE.md",
  "system.mak",
  "src/Makefile",
  "src/creatwth.cpp",
  "src/detours.cpp",
  "src/detours.h",
  "src/detver.h",
  "src/disasm.cpp",
  "src/disolarm.cpp",
  "src/disolarm64.cpp",
  "src/disolia64.cpp",
  "src/disolx64.cpp",
  "src/disolx86.cpp",
  "src/image.cpp",
  "src/modules.cpp",
  "src/uimports.cpp",
];

const vendorRoot = __dirname;

const run = (command, args, options = {}) =>
  childProcess.execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });

const normalizeLf = (buffer) =>
  Buffer.from(buffer.toString("utf8").replace(/\r\n?/g, "\n"), "utf8");

const sha256 = (buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "gamehub-detours-prepare-")
);

try {
  run("git", [
    "clone",
    "--quiet",
    "--no-checkout",
    "--filter=blob:none",
    REPOSITORY,
    temporaryRoot,
  ]);
  run("git", ["-C", temporaryRoot, "checkout", "--quiet", "--detach", COMMIT]);

  const actualCommit = run("git", [
    "-C",
    temporaryRoot,
    "rev-parse",
    "HEAD",
  ]).trim();
  const actualTree = run("git", [
    "-C",
    temporaryRoot,
    "rev-parse",
    "HEAD^{tree}",
  ]).trim();
  if (actualCommit !== COMMIT || actualTree !== TREE) {
    throw new Error(
      `Pinned Detours identity mismatch: commit=${actualCommit}, tree=${actualTree}`
    );
  }

  fs.mkdirSync(path.join(vendorRoot, "src"), { recursive: true });
  const manifest = [];
  for (const relativePath of FILES) {
    const sourcePath = path.join(temporaryRoot, relativePath);
    const destinationPath = path.join(vendorRoot, relativePath);
    const normalized = normalizeLf(fs.readFileSync(sourcePath));
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, normalized);
    manifest.push(
      `${sha256(normalized)}  ${relativePath.replaceAll("\\", "/")}`
    );
  }

  fs.writeFileSync(
    path.join(vendorRoot, "SOURCE_MANIFEST.sha256"),
    `${manifest.join("\n")}\n`,
    "utf8"
  );
  process.stdout.write(
    `Prepared Microsoft Detours ${COMMIT} (${TREE}) with ${FILES.length} verified files.\n`
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
