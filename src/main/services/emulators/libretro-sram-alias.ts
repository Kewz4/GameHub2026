import path from "node:path";
import fs from "node:fs";
import { LIBRETRO_CORE_MAP } from "./libretro-core-map";

export interface LibretroSramAliasPlan {
  canonicalFilename: string;
  targetPath: string;
  filenames: string[];
  core: string;
}
export interface LibretroSramAliasPolicy {
  plan?: LibretroSramAliasPlan;
  unsupportedReason?: string;
  blockRestore?: boolean;
}

const EXTENSIONS: Record<string, readonly string[]> = {
  gb: [".gb"],
  gbc: [".gbc", ".cgb", ".sgb"],
  gba: [".gba", ".agb"],
  n64: [".z64", ".n64", ".v64", ".ndd"],
  nds: [".nds", ".srl"],
  dsi: [".nds", ".dsi", ".srl", ".ids"],
};

export const libretroSramTargetsOverlap = (
  left: string,
  right: string
): boolean => {
  const canonical = (target: string) => {
    try {
      return path.join(
        fs.realpathSync(path.dirname(target)),
        path.basename(target)
      );
    } catch {
      return path.resolve(target);
    }
  };
  return canonical(left) === canonical(right);
};

export const planLibretroSramAlias = (input: {
  platform: "windows" | "linux" | "mac";
  system: string;
  core: string;
  romPath: string | null;
  saveRoots: readonly string[];
  windowsSramLayout?: string;
}): LibretroSramAliasPolicy => {
  const mapping =
    LIBRETRO_CORE_MAP[input.system as keyof typeof LIBRETRO_CORE_MAP];
  if (!mapping?.rawSram || mapping.core !== input.core)
    return {
      unsupportedReason: `Raw SRAM interoperability is not verified for ${input.system} / ${input.core}. Use an explicitly supported per-title export; no format conversion was attempted.`,
    };
  const api = input.platform === "windows" ? path.win32 : path.posix;
  const filename = input.romPath ? api.basename(input.romPath) : "";
  const ext = api.extname(filename).toLowerCase();
  if (
    !filename ||
    /[<>:"/\\|?*]/.test(filename) ||
    [...filename].some((character) => character.charCodeAt(0) < 32) ||
    !EXTENSIONS[input.system]?.includes(ext)
  )
    return {
      blockRestore: true,
      unsupportedReason:
        "SRAM filename identity is unavailable for this ROM format. Select the exact unpacked ROM before syncing between frontends.",
    };
  if (input.saveRoots.length !== 1 || !api.isAbsolute(input.saveRoots[0]))
    return {
      blockRestore: true,
      unsupportedReason:
        "SRAM destination is ambiguous. Choose a single emulator save root before syncing between frontends.",
    };
  if (input.platform === "windows" && (input.windowsSramLayout ?? "S") !== "S")
    return {
      blockRestore: true,
      unsupportedReason:
        "Cross-frontend SRAM restore is not enabled for this custom RALibretro save layout. Use its standard Saves layout or an exact approved mapping.",
    };
  const stem = filename.slice(0, -ext.length);
  const canonicalFilename = `${filename}.sram`;
  return {
    plan: {
      canonicalFilename,
      targetPath: api.join(
        input.saveRoots[0],
        input.platform === "linux" ? `${stem}.srm` : canonicalFilename
      ),
      filenames: [canonicalFilename, `${stem}.sram`, `${stem}.srm`],
      core: input.core,
    },
  };
};
