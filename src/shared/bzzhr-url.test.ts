import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractBzzhrTokenPath,
  isBzzhrDirectUri,
  isBzzhrUri,
  parseBzzhrUri,
  validateBzzhrDirectRedirect,
} from "./bzzhr-url";

describe("Bzzhr URL policy", () => {
  it("recognizes exact HTTPS page and direct hosts", () => {
    assert.deepEqual(parseBzzhrUri("https://bzzhr.to/abc123")?.kind, "page");
    assert.equal(
      isBzzhrDirectUri("https://ts.bzzhr.to/d/abc123/file.7z"),
      true
    );
    assert.equal(
      isBzzhrDirectUri("https://ts.bzzhr.io/d/abc123/file.7z"),
      true
    );
  });

  it("rejects lookalike, credentialed, insecure, and malformed URLs", () => {
    for (const uri of [
      "http://bzzhr.to/abc123",
      "https://bzzhr.to.evil.test/abc123",
      "https://user:pass@bzzhr.to/abc123",
      "https://bzzhr.to/abc123/extra",
      "https://ts.bzzhr.to/not-d/abc123/file.7z",
      "not a URL",
    ]) {
      assert.equal(isBzzhrUri(uri), false, uri);
    }
  });

  it("extracts an escaped token only for the expected file id", () => {
    const html = String.raw`<button onclick="copyDownloadLink('\/abc123\/download?t=secret-token')">Copy</button>`;
    assert.equal(
      extractBzzhrTokenPath(html, "abc123"),
      "/abc123/download?t=secret-token"
    );
    assert.throws(
      () => extractBzzhrTokenPath(html, "another-id"),
      /bzzhr_download_token_invalid/
    );
  });

  it("binds a direct redirect to the originating file id", () => {
    assert.equal(
      validateBzzhrDirectRedirect(
        "https://ts.bzzhr.io/d/abc123/archive.7z?token=private",
        "abc123"
      ),
      "https://ts.bzzhr.io/d/abc123/archive.7z?token=private"
    );
    assert.throws(
      () =>
        validateBzzhrDirectRedirect(
          "https://ts.bzzhr.io/d/other/archive.7z",
          "abc123"
        ),
      /bzzhr_download_redirect_invalid/
    );
  });
});
