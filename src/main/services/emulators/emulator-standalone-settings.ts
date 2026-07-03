import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import type { EmulatorBinary, EmulatorSystem } from "@types";
import { logger } from "../logger";
import { getEmulatorConfig } from "./emulators-repository";
import { KNOWN_BINARIES } from "./known-binaries";
import type { SettingDef, SettingValue } from "./setting-types";

/**
 * Settings for the STANDALONE emulators (PCSX2 / RPCS3 / Dolphin / Azahar /
 * Cemu). Unlike the RALibretro cores (one libretro-JSON per core), each of
 * these keeps its own native config file in its own format — INI, YAML or XML.
 * We read/write the specific keys we surface and preserve everything else.
 *
 * Config paths verified against each emulator's source (matching the
 * controller-config writers): PCSX2 → inis/PCSX2.ini, Dolphin →
 * User/Config/{GFX,Dolphin}.ini, Azahar → user/config/qt-config.ini, RPCS3 →
 * config.yml, Cemu → settings.xml. Portable-mode markers are written so the
 * emulator reads the in-folder config.
 */

// ── INI helpers (section + key, preserving the rest of the file) ─────────────

function getIniValue(ini: string, section: string, key: string): string | null {
  const lines = ini.split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[.+\]$/.test(trimmed)) {
      inSection = trimmed === `[${section}]`;
      continue;
    }
    if (!inSection) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() === key) return line.slice(eq + 1).trim();
  }
  return null;
}

function setIniValue(
  ini: string,
  section: string,
  key: string,
  value: string
): string {
  const lines = ini.split(/\r?\n/);
  const header = `[${section}]`;
  const secStart = lines.findIndex((l) => l.trim() === header);

  if (secStart === -1) {
    // Append a new section at the end.
    const block = ini.trimEnd();
    return `${block ? block + "\n\n" : ""}${header}\n${key} = ${value}\n`;
  }

  let secEnd = secStart + 1;
  while (secEnd < lines.length && !/^\[.+\]\s*$/.test(lines[secEnd])) secEnd++;

  for (let i = secStart + 1; i < secEnd; i++) {
    const eq = lines[i].indexOf("=");
    if (eq !== -1 && lines[i].slice(0, eq).trim() === key) {
      lines[i] = `${key} = ${value}`;
      return lines.join("\n");
    }
  }
  // Key not present in the section — insert it as the last line of the section.
  let insertAt = secEnd;
  while (insertAt > secStart + 1 && lines[insertAt - 1].trim() === "")
    insertAt--;
  lines.splice(insertAt, 0, `${key} = ${value}`);
  return lines.join("\n");
}

const readFile = (file: string): string =>
  fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";

const writeFileEnsuring = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

// ── Per-binary config descriptors ────────────────────────────────────────────

interface IniSpec {
  format: "ini";
  file: (installDir: string) => string;
  section: string;
  /** Extra keys written verbatim when this key changes (Citra `\default`). */
  companions?: (key: string) => Record<string, string>;
  /** Portable-mode marker files to ensure exist. */
  markers?: (installDir: string) => string[];
}
interface YamlSpec {
  format: "yaml";
  file: (installDir: string) => string;
  /** Nested path to a setting, e.g. ["Video", "Resolution Scale"]. */
  pathOf: (key: string) => string[];
}
interface XmlSpec {
  format: "xml";
  file: (installDir: string) => string;
  parent: string;
}

type ConfigSpec = IniSpec | YamlSpec | XmlSpec;

// Settings whose config file differs from the emulator's primary one (Dolphin
// keeps the backend in Dolphin.ini, everything else in GFX.ini). Maps a setting
// key to the spec that owns it; falls back to the binary's default spec.
const CONFIG: Partial<Record<EmulatorBinary, ConfigSpec>> = {
  pcsx2: {
    format: "ini",
    file: (d) => path.join(d, "inis", "PCSX2.ini"),
    section: "EmuCore/GS",
    markers: (d) => [path.join(d, "portable.ini")],
  },
  azahar: {
    format: "ini",
    file: (d) => path.join(d, "user", "config", "qt-config.ini"),
    section: "Renderer",
    // Citra/Azahar only honour a value when its `\default` twin is false.
    companions: (key) => ({ [`${key}\\default`]: "false" }),
  },
  dolphin: {
    format: "ini",
    file: (d) => path.join(d, "User", "Config", "GFX.ini"),
    section: "Settings",
    markers: (d) => [path.join(d, "portable.txt")],
  },
  rpcs3: {
    format: "yaml",
    file: (d) => path.join(d, "config.yml"),
    pathOf: (key) => key.split("/"),
  },
  cemu: {
    format: "xml",
    file: (d) => path.join(d, "settings.xml"),
    parent: "Graphic",
  },
};

// Dolphin's video backend lives in Dolphin.ini [Core], not GFX.ini.
const DOLPHIN_CORE_KEYS = new Set(["GFXBackend"]);
const dolphinCoreSpec = (installDir: string): IniSpec => ({
  format: "ini",
  file: () => path.join(installDir, "User", "Config", "Dolphin.ini"),
  section: "Core",
  markers: (d) => [path.join(d, "portable.txt")],
});

function specFor(binary: EmulatorBinary, key: string): ConfigSpec | null {
  if (binary === "dolphin" && DOLPHIN_CORE_KEYS.has(key)) {
    return dolphinCoreSpec("");
  }
  return CONFIG[binary] ?? null;
}

// ── XML helpers (targeted <tag> replacement inside a parent element) ──────────

function getXmlValue(xml: string, parent: string, tag: string): string | null {
  const parentMatch = new RegExp(
    `<${parent}>([\\s\\S]*?)</${parent}>`,
    "i"
  ).exec(xml);
  const scope = parentMatch ? parentMatch[1] : xml;
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i").exec(scope);
  return m ? m[1].trim() : null;
}

function setXmlValue(
  xml: string,
  parent: string,
  tag: string,
  value: string
): string {
  const tagRe = new RegExp(`(<${tag}>)([\\s\\S]*?)(</${tag}>)`, "i");
  const parentRe = new RegExp(`(<${parent}>)([\\s\\S]*?)(</${parent}>)`, "i");

  if (parentRe.test(xml)) {
    return xml.replace(parentRe, (_full, open, body, close) => {
      const newBody = tagRe.test(body)
        ? body.replace(tagRe, `$1${value}$3`)
        : `${body.replace(/\s*$/, "")}\n    <${tag}>${value}</${tag}>\n  `;
      return `${open}${newBody}${close}`;
    });
  }
  // No parent element yet — create a minimal one.
  const block = `  <${parent}>\n    <${tag}>${value}</${tag}>\n  </${parent}>`;
  if (/<content>[\s\S]*<\/content>/i.test(xml)) {
    return xml.replace(/<\/content>/i, `${block}\n</content>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<content>\n${block}\n</content>\n`;
}

// ── YAML helpers (nested get/set preserving the rest) ─────────────────────────

function getYamlValue(file: string, keyPath: string[]): string | null {
  const raw = readFile(file);
  if (!raw) return null;
  try {
    const doc = YAML.parse(raw);
    let node = doc;
    for (const seg of keyPath) {
      if (node == null || typeof node !== "object") return null;
      node = node[seg];
    }
    return node == null ? null : String(node);
  } catch {
    return null;
  }
}

function setYamlValue(file: string, keyPath: string[], value: string): void {
  const raw = readFile(file);
  let doc: Record<string, unknown> = {};
  if (raw) {
    try {
      doc = YAML.parse(raw) ?? {};
    } catch {
      doc = {};
    }
  }
  let node = doc as Record<string, unknown>;
  for (let i = 0; i < keyPath.length - 1; i++) {
    const seg = keyPath[i];
    if (typeof node[seg] !== "object" || node[seg] == null) node[seg] = {};
    node = node[seg] as Record<string, unknown>;
  }
  // Preserve numeric type for percent/int-like values RPCS3 expects.
  const last = keyPath[keyPath.length - 1];
  node[last] = /^-?\d+$/.test(value) ? Number(value) : value;
  writeFileEnsuring(file, YAML.stringify(doc));
}

// ── Public read / write ──────────────────────────────────────────────────────

/** True when this system is a standalone emulator we manage settings for. */
export function isStandaloneSettingsSystem(system: EmulatorSystem): boolean {
  const binary = KNOWN_BINARIES[system]?.binary;
  return Boolean(binary && binary in CONFIG);
}

export async function readStandaloneSettings(
  system: EmulatorSystem,
  defs: SettingDef[]
): Promise<SettingValue[]> {
  const binary = KNOWN_BINARIES[system]?.binary;
  if (!binary) return [];
  const config = await getEmulatorConfig(system);
  const installDir = config.executablePath
    ? path.dirname(config.executablePath)
    : null;

  return defs.map((def) => {
    const fallback = def.options?.[0]?.value ?? "";
    if (!installDir) return { key: def.key, value: fallback };
    try {
      const spec = specFor(binary, def.key);
      if (!spec) return { key: def.key, value: fallback };
      if (spec.format === "ini") {
        const val = getIniValue(
          readFile(spec.file(installDir)),
          spec.section,
          def.key
        );
        return { key: def.key, value: val ?? fallback };
      }
      if (spec.format === "yaml") {
        const val = getYamlValue(spec.file(installDir), spec.pathOf(def.key));
        return { key: def.key, value: val ?? fallback };
      }
      // xml
      const val = getXmlValue(
        readFile(spec.file(installDir)),
        spec.parent,
        def.key
      );
      return { key: def.key, value: val ?? fallback };
    } catch (err) {
      logger.warn(`[emulator-settings] read failed for ${def.key}`, err);
      return { key: def.key, value: fallback };
    }
  });
}

export async function writeStandaloneSettings(
  system: EmulatorSystem,
  values: SettingValue[]
): Promise<boolean> {
  const binary = KNOWN_BINARIES[system]?.binary;
  if (!binary) return false;
  const config = await getEmulatorConfig(system);
  if (!config.executablePath) return false;
  const installDir = path.dirname(config.executablePath);

  try {
    for (const { key, value } of values) {
      const spec = specFor(binary, key);
      if (!spec) continue;

      if (spec.format === "ini") {
        for (const marker of spec.markers?.(installDir) ?? []) {
          if (!fs.existsSync(marker)) writeFileEnsuring(marker, "");
        }
        const file =
          binary === "dolphin" && DOLPHIN_CORE_KEYS.has(key)
            ? dolphinCoreSpec(installDir).file(installDir)
            : spec.file(installDir);
        let ini = readFile(file);
        ini = setIniValue(ini, spec.section, key, value);
        for (const [ck, cv] of Object.entries(spec.companions?.(key) ?? {})) {
          ini = setIniValue(ini, spec.section, ck, cv);
        }
        writeFileEnsuring(file, ini);
      } else if (spec.format === "yaml") {
        setYamlValue(spec.file(installDir), spec.pathOf(key), value);
      } else {
        const file = spec.file(installDir);
        const xml = setXmlValue(readFile(file), spec.parent, key, value);
        writeFileEnsuring(file, xml);
      }
    }
    return true;
  } catch (err) {
    logger.error(`[emulator-settings] standalone write failed`, err);
    return false;
  }
}
