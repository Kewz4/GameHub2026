import assert from "node:assert/strict";
import { test } from "node:test";
import { selectGameRequirements } from "./game-requirements";

const windows = {
  minimum: "Windows 10 / 8 GB",
  recommended: "Windows 11 / 16 GB",
};
const linux = { minimum: "Ubuntu / 8 GB", recommended: "Ubuntu / 16 GB" };

test("Linux prefers native requirements in both renderer surfaces", () => {
  assert.deepEqual(
    selectGameRequirements(
      { pc_requirements: windows, linux_requirements: linux },
      "linux"
    ),
    {
      requirements: linux,
      source: "linux",
    }
  );
});

test("an empty Linux Steam requirement block falls back explicitly to Windows", () => {
  assert.deepEqual(
    selectGameRequirements(
      {
        pc_requirements: windows,
        linux_requirements: { minimum: "<ul> &nbsp; </ul>" },
      },
      "linux"
    ),
    {
      requirements: windows,
      source: "windows",
    }
  );
});

test("Linux recommended-only metadata never mixes in Windows minimum requirements", () => {
  assert.deepEqual(
    selectGameRequirements(
      {
        pc_requirements: windows,
        linux_requirements: { recommended: linux.recommended },
      },
      "linux"
    ),
    {
      requirements: { minimum: "", recommended: linux.recommended },
      source: "linux",
    }
  );
});

test("Windows retains its requirements and missing metadata stays empty", () => {
  assert.deepEqual(
    selectGameRequirements(
      { pc_requirements: windows, linux_requirements: linux },
      "win32"
    ).requirements,
    windows
  );
  assert.deepEqual(selectGameRequirements(null, "linux").requirements, {
    minimum: "",
    recommended: "",
  });
});
