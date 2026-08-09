export const CLOUD_SAVES_PAGE_REGION_ID = "cloud-saves-page";

export function getCloudSavesManageFocusId(shop: string, objectId: string) {
  return `cloud-saves-manage-${shop}-${objectId}`;
}

export function getCloudSavesRestoreFocusId(artifactId: string) {
  return `cloud-saves-restore-${artifactId}`;
}

export function getCloudSavesDeleteFocusId(artifactId: string) {
  return `cloud-saves-delete-${artifactId}`;
}
