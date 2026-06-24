import { db } from "../level";
import type {
  EmulatorConfig,
  EmulatorSystem,
  MemoryCardSaveRecord,
} from "@types";

export const emulatorsSublevel = db.sublevel<EmulatorSystem, EmulatorConfig>(
  "emulators",
  { valueEncoding: "json" }
);

export const ps2MemoryCardSavesSublevel = db.sublevel<
  string,
  MemoryCardSaveRecord
>("ps2MemoryCardSaves", { valueEncoding: "json" });

export const ps1MemoryCardSavesSublevel = db.sublevel<
  string,
  MemoryCardSaveRecord
>("ps1MemoryCardSaves", { valueEncoding: "json" });
