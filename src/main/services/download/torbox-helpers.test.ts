import assert from "node:assert/strict";
import test from "node:test";

const modulePath = "./torbox-helpers.ts";
const {
  findMatchingTorBoxWebDownload,
  isTorBoxItemReady,
  isLegacyTorBoxGeneratedZip,
  normalizeTorBoxProgress,
  redactTorBoxSensitiveText,
  selectTorBoxDownloadFile,
} = await import(modulePath);

test("uses materialized TorBox flags instead of progress or completed state", () => {
  assert.equal(isTorBoxItemReady({ download_finished: true }), true);
  assert.equal(isTorBoxItemReady({ cached: true }), true);
  assert.equal(isTorBoxItemReady({ download_state: "uploading" }), true);
  assert.equal(
    isTorBoxItemReady({ download_state: "completed", download_present: true }),
    false
  );
  assert.equal(
    isTorBoxItemReady({ cached: true, download_present: false }),
    false
  );
});

test("normalizes fractional and percentage progress for the UI", () => {
  assert.equal(normalizeTorBoxProgress(0.45), 0.45);
  assert.equal(normalizeTorBoxProgress(45), 0.45);
  assert.equal(normalizeTorBoxProgress(500), 1);
  assert.equal(normalizeTorBoxProgress(Number.NaN), 0);
});

test("finds an existing web job by original URL or TorBox's documented MD5", () => {
  const source = "https://downloads.example.org/game.zip?signature=secret";
  assert.equal(
    findMatchingTorBoxWebDownload(
      [{ id: 7, original_url: source, name: "Game.zip" }],
      source
    )?.id,
    7
  );
  assert.equal(
    findMatchingTorBoxWebDownload(
      [
        {
          id: 9,
          hash: "0be937046c8b28993124509b3ab839bd",
          name: "Game.zip",
        },
      ],
      source
    )?.id,
    9
  );
});

test("redacts API tokens and signed URL queries from log-safe messages", () => {
  const token = "torbox-super-secret";
  const safe = redactTorBoxSensitiveText(
    `Bearer ${token} failed at https://api.torbox.app/requestdl?token=${token}&id=1`,
    [token]
  );
  assert.equal(safe.includes(token), false);
  assert.equal(safe.includes("?token="), false);
  assert.match(safe, /\[redacted\]/);
});

test("selects a raw single web file so TorBox downloads remain resumable", () => {
  const file = {
    id: 0,
    name: "folder/game.rar",
    short_name: "game.rar",
  };

  assert.equal(selectTorBoxDownloadFile([file], null, undefined), file);
  assert.equal(isLegacyTorBoxGeneratedZip(undefined, file), false);
  assert.equal(isLegacyTorBoxGeneratedZip("game.rar", file), false);
});

test("recognizes a pre-1.1.39 generated ZIP partial without misclassifying raw ZIPs", () => {
  const rar = {
    id: 0,
    name: "cFUQPs/Marvels-Spider-Man-R-SteamRIP.com.rar",
    short_name: "Marvels-Spider-Man-R-SteamRIP.com.rar",
  };
  const zip = {
    id: 4,
    name: "archives/game.zip",
    short_name: "game.zip",
  };

  assert.equal(isLegacyTorBoxGeneratedZip("cFUQPs.zip", rar), true);
  assert.equal(isLegacyTorBoxGeneratedZip("game.zip", zip), false);
});
