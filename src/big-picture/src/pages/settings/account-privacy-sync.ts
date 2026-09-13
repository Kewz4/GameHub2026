export interface SettingsSyncFeedback {
  success: boolean;
  title: string;
  message: string;
}

export function getSettingsBackupFeedback(
  result: { ok: boolean } | null
): SettingsSyncFeedback {
  if (result?.ok) {
    return {
      success: true,
      title: "Settings backup complete",
      message: "Your GameHub settings were backed up to R2.",
    };
  }

  return {
    success: false,
    title: "Settings backup failed",
    message: "GameHub could not back up your settings right now.",
  };
}

export function getSettingsRestoreFeedback(
  result: { restored: boolean; updatedAt?: string } | null
): SettingsSyncFeedback {
  if (result?.restored) {
    return {
      success: true,
      title: "Settings restored",
      message: "Your R2 settings backup was restored and applied to GameHub.",
    };
  }

  return {
    success: false,
    title: "No settings backup found",
    message: "There is no R2 settings backup to restore for this account yet.",
  };
}
