import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);

function compactSource(relativePath: string) {
  return readFileSync(path.join(repositoryRoot, relativePath), "utf8").replace(
    /\s+/g,
    " "
  );
}

describe("embedded Big Picture route parity", () => {
  it("registers every social route exposed by the Big Picture sidebar", () => {
    const source = compactSource("src/renderer/src/main.tsx");

    assert.ok(
      source.includes(
        '<Route path="profile" element={<BigPictureProfile />} />'
      )
    );
    assert.ok(
      source.includes(
        '<Route path="profile/:userId" element={<BigPictureProfile />} />'
      )
    );
    assert.ok(
      source.includes(
        '<Route path="friends" element={<BigPictureFriends />} />'
      )
    );
  });
});
