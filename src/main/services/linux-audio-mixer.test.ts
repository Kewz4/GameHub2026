import assert from "node:assert/strict";
import { test } from "node:test";
import { LinuxAudioMixer, parsePactlSinkInputs } from "./linux-audio-mixer";

const sink = (index: number, pid = 42, volume = 32768, mute = false) => ({
  index,
  properties: {
    "application.process.id": String(pid),
    "application.name": "Game",
  },
  volume: { "front-left": { value: volume }, "front-right": { value: volume } },
  mute,
});

test("parses PulseAudio/PipeWire channels and rejects unsafe process/stream identifiers", () => {
  const parsed = parsePactlSinkInputs(
    JSON.stringify([sink(1), sink(-1), sink(2, 0), sink(3, 1), sink(4, 12.5)])
  );
  assert.deepEqual(parsed, [
    { index: 1, pid: 42, name: "Game", volume: 0.5, muted: false },
  ]);
  assert.equal(
    parsePactlSinkInputs(JSON.stringify([sink(1, 42, 131072)]))[0].volume,
    1
  );
  assert.throws(() => parsePactlSinkInputs("{}"));
});

test("coalesces concurrent reads and merges every stream from the same game", async () => {
  let calls = 0;
  const mixer = new LinuxAudioMixer(async () => {
    calls++;
    return JSON.stringify([sink(1), sink(2, 42, 65536, true)]);
  });
  const [a, b] = await Promise.all([mixer.getSessions(), mixer.getSessions()]);
  assert.deepEqual(a, b);
  assert.deepEqual(a, [{ pid: 42, name: "Game", volume: 1, muted: false }]);
  assert.equal(calls, 1);
  await mixer.getSessions();
  assert.equal(calls, 1);
});

test("writes current stream IDs only and controls every stream for the requested PID", async () => {
  let ids = [1];
  const commands: string[][] = [];
  const mixer = new LinuxAudioMixer(async (args) => {
    commands.push(args);
    return args[0] === "--format=json"
      ? JSON.stringify(ids.map((id) => sink(id)))
      : "";
  });
  await mixer.getSessions();
  ids = [7, 8];
  assert.equal(await mixer.setVolume(42, 0.75), true);
  assert.deepEqual(commands.slice(2), [
    ["set-sink-input-volume", "7", "75%"],
    ["set-sink-input-volume", "8", "75%"],
  ]);
  assert.equal(await mixer.setMute(42, true), true);
  assert.equal(await mixer.setMute(99, true), false);
});

test("unavailable pactl and failed writes return failure without stale sessions", async () => {
  const mixer = new LinuxAudioMixer(async () => {
    throw new Error("ENOENT");
  });
  assert.deepEqual(await mixer.getSessions(), []);
  assert.equal(await mixer.setVolume(42, 1), false);
  assert.equal(await mixer.setVolume(42, NaN), false);
  assert.equal(await mixer.setMute(0, true), false);
  const failingWrite = new LinuxAudioMixer(async (args) => {
    if (args[0] !== "--format=json") throw new Error("stream disappeared");
    return JSON.stringify([sink(1)]);
  });
  assert.equal(await failingWrite.setMute(42, true), false);
});
