interface SettingOption {
  value: string;
  label: string;
}

export function getBigPictureToggleValues(def: {
  options?: SettingOption[];
}): { on: string; off: string } | null {
  const options = def.options ?? [];
  if (options.length !== 2) return null;

  const labels = options.map((option) => option.label.trim().toLowerCase());
  if (labels[0] !== "on" || labels[1] !== "off") return null;

  return { on: options[0].value, off: options[1].value };
}
