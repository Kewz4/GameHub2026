import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSupportedLanguages } from "./supported-languages";

describe("supported language parsing", () => {
  it("parses captions and Steam's full-audio marker", () => {
    assert.deepEqual(
      parseSupportedLanguages(
        "English<strong>*</strong>, French, Japanese<strong>*</strong><br />* full audio"
      ),
      [
        { language: "English", hasAudio: true },
        { language: "French", hasAudio: false },
        { language: "Japanese", hasAudio: true },
      ]
    );
  });

  it("accepts alternate break markup and removes empty entries", () => {
    assert.deepEqual(parseSupportedLanguages(" Spanish, , German<br>note"), [
      { language: "Spanish", hasAudio: false },
      { language: "German", hasAudio: false },
    ]);
  });

  it("returns an empty list when the store provides no languages", () => {
    assert.deepEqual(parseSupportedLanguages(null), []);
    assert.deepEqual(parseSupportedLanguages("  "), []);
  });
});
