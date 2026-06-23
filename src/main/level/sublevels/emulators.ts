import { db } from "../level";
import type { EmulatorConfig, EmulatorSystem } from "@types";

export const emulatorsSublevel = db.sublevel<EmulatorSystem, EmulatorConfig>(
  "emulators",
  { valueEncoding: "json" }
);
