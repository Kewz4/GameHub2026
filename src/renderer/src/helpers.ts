import type { GameShop } from "@types";

import Color from "color";
import i18next from "i18next";
import { v4 as uuidv4 } from "uuid";
import { THEME_WEB_STORE_URL } from "./constants";
import { levelDBService } from "./services/leveldb.service";

export const formatDownloadProgress = (
  progress?: number,
  fractionDigits?: number
) => {
  if (!progress) return "0%";
  const progressPercentage = progress * 100;

  if (Number(progressPercentage.toFixed(fractionDigits ?? 2)) % 1 === 0)
    return `${Math.floor(progressPercentage)}%`;

  return `${progressPercentage.toFixed(fractionDigits ?? 2)}%`;
};

export const getSteamLanguage = (language: string) => {
  if (language.startsWith("pt")) return "brazilian";
  if (language.startsWith("es")) return "spanish";
  if (language.startsWith("fr")) return "french";
  if (language.startsWith("ru") || language.startsWith("be")) return "russian";
  if (language.startsWith("it")) return "italian";
  if (language.startsWith("hu")) return "hungarian";
  if (language.startsWith("pl")) return "polish";
  if (language.startsWith("zh")) return "schinese";
  if (language.startsWith("da")) return "danish";

  return "english";
};

export const buildGameDetailsPath = (
  game: { shop: GameShop; objectId: string; title: string },
  params: Record<string, string> = {}
) => {
  const searchParams = new URLSearchParams({ title: game.title, ...params });
  return `/game/${game.shop}/${game.objectId}?${searchParams.toString()}`;
};

export const buildGameAchievementPath = (
  game: { shop: GameShop; objectId: string; title: string },
  user?: { userId: string }
) => {
  const searchParams = new URLSearchParams({
    title: game.title,
    shop: game.shop,
    objectId: game.objectId,
    userId: user?.userId || "",
  });

  return `/achievements/?${searchParams.toString()}`;
};

export const darkenColor = (color: string, amount: number, alpha: number = 1) =>
  new Color(color).darken(amount).alpha(alpha).toString();

export const injectCustomCss = (
  css: string,
  target: HTMLElement = document.head
) => {
  try {
    target.querySelector("#custom-css")?.remove();

    if (css.startsWith(THEME_WEB_STORE_URL)) {
      const link = document.createElement("link");
      link.id = "custom-css";
      link.rel = "stylesheet";
      link.href = css;
      target.appendChild(link);
    } else {
      const style = document.createElement("style");
      style.id = "custom-css";
      style.textContent = `
        ${css}
      `;
      target.appendChild(style);
    }
  } catch (error) {
    console.error("failed to inject custom css:", error);
  }
};

export const removeCustomCss = (target: HTMLElement = document.head) => {
  target.querySelector("#custom-css")?.remove();
};

export const generateRandomGradient = (): string => {
  // Use a single consistent gradient with softer colors for custom games as placeholder
  const color1 = "#2c3e50"; // Dark blue-gray
  const color2 = "#34495e"; // Darker slate

  // Create SVG data URL that works in img tags
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#grad)" />
  </svg>`;

  // Return as data URL that works in img tags
  return `data:image/svg+xml;base64,${btoa(svgContent)}`;
};

export const formatNumber = (num: number): string => {
  const locale = i18next.resolvedLanguage || i18next.language || undefined;

  return new Intl.NumberFormat(locale, {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(num);
};

/**
 * Generates a UUID v4
 * @returns A random UUID string
 */
export const generateUUID = (): string => {
  return uuidv4();
};

export const getAchievementSoundUrl = async (): Promise<string> => {
  const defaultSound = (await import("@renderer/assets/audio/achievement.wav"))
    .default;

  try {
    const allThemes = (await levelDBService.values("themes")) as {
      id: string;
      isActive?: boolean;
      hasCustomSound?: boolean;
    }[];
    const activeTheme = allThemes.find((theme) => theme.isActive);

    if (activeTheme?.hasCustomSound) {
      const soundDataUrl = await window.electron.getThemeSoundDataUrl(
        activeTheme.id
      );
      if (soundDataUrl) {
        return soundDataUrl;
      }
    }
  } catch (error) {
    console.error("Failed to get theme sound", error);
  }

  return defaultSound;
};

export const getAchievementSoundVolume = async (): Promise<number> => {
  try {
    const prefs = (await levelDBService.get(
      "userPreferences",
      null,
      "json"
    )) as { achievementSoundVolume?: number } | null;
    return prefs?.achievementSoundVolume ?? 0.15;
  } catch (error) {
    console.error("Failed to get sound volume", error);
    return 0.15;
  }
};

export const getGameKey = (shop: GameShop, objectId: string): string => {
  return `${shop}:${objectId}`;
};

/* ── Emulation helpers ────────────────────────────────────────────────────── */

export type SkuRegion = "US" | "EU" | "JP" | "KR" | "ASIA" | "Unknown";

const SKU_REGION_FLAGS: Record<SkuRegion, string> = {
  US: "🇺🇸",
  EU: "🌍",
  JP: "🇯🇵",
  KR: "🇰🇷",
  ASIA: "🌏",
  Unknown: "❓",
};

/** Map of SKU prefix letters to their region. */
const SKU_PREFIX_REGION: Record<string, SkuRegion> = {
  // US (North America)
  SCUS: "US",
  SLUS: "US",
  NPUA: "US",
  BCUS: "US",
  // JP (Japan)
  SCPS: "JP",
  SLPS: "JP",
  NPJA: "JP",
  NPJB: "JP",
  BCJS: "JP",
  // KR (Korea)
  SLKA: "KR",
  // EU (Europe / rest of world)
  SCES: "EU",
  SLES: "EU",
  SCED: "EU",
  SLED: "EU",
  NPEA: "EU",
  NPEB: "EU",
  BCES: "EU",
  BCED: "EU",
};

/** Extract the region string from a normalised SKU such as "SLES-50009". */
export const getSkuRegion = (sku: string | null | undefined): SkuRegion => {
  if (!sku) return "Unknown";
  const prefix = sku.split("-")[0]?.toUpperCase();
  return (prefix && SKU_PREFIX_REGION[prefix]) || "Unknown";
};

/** Return the flag emoji for a given region string. */
export const getSkuRegionFlag = (region: string): string => {
  return SKU_REGION_FLAGS[region as SkuRegion] ?? "❓";
};

/** Return deduplicated regions for an array of SKUs. */
export const getRegionsFromSkus = (skus: string[]): SkuRegion[] => {
  const regions = new Set(skus.map((s) => getSkuRegion(s)));
  return Array.from(regions);
};

/**
 * Extract the region from an EmulationCloudSave.saveIdentity string.
 * Save identities encode the SKU (e.g. "SLES-50009/slot0"), so we
 * just grab the leading part and run it through getSkuRegion.
 */
export const getSkuRegionFromSaveIdentity = (
  identity: string
): SkuRegion | null => {
  if (!identity) return null;
  const sku = identity.split("/")[0] ?? null;
  return getSkuRegion(sku);
};

/**
 * Convert a LaunchBox platform string to our EmulatorSystem key.
 * Returns null when the platform is not a supported emulator system.
 */
export const platformToSystem = (
  platform: string | null | undefined
): "ps1" | "ps2" | "ps3" | null => {
  if (!platform) return null;
  const p = platform.toLowerCase();
  if (p.includes("playstation 3") || p.includes("ps3")) return "ps3";
  if (p.includes("playstation 2") || p.includes("ps2")) return "ps2";
  if (p.includes("playstation") || p.includes("ps1") || p.includes("psx"))
    return "ps1";
  return null;
};

/** The coded launch failures the game-details launch handler branches on. */
const CLASSICS_LAUNCH_CODES = [
  "EMULATOR_NOT_CONFIGURED",
  "BIOS_NOT_CONFIGURED",
  "NO_DISC",
  "PLATFORM_UNKNOWN",
  "EMULATOR_ALREADY_RUNNING",
] as const;

/**
 * Extract the coded launch failure from a classics launch error. Electron's IPC
 * wraps a thrown main-process Error as
 * `Error invoking remote method 'openClassicsGame': Error: <CODE>: <detail>`
 * and drops custom own-properties (`.code`), so the code only survives as a
 * substring of the message — match it out rather than comparing the whole
 * string. Falls back to the raw message / "unknown".
 */
export const getClassicsLaunchErrorCode = (error: unknown): string => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const matched = CLASSICS_LAUNCH_CODES.find((code) => message.includes(code));
  if (matched) return matched;
  return message || "unknown";
};
