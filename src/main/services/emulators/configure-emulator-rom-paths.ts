/**
 * Write ROM search directories to each emulator's own config file so its
 * native game list matches the folders the user configured in Hydra.
 *
 * Each emulator uses a different config format:
 *   DuckStation  → INI  ~/.local/share/duckstation/settings.ini  [GameList] SearchDirectory1..N
 *   PCSX2        → INI  ~/.local/share/PCSX2/inis/PCSX2.ini      [GameList] Paths / RecursivePaths
 *   Cemu         → XML  ~/.config/Cemu/settings.xml               <GamePaths><path>…</path></GamePaths>
 *   Dolphin      → INI  ~/.config/dolphin-emu/Dolphin.ini         [General] ISOPath0..N / ISOPaths=N
 *   PPSSPP       → INI  ~/.config/ppsspp/PSP/SYSTEM/ppsspp.ini   [General] BrowsePath (last added)
 *   Azahar(3DS)  → INI  ~/.config/azahar-emu/azahar/qt-config.ini Paths\gamedirs\…
 *
 * Failures are silently swallowed — the emulator's own game-list is a
 * convenience; Hydra always launches by passing the ROM path directly.
 */

import os from "node:os";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { EmulatorSystem } from "@types";
import {
  duckstationConfigCandidates,
  findExistingConfig,
  pcsx2ConfigCandidates,
} from "./emulator-config";
import { getEmulatorConfig } from "./emulators-repository";

// ── INI helpers ──────────────────────────────────────────────────────────────

function readIni(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function writeIni(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}

/**
 * Set or replace all keys matching `keyPrefix + digit` inside an INI section.
 * Existing numbered keys are removed first, then new ones are appended.
 */
function setNumberedIniKeys(
  ini: string,
  section: string,
  keyPrefix: string,
  values: string[],
  extraPerValue?: (index: number, value: string) => Record<string, string>
): string {
  const sectionHeader = `[${section}]`;
  const lines = ini.split("\n");

  // Remove existing numbered keys from the section
  let inSection = false;
  const filtered: string[] = [];
  for (const line of lines) {
    if (line.trim() === sectionHeader) {
      inSection = true;
      filtered.push(line);
      continue;
    }
    if (inSection && line.trim().startsWith("[")) inSection = false;
    if (
      inSection &&
      new RegExp(`^${keyPrefix}\\d+\\s*=`, "i").test(line.trim())
    )
      continue;
    filtered.push(line);
  }

  // Find section insertion point
  let sectionIdx = filtered.findIndex((l) => l.trim() === sectionHeader);
  if (sectionIdx === -1) {
    filtered.push("", sectionHeader);
    sectionIdx = filtered.length - 1;
  }

  // Append new keys after section header
  const insertAt = sectionIdx + 1;
  const newLines: string[] = [];
  values.forEach((val, i) => {
    const n = i + 1;
    newLines.push(`${keyPrefix}${n} = ${val}`);
    if (extraPerValue) {
      for (const [k, v] of Object.entries(extraPerValue(i, val))) {
        newLines.push(`${k}${n} = ${v}`);
      }
    }
  });
  filtered.splice(insertAt, 0, ...newLines);
  return filtered.join("\n");
}

/**
 * Set (or replace) a single INI key inside a section.
 */
function setIniKey(
  ini: string,
  section: string,
  key: string,
  value: string
): string {
  const sectionHeader = `[${section}]`;
  const lines = ini.split("\n");
  let inSection = false;
  let keyFound = false;

  const result: string[] = [];
  for (const line of lines) {
    if (line.trim() === sectionHeader) {
      inSection = true;
      result.push(line);
      continue;
    }
    if (inSection && line.trim().startsWith("[")) inSection = false;
    if (inSection && new RegExp(`^${key}\\s*=`, "i").test(line.trim())) {
      result.push(`${key} = ${value}`);
      keyFound = true;
      continue;
    }
    result.push(line);
  }

  if (!keyFound) {
    let sectionIdx = result.findIndex((l) => l.trim() === sectionHeader);
    if (sectionIdx === -1) {
      result.push("", sectionHeader);
      sectionIdx = result.length - 1;
    }
    result.splice(sectionIdx + 1, 0, `${key} = ${value}`);
  }
  return result.join("\n");
}

// ── Per-emulator writers ──────────────────────────────────────────────────────

function configureDuckstation(romFolders: string[]): void {
  const cfgPath =
    findExistingConfig(duckstationConfigCandidates()) ??
    duckstationConfigCandidates()[0];
  let ini = readIni(cfgPath);
  ini = setNumberedIniKeys(
    ini,
    "GameList",
    "SearchDirectory",
    romFolders,
    () => ({
      RecurseSearchDirectory: "true",
    })
  );
  writeIni(cfgPath, ini);
}

function configurePcsx2(romFolders: string[]): void {
  const cfgPath =
    findExistingConfig(pcsx2ConfigCandidates()) ?? pcsx2ConfigCandidates()[0];
  let ini = readIni(cfgPath);
  // PCSX2 uses a colon-separated list in RecursivePaths
  ini = setIniKey(ini, "GameList", "RecursivePaths", romFolders.join(":"));
  writeIni(cfgPath, ini);
}

function configureCemu(romFolders: string[]): void {
  // Cemu settings.xml may live next to the executable (portable) or in config dir
  const candidates: string[] = [
    path.join(os.homedir(), ".config", "Cemu", "settings.xml"),
    path.join(
      os.homedir(),
      ".var",
      "app",
      "info.cemu.Cemu",
      "config",
      "Cemu",
      "settings.xml"
    ),
  ];
  const cfgPath = candidates.find(existsSync) ?? candidates[0];

  let xml: string;
  try {
    xml = readFileSync(cfgPath, "utf-8");
  } catch {
    // Cemu hasn't been launched yet — create a minimal settings.xml
    xml = `<?xml version="1.0" encoding="UTF-8"?>\n<content>\n</content>`;
  }

  // Build the <GamePaths> block
  const pathsXml = romFolders.map((p) => `    <path>${p}</path>`).join("\n");
  const block = `  <GamePaths>\n${pathsXml}\n  </GamePaths>`;

  if (xml.includes("<GamePaths>")) {
    xml = xml.replace(/<GamePaths>[\s\S]*?<\/GamePaths>/, block);
  } else {
    xml = xml.replace("</content>", `${block}\n</content>`);
  }

  const dir = path.dirname(cfgPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(cfgPath, xml, "utf-8");
}

function configureDolphin(romFolders: string[]): void {
  const candidates = [
    path.join(os.homedir(), ".config", "dolphin-emu", "Dolphin.ini"),
    path.join(os.homedir(), ".local", "share", "dolphin-emu", "Dolphin.ini"),
  ];
  const cfgPath = candidates.find(existsSync) ?? candidates[0];
  let ini = readIni(cfgPath);
  ini = setIniKey(ini, "General", "ISOPaths", String(romFolders.length));
  ini = setNumberedIniKeys(
    ini,
    "General",
    "ISOPath",
    romFolders.map((_, i) => `ISOPath${i}`)
  );
  // Dolphin uses 0-indexed keys without separator
  let iniFixed = ini;
  romFolders.forEach((folder, i) => {
    iniFixed = setIniKey(iniFixed, "General", `ISOPath${i}`, folder);
  });
  writeIni(cfgPath, iniFixed);
}

function configurePpsspp(romFolders: string[]): void {
  if (romFolders.length === 0) return;
  const cfgPath = path.join(
    os.homedir(),
    ".config",
    "ppsspp",
    "PSP",
    "SYSTEM",
    "ppsspp.ini"
  );
  let ini = readIni(cfgPath);
  // PPSSPP remembers the last browse path; set it to the first ROM folder
  ini = setIniKey(ini, "General", "BrowsePath", romFolders[0]);
  writeIni(cfgPath, ini);
}

function configureAzahar(romFolders: string[]): void {
  const cfgPath = path.join(
    os.homedir(),
    ".config",
    "azahar-emu",
    "azahar",
    "qt-config.ini"
  );
  let ini = readIni(cfgPath);
  // Remove existing gamedirs entries
  ini = ini
    .split("\n")
    .filter((l) => !/^Paths\\gamedirs\\/i.test(l.trim()))
    .join("\n");
  // Append new entries
  const sectionIdx = ini.split("\n").findIndex((l) => l.trim() === "[UI]");
  const uiLines: string[] = [];
  uiLines.push(`Paths\\gamedirs\\size=${romFolders.length}`);
  romFolders.forEach((folder, i) => {
    const n = i + 1;
    uiLines.push(`Paths\\gamedirs\\${n}\\deep_scan=true`);
    uiLines.push(`Paths\\gamedirs\\${n}\\expanded=true`);
    uiLines.push(`Paths\\gamedirs\\${n}\\path=${folder}`);
  });
  const lines = ini.split("\n");
  if (sectionIdx === -1) {
    lines.push("", "[UI]", ...uiLines);
  } else {
    lines.splice(sectionIdx + 1, 0, ...uiLines);
  }
  writeIni(cfgPath, lines.join("\n"));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Write the ROM folder paths from Hydra's config into the target emulator's
 * own settings file so its native game browser shows the same library.
 * Errors are silently caught — this is best-effort only.
 */
export async function syncEmulatorRomPaths(
  system: EmulatorSystem
): Promise<void> {
  try {
    const config = await getEmulatorConfig(system);
    const romPaths = config.romFolders.map((f) => f.path);
    if (romPaths.length === 0) return;

    switch (system) {
      case "ps1":
        configureDuckstation(romPaths);
        break;
      case "ps2":
        configurePcsx2(romPaths);
        break;
      case "wiiu":
        configureCemu(romPaths);
        break;
      case "wii":
      case "gc":
        configureDolphin(romPaths);
        break;
      case "psp":
        configurePpsspp(romPaths);
        break;
      case "n3ds":
        configureAzahar(romPaths);
        break;
      // ralibretro / raproject64 / ravba don't use a persistent game-list config
      default:
        break;
    }
  } catch {
    /* silently ignore — emulator config write is always best-effort */
  }
}
