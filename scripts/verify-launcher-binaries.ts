import { execFileSync } from "node:child_process";
import path from "node:path";
import { getLauncherInvocation } from "../src/main/services/launcher-invocation";

for (const helper of ["legendary", "gogdl"]) {
  const executable = path.resolve(
    "binaries",
    "bin",
    `${helper}${process.platform === "win32" ? ".exe" : ""}`
  );
  const invocation = getLauncherInvocation(executable, ["--version"]);
  execFileSync(invocation.command, invocation.args, {
    env: invocation.env,
    timeout: 15000,
    stdio: "inherit",
  });
}
