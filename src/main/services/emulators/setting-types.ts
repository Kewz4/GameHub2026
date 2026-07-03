export type SettingType = "enum" | "toggle";

export interface SettingDef {
  /** The raw config key written to the emulator/core config. */
  key: string;
  /** Human label shown in the UI. */
  label: string;
  type: SettingType;
  /** For enum settings: the allowed values (raw) + their display labels. */
  options?: { value: string; label: string }[];
  /** Group heading (e.g. "Video", "Performance", "Enhancements"). */
  group: string;
  /** Short help text. */
  hint?: string;
}

export interface SettingValue {
  key: string;
  value: string;
}
