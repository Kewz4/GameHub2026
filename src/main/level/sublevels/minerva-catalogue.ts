import { db } from "../level";
import type { EmulatorSystem } from "@types";

export interface MinervaCatalogueEntry {
  system: EmulatorSystem;
  title: string;
  region: string | null;
  filename: string;
  romPath: string;
  magnet: string | null;
  torrentUrl: string | null;
}

export interface MinervaCacheRecord {
  entry: MinervaCatalogueEntry;
  cachedAt: number;
}

export const minervaCatalogueSublevel = db.sublevel<string, MinervaCacheRecord>(
  "minervaCatalogue",
  { valueEncoding: "json" }
);

export const MINERVA_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
