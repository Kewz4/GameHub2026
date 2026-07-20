import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { BigPictureDiagnosticsPosition } from "@types";
import {
  Checkbox,
  DropdownSelect,
  NavigationDiagnostics,
  VerticalFocusGroup,
} from "../../../components";
import { useUserPreferences } from "../../../hooks";
import type { FocusOverrides } from "../../../services";
import {
  BIG_PICTURE_AUDIO_SECTION_REGION_ID,
  BIG_PICTURE_DIAGNOSTICS_POSITION_SELECT_ID,
  BIG_PICTURE_DIAGNOSTICS_SECTION_REGION_ID,
  BIG_PICTURE_ITEM_FOCUS_IDS,
  BIG_PICTURE_SECTION_REGION_ID,
  BIG_PICTURE_STARTUP_SECTION_REGION_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "../settings-navigation";
import { SettingsSection } from "../settings-section";

interface BigPictureSectionProps {
  className?: string;
}

interface BigPictureForm {
  launchInBigPicture: boolean;
  bigPictureSoundsEnabled: boolean;
  bigPictureVirtualKeyboardEnabled: boolean;
  bigPictureDiagnosticsEnabled: boolean;
  bigPictureDiagnosticsPosition: BigPictureDiagnosticsPosition;
}

const DEFAULT_FORM: BigPictureForm = {
  launchInBigPicture: false,
  bigPictureSoundsEnabled: true,
  bigPictureVirtualKeyboardEnabled: true,
  bigPictureDiagnosticsEnabled: false,
  bigPictureDiagnosticsPosition: "bottom-center",
};

const DIAGNOSTICS_POSITIONS: BigPictureDiagnosticsPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

export function BigPictureSettingsSection({
  className,
}: Readonly<BigPictureSectionProps>) {
  const { t } = useTranslation("settings");
  const userPreferences = useUserPreferences();
  const [form, setForm] = useState<BigPictureForm>(DEFAULT_FORM);

  useEffect(() => {
    if (!userPreferences) return;
    setForm({
      launchInBigPicture: userPreferences.launchInBigPicture ?? false,
      bigPictureSoundsEnabled: userPreferences.bigPictureSoundsEnabled ?? true,
      bigPictureVirtualKeyboardEnabled:
        userPreferences.bigPictureVirtualKeyboardEnabled ?? true,
      bigPictureDiagnosticsEnabled:
        userPreferences.bigPictureDiagnosticsEnabled ?? false,
      bigPictureDiagnosticsPosition:
        userPreferences.bigPictureDiagnosticsPosition ?? "bottom-center",
    });
  }, [userPreferences]);

  const update = useCallback(async (values: Partial<BigPictureForm>) => {
    setForm((prev) => ({ ...prev, ...values }));
    await globalThis.window.electron.updateUserPreferences(values);
  }, []);

  const diagnosticsPositionOptions = useMemo(
    () =>
      DIAGNOSTICS_POSITIONS.map((position) => ({
        key: position,
        value: position,
        label: t(position, position),
      })),
    [t]
  );

  const startupItem = {
    focusId: BIG_PICTURE_ITEM_FOCUS_IDS.launchInBigPicture,
    id: "launch-in-big-picture",
    label: t("launch_hydra_in_big_picture", "Launch in Big Picture mode"),
    checked: form.launchInBigPicture,
    onChange: (checked: boolean) =>
      void update({ launchInBigPicture: checked }),
  };

  const audioItem = {
    focusId: BIG_PICTURE_ITEM_FOCUS_IDS.enableSounds,
    id: "enable-sounds",
    label: t("big_picture_enable_sounds", "Enable sounds"),
    checked: form.bigPictureSoundsEnabled,
    onChange: (checked: boolean) =>
      void update({ bigPictureSoundsEnabled: checked }),
  };

  const keyboardItem = {
    focusId: BIG_PICTURE_ITEM_FOCUS_IDS.enableVirtualKeyboard,
    id: "enable-virtual-keyboard",
    label: t("big_picture_enable_virtual_keyboard", "Enable virtual keyboard"),
    checked: form.bigPictureVirtualKeyboardEnabled,
    onChange: (checked: boolean) =>
      void update({ bigPictureVirtualKeyboardEnabled: checked }),
  };

  const diagnosticsItem = {
    focusId: BIG_PICTURE_ITEM_FOCUS_IDS.enableDiagnostics,
    id: "enable-diagnostics",
    label: t("big_picture_enable_diagnostics", "Show performance diagnostics"),
    checked: form.bigPictureDiagnosticsEnabled,
    onChange: (checked: boolean) =>
      void update({ bigPictureDiagnosticsEnabled: checked }),
  };

  const startupNav: FocusOverrides = {
    up: SETTINGS_HEADER_RETURN_TARGET,
    down: { type: "item", itemId: audioItem.focusId },
  };
  const audioNav: FocusOverrides = {
    up: { type: "item", itemId: startupItem.focusId },
    down: { type: "item", itemId: keyboardItem.focusId },
  };
  const keyboardNav: FocusOverrides = {
    up: { type: "item", itemId: audioItem.focusId },
    down: { type: "item", itemId: diagnosticsItem.focusId },
  };
  const diagnosticsNav: FocusOverrides = {
    up: { type: "item", itemId: keyboardItem.focusId },
    down: form.bigPictureDiagnosticsEnabled
      ? { type: "item", itemId: BIG_PICTURE_DIAGNOSTICS_POSITION_SELECT_ID }
      : { type: "block" },
  };

  return (
    <div
      className={
        className ? `big-picture-settings ${className}` : "big-picture-settings"
      }
    >
      <VerticalFocusGroup regionId={BIG_PICTURE_SECTION_REGION_ID}>
        <VerticalFocusGroup
          regionId={BIG_PICTURE_STARTUP_SECTION_REGION_ID}
          asChild
        >
          <SettingsSection
            title={t("big_picture_startup", "Startup")}
            description={t(
              "big_picture_startup_description",
              "Configure how GameHub launches."
            )}
          >
            <Checkbox
              id={startupItem.id}
              label={startupItem.label}
              checked={startupItem.checked}
              focusId={startupItem.focusId}
              navigationOverrides={startupNav}
              block
              onChange={startupItem.onChange}
            />
          </SettingsSection>
        </VerticalFocusGroup>

        <VerticalFocusGroup
          regionId={BIG_PICTURE_AUDIO_SECTION_REGION_ID}
          asChild
        >
          <SettingsSection
            title={t("big_picture_audio", "Audio")}
            description={t(
              "big_picture_audio_description",
              "Sound effects in Big Picture mode."
            )}
          >
            <Checkbox
              id={audioItem.id}
              label={audioItem.label}
              checked={audioItem.checked}
              focusId={audioItem.focusId}
              navigationOverrides={audioNav}
              block
              onChange={audioItem.onChange}
            />
            <Checkbox
              id={keyboardItem.id}
              label={keyboardItem.label}
              checked={keyboardItem.checked}
              focusId={keyboardItem.focusId}
              navigationOverrides={keyboardNav}
              block
              onChange={keyboardItem.onChange}
            />
          </SettingsSection>
        </VerticalFocusGroup>

        <VerticalFocusGroup
          regionId={BIG_PICTURE_DIAGNOSTICS_SECTION_REGION_ID}
          asChild
        >
          <SettingsSection
            title={t("big_picture_diagnostics", "Diagnostics")}
            description={t(
              "big_picture_diagnostics_description",
              "Display performance information overlay."
            )}
          >
            <Checkbox
              id={diagnosticsItem.id}
              label={diagnosticsItem.label}
              checked={diagnosticsItem.checked}
              focusId={diagnosticsItem.focusId}
              navigationOverrides={diagnosticsNav}
              block
              onChange={diagnosticsItem.onChange}
            />

            {form.bigPictureDiagnosticsEnabled && (
              <>
                <NavigationDiagnostics />
                <DropdownSelect
                  focusId={BIG_PICTURE_DIAGNOSTICS_POSITION_SELECT_ID}
                  label={t(
                    "big_picture_diagnostics_position",
                    "Diagnostics position"
                  )}
                  value={form.bigPictureDiagnosticsPosition}
                  options={diagnosticsPositionOptions}
                  focusNavigationOverrides={{
                    up: { type: "item", itemId: diagnosticsItem.focusId },
                    down: { type: "block" },
                  }}
                  onValueChange={(value) =>
                    void update({
                      bigPictureDiagnosticsPosition:
                        value as BigPictureDiagnosticsPosition,
                    })
                  }
                />
              </>
            )}
          </SettingsSection>
        </VerticalFocusGroup>
      </VerticalFocusGroup>
    </div>
  );
}
