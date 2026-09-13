import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type LinuxAudioSession = {
  pid: number;
  name: string;
  volume: number;
  muted: boolean;
};

type SinkInput = LinuxAudioSession & { index: number };
type PactlRunner = (args: string[]) => Promise<string>;

const finiteNumber = (value: unknown): number | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/** PulseAudio and PipeWire's Pulse server expose the same pactl JSON schema. */
export const parsePactlSinkInputs = (json: string): SinkInput[] => {
  const inputs: unknown = JSON.parse(json);
  if (!Array.isArray(inputs)) throw new Error("Invalid pactl sink-input list");
  return inputs.slice(0, 1024).flatMap((input) => {
    if (!input || typeof input !== "object") return [];
    const index = finiteNumber(input.index);
    const properties = input.properties;
    const pid = finiteNumber(properties?.["application.process.id"]);
    if (
      index === null ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      pid === null ||
      !Number.isSafeInteger(pid) ||
      pid <= 1
    )
      return [];
    const channels =
      input.volume && typeof input.volume === "object"
        ? Object.values(input.volume)
        : [];
    const volumes = channels.flatMap((channel) => {
      if (!channel || typeof channel !== "object") return [];
      const raw = finiteNumber((channel as { value?: unknown }).value);
      return raw === null || raw < 0 ? [] : [Math.min(1, raw / 65536)];
    });
    if (!volumes.length || typeof input.mute !== "boolean") return [];
    const name =
      properties?.["application.name"] ||
      properties?.["application.process.binary"];
    return [
      {
        index,
        pid,
        name:
          typeof name === "string" && name.trim()
            ? name.slice(0, 256)
            : `Process ${pid}`,
        volume: volumes.reduce((sum, value) => sum + value, 0) / volumes.length,
        muted: input.mute,
      },
    ];
  });
};

const runPactl: PactlRunner = async (args) => {
  const { stdout } = await execFileAsync("pactl", args, {
    timeout: 2_000,
    maxBuffer: 2 * 1024 * 1024,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
};

/** Asynchronous, coalesced IPC adapter: never spawn a shell or block Electron. */
export class LinuxAudioMixer {
  private inputs: SinkInput[] = [];
  private expiresAt = 0;
  private pending: Promise<SinkInput[]> | null = null;

  constructor(private readonly run: PactlRunner = runPactl) {}

  private refresh(force = false): Promise<SinkInput[]> {
    if (this.pending) return this.pending;
    if (!force && Date.now() < this.expiresAt)
      return Promise.resolve(this.inputs);
    this.pending = this.run(["--format=json", "list", "sink-inputs"])
      .then((json) => {
        this.inputs = parsePactlSinkInputs(json);
        this.expiresAt = Date.now() + 1_000;
        return this.inputs;
      })
      .catch(() => {
        // Do not retain stale process/stream identifiers if the audio server
        // restarted, is inaccessible, or pactl is not installed.
        this.inputs = [];
        this.expiresAt = Date.now() + 5_000;
        return this.inputs;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  async getSessions(): Promise<LinuxAudioSession[]> {
    const sessions = new Map<number, LinuxAudioSession>();
    for (const input of await this.refresh()) {
      const existing = sessions.get(input.pid);
      sessions.set(input.pid, {
        pid: input.pid,
        name: input.name,
        volume: Math.max(existing?.volume ?? 0, input.volume),
        muted: input.muted && (existing?.muted ?? true),
      });
    }
    return [...sessions.values()];
  }

  /** Resolve an actual output monitor; never the default microphone/source. */
  async getMonitorSource(): Promise<string | null> {
    try {
      const [defaultSink, sinks, sources] = await Promise.all([
        this.run(["get-default-sink"]),
        this.run(["--format=json", "list", "sinks"]),
        this.run(["--format=json", "list", "sources"]),
      ]);
      return selectPulseMonitorSource(
        defaultSink.trim(),
        JSON.parse(sinks),
        JSON.parse(sources)
      );
    } catch {
      return null;
    }
  }

  private async write(pid: number, command: string, value: string) {
    if (!Number.isSafeInteger(pid) || pid <= 1) return false;
    // Resolve the current server stream IDs on every write. A cached ID can
    // belong to a different process after a stream exits or server restarts.
    const targets = (await this.refresh(true)).filter(
      (input) => input.pid === pid
    );
    if (!targets.length) return false;
    const results = await Promise.all(
      targets.map(async (input) => {
        try {
          await this.run([command, String(input.index), value]);
          return true;
        } catch {
          return false;
        }
      })
    );
    this.expiresAt = 0;
    return results.every(Boolean);
  }

  setVolume(pid: number, volume: number) {
    if (!Number.isFinite(volume)) return Promise.resolve(false);
    return this.write(
      pid,
      "set-sink-input-volume",
      `${Math.round(Math.max(0, Math.min(1, volume)) * 100)}%`
    );
  }

  setMute(pid: number, muted: boolean) {
    return this.write(pid, "set-sink-input-mute", muted ? "1" : "0");
  }
}

export const linuxAudioMixer = new LinuxAudioMixer();

export const selectPulseMonitorSource = (
  sinkName: string,
  sinks: unknown,
  sources: unknown
): string | null => {
  if (!sinkName || !Array.isArray(sinks) || !Array.isArray(sources))
    return null;
  const sink = sinks.find(
    (candidate) =>
      candidate?.name === sinkName &&
      Number.isSafeInteger(candidate?.index) &&
      candidate.index >= 0
  );
  if (!sink) return null;
  const source = sources.find(
    (candidate) =>
      candidate &&
      finiteNumber(candidate.monitor_of_sink) === sink.index &&
      typeof candidate.name === "string" &&
      candidate.name.length <= 512 &&
      candidate.name !== "default" &&
      !/[\u0000-\u001f\u007f]/.test(candidate.name)
  );
  return source?.name ?? null;
};
