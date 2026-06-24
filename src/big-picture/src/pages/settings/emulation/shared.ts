export const SETTINGS_TOAST_OPTIONS = {
  duration: 3000,
};

export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

export const basename = (filePath: string): string => {
  return filePath.split(/[\\/]/).pop() ?? filePath;
};
