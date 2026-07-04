import { useEffect, useMemo, useState } from "react";
import { InfoIcon } from "@primer/octicons-react";
import type { EmulatorSystem } from "@types";
import { useToast } from "@renderer/hooks";
import { SettingSelect } from "./setting-select";
import "./emulator-settings-section.scss";

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

/**
 * Per-emulator video / performance / core settings, grouped and persisted to
 * the emulator's own config on change. Backed by getEmulatorSettings /
 * setEmulatorSettings (RALibretro core-option JSON today).
 */
export function EmulatorSettingsSection({ system }: Readonly<Props>) {
  const { showErrorToast } = useToast();
  const [defs, setDefs] = useState<SettingDef[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.electron
      .getEmulatorSettings(system)
      .then((res) => {
        if (cancelled) return;
        setDefs(res.defs);
        setValues(Object.fromEntries(res.values.map((v) => [v.key, v.value])));
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [system]);

  const groups = useMemo(() => {
    const g: Record<string, SettingDef[]> = {};
    for (const d of defs) (g[d.group] ??= []).push(d);
    // Present groups in a stable, intentional order rather than whatever order
    // the setting keys happen to appear in. Unknown groups sort to the end.
    const order = [
      "Video",
      "Enhancements",
      "Performance",
      "Screen",
      "Audio",
      "System",
      "Advanced",
    ];
    const rank = (name: string) => {
      const i = order.indexOf(name);
      return i === -1 ? order.length : i;
    };
    return Object.entries(g).sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [defs]);

  const onChange = async (key: string, value: string) => {
    const next = { ...values, [key]: value };
    setValues(next);
    setSaving(true);
    try {
      const ok = await window.electron.setEmulatorSettings(system, [
        { key, value },
      ]);
      if (!ok) showErrorToast("Couldn't save setting");
    } catch {
      showErrorToast("Couldn't save setting");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="emulator-detail__muted">Loading settings…</p>;
  }
  if (defs.length === 0) {
    return (
      <p className="emulator-detail__muted">
        No configurable settings for this emulator yet.
      </p>
    );
  }

  return (
    <div className="emulator-settings">
      <p className="emulator-settings__notice">
        <InfoIcon size={14} />
        <span>
          Changes are saved instantly, but the emulator only reads them when a
          game starts — close and relaunch the game for new settings to take
          effect.
        </span>
      </p>

      {groups.map(([group, list]) => (
        <section key={group} className="emulator-settings__group">
          <h4 className="emulator-settings__group-title">{group}</h4>
          <div className="emulator-settings__rows">
            {list.map((def) => (
              <div key={def.key} className="emulator-settings__row">
                <div className="emulator-settings__label">
                  <span className="emulator-settings__label-text">
                    {def.label}
                  </span>
                  {def.hint && (
                    <span className="emulator-settings__hint">{def.hint}</span>
                  )}
                </div>
                <SettingSelect
                  value={values[def.key] ?? def.options?.[0]?.value ?? ""}
                  options={def.options ?? []}
                  disabled={saving}
                  onChange={(v) => onChange(def.key, v)}
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
