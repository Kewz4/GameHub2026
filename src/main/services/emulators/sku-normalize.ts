export const normalize = (raw: string): string =>
  raw
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .trim();
