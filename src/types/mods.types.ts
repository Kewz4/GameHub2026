/** A mod listed from GameBanana's BOTW (game 5866) feed. */
export interface GameBananaMod {
  id: number;
  name: string;
  /** Root category, e.g. "Skins", "Gameplay". */
  category: string | null;
  submitter: string | null;
  /** Preview thumbnail(s) for the browse card. */
  imageUrl: string | null;
  likes: number;
  views: number;
  profileUrl: string;
}

/** A GameBanana mod's full profile (detail view). */
export interface GameBananaModDetail {
  id: number;
  name: string;
  /** HTML description. */
  description: string;
  submitter: string | null;
  likes: number;
  views: number;
  profileUrl: string;
  /** Gallery image URLs. */
  gallery: string[];
  /** Downloadable files (usually a single .bnp for UKMM). */
  files: {
    id: number;
    fileName: string;
    sizeBytes: number;
    downloadUrl: string;
  }[];
}

/** A mod we've installed through UKMM for a specific game. */
export interface InstalledMod {
  /** GameBanana mod id (or 0 for a local/bcml install). */
  gbModId: number;
  name: string;
  fileName: string;
  thumbnailUrl: string | null;
  installedAt: string;
}

/** UKMM + mod state for a game's Mods tab. */
export interface ModManagerStatus {
  /** UKMM has been downloaded and set up. */
  ukmmInstalled: boolean;
  /** Cemu is installed (required to deploy/run mods). */
  cemuInstalled: boolean;
  /** The master "mods enabled" switch (the UKMM Cemu graphic pack is active). */
  modsEnabled: boolean;
  /** Mods we've installed for this game. */
  installed: InstalledMod[];
}
