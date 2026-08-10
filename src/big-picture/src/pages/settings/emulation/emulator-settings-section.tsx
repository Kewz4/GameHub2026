import { InfoIcon } from "@primer/octicons-react";
import type { EmulatorSystem } from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Checkbox,
  DropdownSelect,
  VerticalFocusGroup,
} from "../../../components";
import { useBigPictureToast } from "../../../hooks";
import { getBigPictureToggleValues } from "./emulator-setting-presentation";

interface SettingDef {
  key: string;
  label: string;
  type: "enum" | "toggle";
  options?: { value: string; label: string }[];
  group: string;
  hint?: string;
}

interface Props {
  system: EmulatorSystem;
}

const GROUP_ORDER = [
  "Video",
  "Enhancements",
  "Performance",
  "Screen",
  "Audio",
  "System",
  "Advanced",
];

function settingFocusId(key: string) {
  return `emulation-setting-${key.replaceAll(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;
}

export function BigPictureEmulatorSettingsSection({ system }: Readonly<Props>) {
  const { showErrorToast } = useBigPictureToast();
  const [defs, setDefs] = useState<SettingDef[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);

    globalThis.window.electron
      .getEmulatorSettings(system)
      .then((result) => {
        if (cancelled) return;
        setDefs(result.defs);
        setValues(
          Object.fromEntries(
            result.values.map((item) => [item.key, item.value])
          )
        );
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [system]);

  const groups = useMemo(() => {
    const grouped = new Map<string, SettingDef[]>();

    for (const def of defs) {
      grouped.set(def.group, [...(grouped.get(def.group) ?? []), def]);
    }

    return [...grouped.entries()].sort(([left], [right]) => {
      const leftRank = GROUP_ORDER.indexOf(left);
      const rightRank = GROUP_ORDER.indexOf(right);
      const normalizedLeft = leftRank === -1 ? GROUP_ORDER.length : leftRank;
      const normalizedRight = rightRank === -1 ? GROUP_ORDER.length : rightRank;
      return normalizedLeft - normalizedRight || left.localeCompare(right);
    });
  }, [defs]);

  const updateSetting = useCallback(
    async (key: string, value: string) => {
      const previousValue = values[key];
      setValues((current) => ({ ...current, [key]: value }));
      setSavingKey(key);

      try {
        const saved = await globalThis.window.electron.setEmulatorSettings(
          system,
          [{ key, value }]
        );

        if (!saved) throw new Error("The emulator rejected the setting.");
      } catch {
        setValues((current) => {
          const restored = { ...current };
          if (previousValue === undefined) delete restored[key];
          else restored[key] = previousValue;
          return restored;
        });
        showErrorToast("Couldn't save emulator setting");
      } finally {
        setSavingKey(null);
      }
    },
    [showErrorToast, system, values]
  );

  if (loading) {
    return (
      <p className="emulator-detail__empty" role="status">
        Loading emulator settings…
      </p>
    );
  }

  if (loadFailed) {
    return (
      <p
        className="emulator-detail__empty emulator-detail__empty--error"
        role="alert"
      >
        Emulator settings could not be loaded.
      </p>
    );
  }

  if (defs.length === 0) {
    return (
      <p className="emulator-detail__empty" role="status">
        This emulator does not expose configurable performance settings yet.
      </p>
    );
  }

  return (
    <div className="emulator-settings">
      <p className="emulator-settings__notice">
        <InfoIcon size={14} />
        <span>
          Changes are saved immediately and apply the next time a game starts.
        </span>
      </p>

      {groups.map(([group, groupDefs]) => (
        <section key={group} className="emulator-settings__group">
          <h4 className="emulator-settings__group-title">{group}</h4>
          <VerticalFocusGroup
            regionId={`emulation-settings-${group.replaceAll(/[^a-z0-9_-]/gi, "-").toLowerCase()}`}
            className="emulator-settings__rows"
          >
            {groupDefs.map((def) => {
              const toggleValues = getBigPictureToggleValues(def);
              const currentValue =
                values[def.key] ?? def.options?.[0]?.value ?? "";
              const focusId = settingFocusId(def.key);
              const disabled = savingKey !== null;

              return (
                <div key={def.key} className="emulator-settings__row">
                  <div className="emulator-settings__label">
                    <span className="emulator-settings__label-text">
                      {def.label}
                    </span>
                    {def.hint ? (
                      <span className="emulator-settings__hint">
                        {def.hint}
                      </span>
                    ) : null}
                  </div>

                  {toggleValues ? (
                    <Checkbox
                      focusId={focusId}
                      checked={currentValue === toggleValues.on}
                      disabled={disabled}
                      onChange={(checked) => {
                        void updateSetting(
                          def.key,
                          checked ? toggleValues.on : toggleValues.off
                        );
                      }}
                    />
                  ) : (
                    <DropdownSelect
                      focusId={focusId}
                      hideLabel
                      ariaLabel={def.label}
                      value={currentValue}
                      options={(def.options ?? []).map((option) => ({
                        value: option.value,
                        label: option.label,
                      }))}
                      onValueChange={(value) => {
                        if (!disabled) void updateSetting(def.key, value);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </VerticalFocusGroup>
        </section>
      ))}
    </div>
  );
}
