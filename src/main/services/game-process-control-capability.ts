export const supportsGameProcessControl = (platform: NodeJS.Platform) =>
  platform === "win32" || platform === "linux";
