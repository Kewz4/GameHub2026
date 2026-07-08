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

/** A mod we've installed for a specific game. */
export interface InstalledMod {
  /** GameBanana mod id (or 0 for a local/bcml install). */
  gbModId: number;
  name: string;
  fileName: string;
  thumbnailUrl: string | null;
  installedAt: string;
  /** The Cemu graphic-pack rules.txt path this mod deploys to (for
   * enable/remove), when installed via the native graphic-pack deployer. */
  packRulesId?: string;
}

/** One choosable option within a BNP mod's option group. */
export interface ModOption {
  /** Display name. */
  name: string;
  description: string;
  /** The `options/<folder>` inside the BNP this option maps to. */
  folder: string;
}

/** A group of options from a BNP's info.json (`single` = radio, `multi` =
 * checkboxes). */
export interface ModOptionGroup {
  name: string;
  description: string;
  type: "single" | "multi";
  required: boolean;
  options: ModOption[];
}

/**
 * Result of preparing a mod for install. When `needsOptions` is set the caller
 * must show the option chooser and call back with the selected folders.
 */
export interface ModInstallPrep {
  ok: boolean;
  reason?: string;
  /** Set when the mod has configurable options to choose before installing. */
  needsOptions?: boolean;
  /** Opaque staging token to pass to the finalize step. */
  stagingId?: string;
  name?: string;
  optionGroups?: ModOptionGroup[];
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
