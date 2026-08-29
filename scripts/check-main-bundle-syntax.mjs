import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const outputDirectory = path.resolve("out", "main");
const bundles = fs
  .readdirSync(outputDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => path.join(outputDirectory, entry.name))
  .sort();

if (bundles.length === 0) {
  throw new Error(`No main-process bundles were found in ${outputDirectory}`);
}

for (const bundle of bundles) {
  const check = spawnSync(process.execPath, ["--check", bundle], {
    encoding: "utf8",
  });
  if (check.status !== 0) {
    process.stderr.write(check.stderr || check.stdout);
    throw new Error(`Main-process bundle is not valid JavaScript: ${bundle}`);
  }
}

process.stdout.write(`Validated ${bundles.length} main-process bundles.\n`);
