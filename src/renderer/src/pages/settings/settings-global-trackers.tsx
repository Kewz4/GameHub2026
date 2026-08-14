import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  MAX_GLOBAL_TRACKERS,
  MAX_TRACKER_LIST_TEXT_LENGTH,
  TrackerListValidationError,
  parseTrackerList,
  validateAndNormalizeTrackerUrls,
} from "@shared";
import { Button, CheckboxField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";

import "./settings-global-trackers.scss";

export function SettingsGlobalTrackers() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const [manualText, setManualText] = useState("");
  const [appendTrackers, setAppendTrackers] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<
    { kind: "error" | "success"; message: string } | undefined
  >();

  useEffect(() => {
    if (!userPreferences || isDirty) return;

    setManualText(userPreferences.globalTrackers?.join("\n") ?? "");
    setAppendTrackers(userPreferences.appendGlobalTrackers ?? false);
  }, [isDirty, userPreferences]);

  const parsedTrackerCount = useMemo(() => {
    try {
      return parseTrackerList(manualText).length;
    } catch {
      return MAX_GLOBAL_TRACKERS + 1;
    }
  }, [manualText]);

  const handleSave = async () => {
    setIsSaving(true);
    setStatus(undefined);

    try {
      const trackers = validateAndNormalizeTrackerUrls(
        parseTrackerList(manualText)
      );

      await updateUserPreferences({
        globalTrackers: trackers,
        appendGlobalTrackers: appendTrackers,
      });

      setManualText(trackers.join("\n"));
      setIsDirty(false);
      setStatus({
        kind: "success",
        message: t("global_trackers_saved"),
      });
    } catch (error) {
      const isTooMany =
        error instanceof TrackerListValidationError &&
        error.code === "too_many_trackers";

      setStatus({
        kind: "error",
        message: isTooMany
          ? t("global_trackers_too_many", { count: MAX_GLOBAL_TRACKERS })
          : t("global_trackers_invalid"),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="settings-global-trackers">
      <p
        id="settings-global-trackers-description"
        className="settings-global-trackers__description"
      >
        {t("global_trackers_description", { count: MAX_GLOBAL_TRACKERS })}
      </p>

      <CheckboxField
        id="settings-append-global-trackers"
        label={t("global_trackers_append_manual")}
        checked={appendTrackers}
        onChange={(event) => {
          setAppendTrackers(event.target.checked);
          setIsDirty(true);
          setStatus(undefined);
        }}
      />

      <label
        className="settings-global-trackers__label"
        htmlFor="settings-global-trackers-input"
      >
        {t("global_trackers_manual_label")}
      </label>
      <textarea
        id="settings-global-trackers-input"
        className="settings-global-trackers__textarea"
        value={manualText}
        maxLength={MAX_TRACKER_LIST_TEXT_LENGTH}
        rows={6}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        aria-describedby="settings-global-trackers-description settings-global-trackers-count"
        placeholder={t("global_trackers_manual_placeholder")}
        onChange={(event) => {
          setManualText(event.target.value);
          setIsDirty(true);
          setStatus(undefined);
        }}
      />

      <div className="settings-global-trackers__footer">
        <span
          id="settings-global-trackers-count"
          className={
            parsedTrackerCount > MAX_GLOBAL_TRACKERS
              ? "settings-global-trackers__count settings-global-trackers__count--error"
              : "settings-global-trackers__count"
          }
        >
          {t("global_trackers_count", {
            count: parsedTrackerCount,
            maximum: MAX_GLOBAL_TRACKERS,
          })}
        </span>

        <Button
          theme="primary"
          disabled={!isDirty || isSaving}
          onClick={() => void handleSave()}
        >
          {isSaving ? t("saving") : t("save_changes")}
        </Button>
      </div>

      {status && (
        <p
          className={`settings-global-trackers__status settings-global-trackers__status--${status.kind}`}
          role={status.kind === "error" ? "alert" : "status"}
        >
          {status.message}
        </p>
      )}
    </div>
  );
}
