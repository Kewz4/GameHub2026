import { db } from "../level";
import type { InstalledMod } from "@types";

/**
 * Mods installed through UKMM, keyed by the game's level-key
 * (`${shop}:${objectId}`). We track our own installs so the "Manage" list is
 * reliable regardless of UKMM's internal database format.
 */
export const installedModsSublevel = db.sublevel<string, InstalledMod[]>(
  "installedMods",
  { valueEncoding: "json" }
);
