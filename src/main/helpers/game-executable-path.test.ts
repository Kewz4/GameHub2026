import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectGameExecutablePath } from "./game-executable-path";

const existing = (...paths: string[]) => {
  const values = new Set(paths);
  return (value: string | null | undefined): value is string =>
    Boolean(value && values.has(value));
};

describe("game executable path selection", () => {
  it("uses the moved local executable when nativeExecutablePath is stale", () => {
    const current = String.raw`C:\Games\Miles Morales\MilesMorales.exe`;
    assert.equal(
      selectGameExecutablePath(
        {
          executablePath: current,
          nativeExecutablePath: String.raw`C:\Old Extraction\MilesMorales.exe`,
        },
        existing(current)
      ),
      current
    );
  });

  it("uses the current local executable when the obsolete extraction also exists", () => {
    const current = String.raw`C:\Games\Miles Morales\MilesMorales.exe`;
    const obsolete = String.raw`C:\Old Extraction\MilesMorales.exe`;
    assert.equal(
      selectGameExecutablePath(
        {
          executablePath: current,
          nativeExecutablePath: obsolete,
        },
        existing(current, obsolete)
      ),
      current
    );
  });

  it("uses an existing native process target for a platform URI", () => {
    const native = String.raw`C:\Steam\Game.exe`;
    assert.equal(
      selectGameExecutablePath(
        {
          executablePath: "steam://rungameid/123",
          nativeExecutablePath: native,
        },
        existing(native)
      ),
      native
    );
  });

  it("falls back to the platform URI when its native target vanished", () => {
    assert.equal(
      selectGameExecutablePath(
        {
          executablePath: "steam://rungameid/123",
          nativeExecutablePath: String.raw`C:\Missing\Game.exe`,
        },
        existing()
      ),
      "steam://rungameid/123"
    );
  });

  it("keeps the launch path as the diagnostic fallback", () => {
    const launchPath = String.raw`C:\Missing New\Game.exe`;
    assert.equal(
      selectGameExecutablePath(
        {
          executablePath: launchPath,
          nativeExecutablePath: String.raw`C:\Missing Old\Game.exe`,
        },
        existing()
      ),
      launchPath
    );
  });

  it("gives Steam-emulator setup the moved executable instead of a stale native path", () => {
    const current = String.raw`C:\Games\Spider-Man 2\Spider-Man2.exe`;
    const stale = String.raw`C:\Old Repack\Spider-Man2.exe`;
    const selected = selectGameExecutablePath(
      { executablePath: current, nativeExecutablePath: stale },
      existing(current, stale)
    );

    assert.equal(selected, current);
    assert.equal(
      selected && String.raw`${selected}`.replace(/[\\/][^\\/]+$/, ""),
      String.raw`C:\Games\Spider-Man 2`
    );
  });
});
