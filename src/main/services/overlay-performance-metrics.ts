import type { HydraOverlayPerformance } from "@types";

export type PresentMonFrameTimeColumns = {
  displayChange: number;
  presents: number;
  frameTime: number;
  processId: number;
  application: number;
  swapChain: number;
  runtime: number;
  presentMode: number;
};

export const resolvePresentMonFrameTimeColumns = (header: string[]) => {
  const normalized = header.map((column) => column.trim().toLowerCase());
  const find = (...names: string[]) =>
    names.reduce(
      (found, name) => (found >= 0 ? found : normalized.indexOf(name)),
      -1
    );
  return {
    displayChange: find(
      "msbetweendisplaychange",
      "msbetweendisplays",
      "displayedtime"
    ),
    presents: find("msbetweenpresents"),
    frameTime: find("frametime", "msframetime", "cpuframetime"),
    processId: find("processid", "process_id"),
    application: find("application", "app"),
    swapChain: find("swapchainaddress", "swapchain"),
    runtime: find("runtime", "presentruntime"),
    presentMode: find("presentmode"),
  } satisfies PresentMonFrameTimeColumns;
};

export const isPresentMonFrameTimeHeader = (
  indexes: PresentMonFrameTimeColumns
) =>
  indexes.displayChange >= 0 || indexes.presents >= 0 || indexes.frameTime >= 0;

export const parseCsvRow = (line: string) => {
  const columns: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      columns.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  columns.push(value);
  return columns;
};

const columnValue = (columns: string[], index: number) =>
  index >= 0 ? columns[index]?.trim() || null : null;

export const parsePresentMonFrameTime = (
  columns: string[],
  indexes: PresentMonFrameTimeColumns
) => {
  for (const index of [
    indexes.displayChange,
    indexes.presents,
    indexes.frameTime,
  ]) {
    if (index < 0) continue;
    const value = Number(columns[index]);
    if (Number.isFinite(value) && value > 0 && value < 10_000) return value;
  }
  return null;
};

export type PresentMonSample = {
  frameTimeMs: number;
  processId: number | null;
  application: string | null;
  swapChain: string | null;
  runtime: string | null;
  presentMode: string | null;
};

export const parsePresentMonSample = (
  columns: string[],
  indexes: PresentMonFrameTimeColumns
): PresentMonSample | null => {
  const frameTimeMs = parsePresentMonFrameTime(columns, indexes);
  if (frameTimeMs === null) return null;

  const rawProcessId = columnValue(columns, indexes.processId);
  const processId = rawProcessId === null ? null : Number(rawProcessId);
  return {
    frameTimeMs,
    processId:
      processId !== null && Number.isInteger(processId) && processId > 0
        ? processId
        : null,
    application: columnValue(columns, indexes.application),
    swapChain: columnValue(columns, indexes.swapChain),
    runtime: columnValue(columns, indexes.runtime),
    presentMode: columnValue(columns, indexes.presentMode),
  };
};

export const parseMangoHudFrameTimes = (lines: string[]) =>
  lines.flatMap((line) => {
    const columns = parseCsvRow(line);
    const fps = Number(columns[0]);
    const frameTime = Number(columns[1]);
    return Number.isFinite(fps) &&
      Number.isFinite(frameTime) &&
      fps > 0 &&
      frameTime > 0
      ? [frameTime]
      : [];
  });

export const calculateOverlayPerformance = (
  samples: number[],
  updatedAt = Date.now()
): HydraOverlayPerformance | null => {
  if (!samples.length) return null;

  const recent = samples.slice(-30);
  const recentFrameTime =
    recent.reduce((sum, sample) => sum + sample, 0) / recent.length;
  const averageFrameTime =
    samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  const slowest = [...samples]
    .sort((left, right) => right - left)
    .slice(0, Math.max(1, Math.ceil(samples.length * 0.01)));
  const slowFrameTime =
    slowest.reduce((sum, sample) => sum + sample, 0) / slowest.length;

  return {
    fps: Math.min(500, Math.round(1000 / recentFrameTime)),
    averageFps: Math.min(500, Math.round(1000 / averageFrameTime)),
    onePercentLow: Math.min(500, Math.round(1000 / slowFrameTime)),
    frameTimeMs: Number(recentFrameTime.toFixed(1)),
    updatedAt,
  };
};
