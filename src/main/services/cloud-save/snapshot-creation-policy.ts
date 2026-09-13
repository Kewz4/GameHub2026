export const shouldCreateRemoteCloudSaveSnapshot = (
  fileCount: number,
  customPathCount: number,
  baseVersion: number
) => fileCount > 0 || customPathCount > 0 || baseVersion > 0;
