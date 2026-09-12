import assert from "node:assert/strict";
import { test } from "node:test";
import { getLauncherIntent, parseLauncherLink } from "./launcher-intent";

test("Big Picture links work with either a fresh or running process argv", () => {
  for (const args of [
    ["GameHub.exe", "hydralauncher://bigpicture"],
    ["electron.exe", "out/main/index.js", "hydralauncher://bigpicture/"],
    ["GameHub.exe", "--big-picture"],
  ]) {
    assert.equal(getLauncherIntent(args).bigPicture, true);
    assert.equal(getLauncherIntent(args).runGame, false);
  }
});

test("game launch links retain background-launch behavior", () => {
  const intent = getLauncherIntent([
    "--big-picture",
    "hydralauncher://run?shop=steam&objectId=1145350",
  ]);
  assert.equal(intent.runGame, true);
  assert.equal(intent.bigPicture, false);
});

test("unrelated hosts and malformed links never activate Big Picture", () => {
  for (const value of [
    "hydralauncher://bigpicture-other",
    "https://bigpicture",
    "invalid",
    "hydralauncher://user@bigpicture",
    "hydralauncher://bigpicture:80",
  ])
    assert.equal(getLauncherIntent([value]).bigPicture, false);
  assert.equal(parseLauncherLink("https://example.com"), null);
  assert.equal(
    getLauncherIntent(["hydralauncher://profile?userId=1"]).runGame,
    false
  );
});
