import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { CheckCircleFillIcon, XIcon } from "@primer/octicons-react";

import type { EmulatorConfigMap, EmulatorSystem } from "@types";
import { PLATFORM_LABELS } from "@renderer/assets/emulation/platform-logos";

import { EMULATORS, type EmulatorEntry } from "./emulator-registry";
import { EmulatorManagerView } from "./emulator-manager-view";
import { PlatformLogo } from "./platform-logo";

import "./emulation-manager-modal.scss";

interface Props {
  visible: boolean;
  onClose: () => void;
  initialSystem?: EmulatorSystem | null;
}

/**
 * Large, full-space Emulation manager. Shows ONE card per emulator (RALibretro
 * covers eight consoles); opening an emulator reveals its platform tabs, each
 * with Settings / Controls / ROM folders / Library sub-tabs, plus the shared
 * emulator executable settings.
 */
export function EmulationManagerModal({
  visible,
  onClose,
  initialSystem,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const [configs, setConfigs] = useState<EmulatorConfigMap | null>(null);
  const [selected, setSelected] = useState<EmulatorEntry | null>(null);

  const refresh = useCallback(async () => {
    const next = await window.electron.getEmulatorConfigs();
    setConfigs(next);
    return next;
  }, []);

  useEffect(() => {
    if (!visible) return;
    refresh();
  }, [visible, refresh]);

  // Deep-link: open the emulator that serves the requested system.
  useEffect(() => {
    if (!visible || !initialSystem) return;
    const emu = EMULATORS.find((e) => e.systems.includes(initialSystem));
    if (emu) setSelected(emu);
  }, [visible, initialSystem]);

  // Reset to the grid when the modal closes.
  useEffect(() => {
    if (!visible) setSelected(null);
  }, [visible]);

  const isInstalled = useCallback(
    (emu: EmulatorEntry): boolean =>
      !!configs && emu.systems.some((s) => Boolean(configs[s]?.executablePath)),
    [configs]
  );

  const gamesFound = useCallback(
    (emu: EmulatorEntry): number =>
      !configs
        ? 0
        : emu.systems.reduce(
            (sum, s) => sum + (configs[s]?.totalFiles ?? 0),
            0
          ),
    [configs]
  );

  const body = useMemo(() => {
    if (!configs) {
      return <div className="emulation-manager__loading">…</div>;
    }
    if (selected) {
      return (
        <EmulatorManagerView
          emulator={selected}
          configs={configs}
          onBack={() => setSelected(null)}
          onChange={setConfigs}
          refresh={refresh}
        />
      );
    }
    return (
      <div className="emulation-manager__grid">
        {EMULATORS.map((emu) => {
          const installed = isInstalled(emu);
          const games = gamesFound(emu);
          return (
            <button
              key={emu.binary}
              type="button"
              className={cn("emulation-manager__card", {
                "emulation-manager__card--installed": installed,
              })}
              onClick={() => setSelected(emu)}
            >
              <div className="emulation-manager__card-top">
                <img
                  src={emu.logo}
                  alt={emu.name}
                  className={cn("emulation-manager__card-logo", {
                    "emulation-manager__card-logo--color": emu.colorLogo,
                  })}
                />
                {installed ? (
                  <span className="emulation-manager__card-status emulation-manager__card-status--ok">
                    <CheckCircleFillIcon size={13} /> {t("synced")}
                  </span>
                ) : (
                  <span className="emulation-manager__card-status">
                    {t("not_detected")}
                  </span>
                )}
              </div>
              <span className="emulation-manager__card-name">{emu.name}</span>
              <div className="emulation-manager__card-platforms">
                {emu.systems.map((s) => (
                  <span
                    key={s}
                    className="emulation-manager__chip"
                    title={PLATFORM_LABELS[s]}
                  >
                    <PlatformLogo
                      system={s}
                      className="emulation-manager__chip-logo"
                    />
                  </span>
                ))}
              </div>
              {emu.hasRetroAchievements && (
                <span className="emulation-manager__ra">RetroAchievements</span>
              )}
              {installed && games > 0 && (
                <span className="emulation-manager__card-count">
                  {t("games_found_other", { count: games })}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }, [configs, selected, isInstalled, gamesFound, refresh, t]);

  if (!visible) return null;

  return (
    <div className="emulation-manager__overlay">
      <button
        type="button"
        className="emulation-manager__backdrop"
        aria-label={t("close", { defaultValue: "Close" })}
        onClick={onClose}
      />
      <div className="emulation-manager__modal" role="dialog" aria-modal="true">
        <header className="emulation-manager__header">
          <h2 className="emulation-manager__title">
            {t("emulation_manager_title", { defaultValue: "Emulation" })}
          </h2>
          <button
            type="button"
            className="emulation-manager__close"
            onClick={onClose}
            aria-label={t("close", { defaultValue: "Close" })}
          >
            <XIcon size={18} />
          </button>
        </header>
        <div className="emulation-manager__body">{body}</div>
      </div>
    </div>
  );
}
