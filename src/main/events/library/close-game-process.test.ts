import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  requestGameProcessTermination,
  type GameProcessTerminationDependencies,
} from "./close-game-process";

const dependencies = (
  overrides: Partial<GameProcessTerminationDependencies> = {}
): GameProcessTerminationDependencies => ({
  platform: "win32" as NodeJS.Platform,
  taskkillExecutable: String.raw`C:\Windows\System32\taskkill.exe`,
  taskkillWorkingDirectory: String.raw`C:\Windows\System32`,
  kill: () => undefined,
  launchElevated: () => true,
  ...overrides,
});

describe("close game process", () => {
  it("uses the direct process handle without elevation when permitted", () => {
    let elevated = false;
    const result = requestGameProcessTermination(
      42,
      dependencies({ launchElevated: () => (elevated = true) })
    );

    assert.deepEqual(result, { requested: true, elevated: false });
    assert.equal(elevated, false);
  });

  it("requests taskkill through the native Windows runas path after access denial", () => {
    let invocation: string[] = [];
    const result = requestGameProcessTermination(
      73,
      dependencies({
        kill: () => {
          throw new Error("access denied");
        },
        launchElevated: (executable, parameters, workingDirectory) => {
          invocation = [executable, parameters, workingDirectory];
          return true;
        },
      })
    );

    assert.deepEqual(result, { requested: true, elevated: true });
    assert.deepEqual(invocation, [
      String.raw`C:\Windows\System32\taskkill.exe`,
      "/PID 73 /T /F",
      String.raw`C:\Windows\System32`,
    ]);
  });

  it("fails closed on invalid targets and non-Windows access denial", () => {
    assert.deepEqual(requestGameProcessTermination(4, dependencies()), {
      requested: false,
      elevated: false,
    });
    assert.deepEqual(
      requestGameProcessTermination(
        99,
        dependencies({
          platform: "linux",
          kill: () => {
            throw new Error("denied");
          },
        })
      ),
      { requested: false, elevated: false }
    );
  });
});
