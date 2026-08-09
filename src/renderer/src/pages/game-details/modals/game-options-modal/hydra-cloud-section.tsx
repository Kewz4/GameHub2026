import { CloudSavePanel, useCloudSaveV2 } from "../../cloud-save-v2";

export function HydraCloudSettingsSection() {
  const {
    overview,
    isAutomaticSyncEnabled,
    isRefreshing,
    isSyncing,
    isGameRunning,
    hasError,
    progress,
    hasExecutablePath,
    openFileBrowser,
    selectExecutable,
    runCloudSaveOperation,
    setAutomaticSyncEnabled,
    requestConflictResolution,
  } = useCloudSaveV2();

  return (
    <div className="game-options-modal__cloud-panel">
      <CloudSavePanel
        active
        showLaunchConflictWarning={false}
        overview={overview}
        isLoading={isRefreshing}
        isSyncing={isSyncing}
        isGameRunning={isGameRunning}
        hasExecutablePath={hasExecutablePath}
        isAutomaticSyncEnabled={isAutomaticSyncEnabled}
        hasError={hasError}
        errorMessageKey={hasError ? "cloud_save_v2_load_error" : null}
        progress={progress}
        onSync={() => void runCloudSaveOperation()}
        onOpenFileBrowser={openFileBrowser}
        onSelectExecutable={selectExecutable}
        onAutomaticSyncChange={setAutomaticSyncEnabled}
        onResolveConflict={requestConflictResolution}
      />
    </div>
  );
}
