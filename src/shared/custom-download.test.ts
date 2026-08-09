import assert from "node:assert/strict";
import test from "node:test";
const customDownloadModulePath = "./custom-download.ts";
const {
  CUSTOM_DOWNLOAD_ENTRY_OPTIONS,
  classifyCustomDownloadSource,
  getCustomDownloadInputPresentation,
  isCustomDownloadFormReady,
  isDirectExecutableUrl,
  normalizeCustomDownloadTitle,
  shouldExtractCustomDownload,
  suggestCustomDownloadTitle,
} = await import(customDownloadModulePath);

test("exposes every custom-download entry path to both download managers", () => {
  assert.deepEqual(
    CUSTOM_DOWNLOAD_ENTRY_OPTIONS.map((option) => option.intent),
    ["link", "magnet", "torrent"]
  );
  assert.match(
    getCustomDownloadInputPresentation("link").placeholder,
    /^https:/
  );
  assert.match(
    getCustomDownloadInputPresentation("magnet").placeholder,
    /^magnet:/
  );
  assert.match(
    getCustomDownloadInputPresentation("torrent").label,
    /^\.torrent/
  );
});

test("classifies magnets and validates their hash", () => {
  assert.equal(
    classifyCustomDownloadSource(
      "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Example"
    ).type,
    "magnet"
  );
  assert.throws(
    () => classifyCustomDownloadSource("magnet:?dn=No+hash"),
    /torrent hash/
  );
  assert.throws(
    () => classifyCustomDownloadSource("magnet:?xt=urn:btih:not-a-hash"),
    /valid torrent hash/
  );
  assert.equal(
    classifyCustomDownloadSource(
      `magnet:?xt=urn:btmh:1220${"a".repeat(64)}&dn=Version+2`
    ).type,
    "magnet"
  );
});

test("accepts direct links and recognizes remote torrent files", () => {
  const result = classifyCustomDownloadSource(
    "https://downloads.example/game.torrent?token=abc"
  );
  assert.equal(result.type, "link");
  assert.equal(result.remoteTorrentFile, true);
  assert.equal(
    classifyCustomDownloadSource(
      "https://downloads.example/get?file=Game.torrent&token=abc"
    ).remoteTorrentFile,
    true
  );
  assert.equal(
    classifyCustomDownloadSource(
      "https://objects.example/get?response-content-disposition=attachment%3B%20filename%3D%22Game.torrent%22"
    ).remoteTorrentFile,
    true
  );
  assert.equal(
    isDirectExecutableUrl("https://downloads.example/Game.exe?token=abc"),
    true
  );
  assert.equal(
    isDirectExecutableUrl("https://downloads.example/Game.zip?token=abc"),
    false
  );
  assert.equal(
    classifyCustomDownloadSource(
      "https://downloads.example/Game.zip?token=abc#browser-only-secret"
    ).value,
    "https://downloads.example/Game.zip?token=abc"
  );
});

test("rejects unsupported or credential-bearing links", () => {
  assert.throws(() => classifyCustomDownloadSource("ftp://example/game.zip"));
  assert.throws(() =>
    classifyCustomDownloadSource("https://user:secret@example/game.zip")
  );
  assert.throws(() =>
    classifyCustomDownloadSource(`https://example.com/${"a".repeat(17_000)}`)
  );
  assert.throws(() =>
    classifyCustomDownloadSource("https://example.com/game.zip\nInjected")
  );
});

test("normalizes and suggests library titles", () => {
  assert.equal(normalizeCustomDownloadTitle("  Hades   II  "), "Hades II");
  assert.equal(
    suggestCustomDownloadTitle(
      "magnet:?xt=urn:btih:0123456789abcdef&dn=Death+Must+Die"
    ),
    "Death Must Die"
  );
  assert.equal(
    suggestCustomDownloadTitle("", "Prince_of_Persia.part01.rar.torrent"),
    "Prince of Persia"
  );
});

test("only extracts recognized archives after the final filename is known", () => {
  assert.equal(shouldExtractCustomDownload("Portable Game.zip", true), true);
  assert.equal(shouldExtractCustomDownload("Portable Game.exe", true), false);
  assert.equal(shouldExtractCustomDownload("setup.msi", true), false);
  assert.equal(shouldExtractCustomDownload("Portable Game.7z", false), false);
});

test("enables custom-download submission only for a complete valid form", () => {
  const ready = {
    hasTorBoxToken: true,
    source: "https://downloads.example/Hades-II.zip",
    localTorrentPath: null,
    title: "Hades II",
    downloadPath: "C:\\Games",
  };

  assert.equal(isCustomDownloadFormReady(ready), true);
  assert.equal(isCustomDownloadFormReady({ ...ready, source: "" }), false);
  assert.equal(isCustomDownloadFormReady({ ...ready, title: "" }), false);
  assert.equal(
    isCustomDownloadFormReady({ ...ready, downloadPath: "" }),
    false
  );
  assert.equal(
    isCustomDownloadFormReady({ ...ready, hasTorBoxToken: false }),
    false
  );
  assert.equal(
    isCustomDownloadFormReady({
      ...ready,
      source: "",
      localTorrentPath: "C:\\Torrents\\Hades-II.torrent",
    }),
    true
  );
});
