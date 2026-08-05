import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  FragmentedMp4SegmentAssembler,
  concatenateBytes,
  splitFragmentedMp4Initialization,
} from "../../src/shared/fragmented-mp4.ts";
import { isGameWindowDisplaySized } from "../../src/main/services/game-recorder-capture-source.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

const makeBox = (type: string, payload = new Uint8Array(0)) => {
  const bytes = new Uint8Array(8 + payload.byteLength);
  new DataView(bytes.buffer).setUint32(0, bytes.byteLength);
  for (let index = 0; index < 4; index += 1) {
    bytes[4 + index] = type.charCodeAt(index);
  }
  bytes.set(payload, 8);
  return bytes;
};

test("waits for a complete moov and preserves first-event media", () => {
  const ftyp = makeBox("ftyp");
  const moov = makeBox("moov");
  const moof = makeBox("moof");
  const mdat = makeBox("mdat", new Uint8Array([1, 2, 3, 4]));

  assert.equal(splitFragmentedMp4Initialization(ftyp), null);
  const split = splitFragmentedMp4Initialization(
    concatenateBytes(ftyp, moov, moof, mdat)
  );
  assert.ok(split);
  assert.deepEqual(split.initialization, concatenateBytes(ftyp, moov));
  assert.deepEqual(split.media, concatenateBytes(moof, mdat));

  const assembler = new FragmentedMp4SegmentAssembler();
  assert.equal(assembler.push(ftyp), null);
  assert.deepEqual(
    assembler.push(concatenateBytes(moov, moof, mdat)),
    concatenateBytes(ftyp, moov, moof, mdat)
  );
  assert.deepEqual(
    assembler.push(concatenateBytes(moof, mdat)),
    concatenateBytes(ftyp, moov, moof, mdat)
  );
});

test("uses exact-window capture unless the client covers its display", () => {
  const display = {
    bounds: { x: 0, y: 0, width: 1_920, height: 1_080 },
    scaleFactor: 1,
  };
  assert.equal(
    isGameWindowDisplaySized(
      { x: 0, y: 0, width: 1_920, height: 1_080 },
      display
    ),
    true
  );
  assert.equal(
    isGameWindowDisplaySized(
      { x: 80, y: 60, width: 1_600, height: 900 },
      display
    ),
    false
  );
  assert.equal(
    isGameWindowDisplaySized(
      { x: 80, y: 60, width: 1_920, height: 1_080 },
      display
    ),
    false
  );
  // Native HWND geometry can be physical pixels while Electron reports DIP.
  assert.equal(
    isGameWindowDisplaySized(
      { x: 0, y: 0, width: 2_880, height: 1_620 },
      { ...display, scaleFactor: 1.5 }
    ),
    true
  );
});

const decodeWithBundledFfmpeg = (inputPath: string) => {
  const ffmpegPath = path.join(repositoryRoot, "ffmpeg", "ffmpeg.exe");
  assert.equal(fs.existsSync(ffmpegPath), true, "Bundled FFmpeg is missing");
  const decode = spawnSync(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 30_000 }
  );
  assert.equal(
    decode.status,
    0,
    decode.stderr || decode.stdout || `FFmpeg could not probe ${inputPath}`
  );
};

test(
  "Electron MP4 slices remain independently probeable and concatenate",
  { skip: process.platform !== "win32", timeout: 45_000 },
  () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "gamehub-recorder-test-")
    );
    try {
      const resultPath = path.join(temporaryDirectory, "chunks.json");
      const electronPath = path.join(
        repositoryRoot,
        "node_modules",
        "electron",
        "dist",
        "electron.exe"
      );
      const fixturePath = path.join(
        repositoryRoot,
        "scripts",
        "tests",
        "fixtures",
        "game-recorder-mp4-electron.cjs"
      );
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;
      const capture = spawnSync(electronPath, [fixturePath, resultPath], {
        cwd: repositoryRoot,
        env: environment,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
      });
      assert.equal(
        capture.status,
        0,
        capture.stderr || capture.stdout || "Electron fixture failed"
      );

      const result = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
        unsupported?: boolean;
        error?: string;
        chunks?: string[];
      };
      assert.equal(result.unsupported, undefined, "H.264 MP4 is unsupported");
      assert.equal(result.error, undefined, result.error);
      assert.ok(result.chunks && result.chunks.length >= 3);

      const assembler = new FragmentedMp4SegmentAssembler();
      const segments = result.chunks
        .map((chunk) =>
          assembler.push(new Uint8Array(Buffer.from(chunk, "base64")))
        )
        .filter((segment): segment is Uint8Array<ArrayBuffer> =>
          Boolean(segment)
        );
      assert.ok(
        segments.length >= 3,
        `Expected at least three media segments, received ${segments.length}`
      );

      const segmentPaths = segments.map((segment, index) => {
        const segmentPath = path.join(
          temporaryDirectory,
          `segment-${index}.mp4`
        );
        fs.writeFileSync(segmentPath, segment);
        decodeWithBundledFfmpeg(segmentPath);
        return segmentPath;
      });

      const concatPath = path.join(temporaryDirectory, "segments.ffconcat");
      fs.writeFileSync(
        concatPath,
        [
          "ffconcat version 1.0",
          ...segmentPaths.map(
            (segmentPath) => `file '${segmentPath.replaceAll("\\", "/")}'`
          ),
          "",
        ].join("\n"),
        "utf8"
      );
      const joinedPath = path.join(temporaryDirectory, "joined.mp4");
      const ffmpegPath = path.join(repositoryRoot, "ffmpeg", "ffmpeg.exe");
      const join = spawnSync(
        ffmpegPath,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          concatPath,
          "-map",
          "0:v:0",
          "-c:v",
          "copy",
          "-an",
          joinedPath,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 30_000 }
      );
      assert.equal(join.status, 0, join.stderr || join.stdout);
      decodeWithBundledFfmpeg(joinedPath);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
);
