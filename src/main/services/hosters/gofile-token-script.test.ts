import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMarkupResponse,
  resolveGofileWebsiteTokenScriptUrl,
} from "./gofile-token-script";

describe("Gofile website-token script discovery", () => {
  it("accepts relative and Gofile subdomain HTTPS scripts", () => {
    assert.equal(
      resolveGofileWebsiteTokenScriptUrl(
        '<script defer src="/dist/js/wt.obf.js"></script>',
        "https://gofile.io/"
      ),
      "https://gofile.io/dist/js/wt.obf.js"
    );
    assert.equal(
      resolveGofileWebsiteTokenScriptUrl(
        '<script src="https://assets.gofile.io/wt.js"></script>',
        "https://gofile.io/"
      ),
      "https://assets.gofile.io/wt.js"
    );
  });

  it("rejects off-origin, insecure, malformed, and missing scripts", () => {
    assert.equal(
      resolveGofileWebsiteTokenScriptUrl(
        '<script src="https://gofile.io.evil.test/wt.js"></script>',
        "https://gofile.io/"
      ),
      null
    );
    assert.equal(
      resolveGofileWebsiteTokenScriptUrl(
        '<script src="http://gofile.io/wt.js"></script>',
        "https://gofile.io/"
      ),
      null
    );
    assert.equal(
      resolveGofileWebsiteTokenScriptUrl("<main>No script</main>", "bad-url"),
      null
    );
  });

  it("identifies HTML responses before they reach the VM evaluator", () => {
    assert.equal(
      isMarkupResponse("  <!doctype html><title>Not JS</title>"),
      true
    );
    assert.equal(isMarkupResponse("window.generateWT = () => 'ok';"), false);
  });
});
