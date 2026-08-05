export const shouldCreateRemoteCloudSaveSnapshot = (
  fileCount: number,
  baseVersion: number
) => fileCount > 0 || baseVersion > 0;
