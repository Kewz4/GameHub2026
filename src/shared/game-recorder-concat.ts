export type GameRecorderConcatSegment = {
  path: string;
  startedAt: number;
  endedAt: number;
};

const escapeConcatPath = (filePath: string) =>
  filePath.replaceAll("\\", "/").replaceAll("'", "'\\''");

/**
 * Build an FFconcat manifest using the recorder's wall-clock slice durations.
 *
 * Chromium's fragmented MP4 slices retain the continuous MediaRecorder
 * timeline. When FFmpeg opens each repeated init+fragment file independently,
 * its inferred duration can therefore include time elapsed before that slice.
 * Letting the concat demuxer use those inferred durations compounds the gaps
 * and can turn a 60-second replay into a several-minute file. Explicit
 * durations make the next slice begin at the boundary GameHub observed.
 */
export const buildGameRecorderConcatManifest = (
  segments: readonly GameRecorderConcatSegment[]
) => {
  const lines = ["ffconcat version 1.0"];

  for (const segment of segments) {
    const durationSeconds = Math.max(
      0.001,
      (segment.endedAt - segment.startedAt) / 1_000
    );
    lines.push(`file '${escapeConcatPath(segment.path)}'`);
    lines.push(`duration ${durationSeconds.toFixed(6)}`);
  }

  lines.push("");
  return lines.join("\n");
};
