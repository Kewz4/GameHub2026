import { useEffect, useRef, useState } from "react";
import { Button } from "@renderer/components";
import { CheckCircleFillIcon, DownloadIcon } from "@primer/octicons-react";
import type {
  EmulatorBinary,
  EmulatorSystem,
  EmulatorConfigMap,
  EmulatorInstallProgress,
  ResolvedInstallOption,
} from "@types";

import gamehubIcon from "@renderer/assets/icons/gamehub.png";
import ps2Art from "@renderer/assets/emulation/ps2.png";
import ps3Art from "@renderer/assets/emulation/ps3.png";
import n3dsArt from "@renderer/assets/emulation/n3ds.png";
import gbArt from "@renderer/assets/emulation/gb.png";
import wiiuArt from "@renderer/assets/emulation/wiiu.png";
import wiiArt from "@renderer/assets/emulation/wii.png";

// Official emulator logos, bundled locally (downloaded from each project's
// GitHub repo) so they always render — no runtime hotlinking, CSP issues or
// 403s. They're forced to white via CSS so they read on the dark cards.
import duckstationLogo from "@renderer/assets/emulation/logos/duckstation.png";
import pcsx2Logo from "@renderer/assets/emulation/logos/pcsx2.svg?url";
import rpcs3Logo from "@renderer/assets/emulation/logos/rpcs3.svg?url";
import ppssppLogo from "@renderer/assets/emulation/logos/ppsspp.png";
import azaharLogo from "@renderer/assets/emulation/logos/azahar.svg?url";
import cemuLogo from "@renderer/assets/emulation/logos/cemu.png";
import dolphinLogo from "@renderer/assets/emulation/logos/dolphin.png";
import raLogo from "@renderer/assets/emulation/logos/retroachievements.svg?url";

import "./onboarding-emulators.scss";

/**
 * Bundled emulator logos. If a logo somehow fails to load, `EmulatorLogo`
 * falls back to a clean white text wordmark so the card never shows a broken
 * image. The RA cores (RALibretro/RAProject64/RAVBA) share the
 * RetroAchievements logo.
 */
const EMULATOR_LOGOS: Record<EmulatorBinary, string | undefined> = {
  duckstation: duckstationLogo,
  pcsx2: pcsx2Logo,
  rpcs3: rpcs3Logo,
  ppsspp: ppssppLogo,
  azahar: azaharLogo,
  ralibretro: raLogo,
  raproject64: raLogo,
  ravba: raLogo,
  cemu: cemuLogo,
  dolphin: dolphinLogo,
};

function EmulatorLogo({
  binary,
  name,
  className,
}: Readonly<{ binary: EmulatorBinary; name: string; className?: string }>) {
  const src = EMULATOR_LOGOS[binary];
  const [failed, setFailed] = useState(!src);

  if (failed || !src) {
    return (
      <span className={`onboarding-emu-card__wordmark ${className ?? ""}`}>
        {name}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

interface EmulatorSetup {
  binary: EmulatorBinary;
  name: string;
  systems: EmulatorSystem[];
  consoleLabel: string;
  art: string;
  hasRetroAchievements: boolean;
}

/** One entry per emulator binary; a single install covers all its systems. */
const EMULATORS: EmulatorSetup[] = [
  {
    // One RALibretro install serves all six of these consoles (it's downloaded
    // and pre-set-up with the bundled cores + configs automatically).
    binary: "ralibretro",
    name: "RALibretro",
    systems: ["ps1", "n64", "psp", "nds", "dsi", "gba"],
    consoleLabel: "PS1 · N64 · PSP · DS · DSi · GBA",
    art: raLogo,
    hasRetroAchievements: true,
  },
  {
    binary: "pcsx2",
    name: "PCSX2",
    systems: ["ps2"],
    consoleLabel: "PlayStation 2",
    art: ps2Art,
    hasRetroAchievements: false,
  },
  {
    binary: "rpcs3",
    name: "RPCS3",
    systems: ["ps3"],
    consoleLabel: "PlayStation 3",
    art: ps3Art,
    hasRetroAchievements: false,
  },
  {
    binary: "azahar",
    name: "Azahar",
    systems: ["n3ds"],
    consoleLabel: "Nintendo 3DS",
    art: n3dsArt,
    hasRetroAchievements: false,
  },
  {
    binary: "ravba",
    name: "RAVBA",
    systems: ["gb", "gbc"],
    consoleLabel: "Game Boy / Color",
    art: gbArt,
    hasRetroAchievements: true,
  },
  {
    binary: "cemu",
    name: "Cemu",
    systems: ["wiiu"],
    consoleLabel: "Wii U",
    art: wiiuArt,
    hasRetroAchievements: false,
  },
  {
    binary: "dolphin",
    name: "Dolphin",
    systems: ["wii", "gc"],
    consoleLabel: "Wii / GameCube",
    art: wiiArt,
    hasRetroAchievements: true,
  },
];

function pickRecommended(
  options: ResolvedInstallOption[]
): ResolvedInstallOption | null {
  return (
    options.find((o) => o.kind !== "link" && o.channel === "release") ??
    options.find((o) => o.kind !== "link") ??
    null
  );
}

export function OnboardingEmulators() {
  const [configs, setConfigs] = useState<EmulatorConfigMap | null>(null);
  const [progress, setProgress] = useState<
    Record<string, EmulatorInstallProgress>
  >({});
  const [installedBinaries, setInstalledBinaries] = useState<
    Set<EmulatorBinary>
  >(new Set());
  const [activeBinary, setActiveBinary] = useState<EmulatorBinary | null>(null);
  const optionsCache = useRef<Record<string, ResolvedInstallOption[]>>({});
  const busyRef = useRef(false);

  useEffect(() => {
    window.electron
      .getEmulatorConfigs()
      .then(setConfigs)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = window.electron.onEmulatorInstallProgress((payload) => {
      setProgress((prev) => ({ ...prev, [payload.binary]: payload }));
      if (payload.phase === "done") {
        setInstalledBinaries((prev) => new Set(prev).add(payload.binary));
      }
    });
    return unsub;
  }, []);

  const isInstalled = (emu: EmulatorSetup): boolean => {
    if (installedBinaries.has(emu.binary)) return true;
    if (!configs) return false;
    return emu.systems.some((s) => Boolean(configs[s]?.executablePath));
  };

  const installOne = async (emu: EmulatorSetup): Promise<void> => {
    let options = optionsCache.current[emu.binary];
    if (!options) {
      options = await window.electron
        .getEmulatorInstallOptions(emu.binary)
        .catch(() => [] as ResolvedInstallOption[]);
      optionsCache.current[emu.binary] = options;
    }

    const recommended = pickRecommended(options);
    if (!recommended) {
      // No directly installable asset (e.g. Dolphin) — open the download page.
      const link = options.find((o) => o.kind === "link" && o.linkUrl);
      if (link?.linkUrl) window.electron.openExternal(link.linkUrl);
      return;
    }

    setProgress((prev) => ({
      ...prev,
      [emu.binary]: {
        binary: emu.binary,
        optionId: recommended.id,
        phase: "downloading",
      },
    }));
    await window.electron.installEmulator(emu.binary, recommended.id);
  };

  const handleInstall = async (emu: EmulatorSetup): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setActiveBinary(emu.binary);
    try {
      await installOne(emu);
    } catch {
      setProgress((prev) => ({
        ...prev,
        [emu.binary]: {
          binary: emu.binary,
          optionId: "",
          phase: "error",
        },
      }));
    } finally {
      busyRef.current = false;
      setActiveBinary(null);
    }
  };

  const handleInstallAll = async (): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      for (const emu of EMULATORS) {
        if (isInstalled(emu)) continue;
        setActiveBinary(emu.binary);
        try {
          await installOne(emu);
        } catch {
          setProgress((prev) => ({
            ...prev,
            [emu.binary]: {
              binary: emu.binary,
              optionId: "",
              phase: "error",
            },
          }));
        }
      }
    } finally {
      busyRef.current = false;
      setActiveBinary(null);
    }
  };

  const actionLabel = (emu: EmulatorSetup): string => {
    const current = progress[emu.binary];
    if (activeBinary === emu.binary && current) {
      if (current.phase === "downloading") {
        const percent =
          current.total && current.total > 0
            ? Math.floor(((current.loaded ?? 0) / current.total) * 100)
            : 0;
        return percent > 0 ? `Downloading ${percent}%` : "Downloading…";
      }
      if (current.phase === "extracting") return "Extracting…";
      if (current.phase === "running") return "Finishing…";
    }
    if (current?.phase === "error") return "Retry";
    return "Install";
  };

  const remaining = EMULATORS.filter((e) => !isInstalled(e)).length;

  return (
    <div className="onboarding-emulators">
      <div className="onboarding-emulators__topbar">
        <p className="onboarding-emulators__count">
          {remaining === 0
            ? "All emulators are set up."
            : `${remaining} emulator${remaining !== 1 ? "s" : ""} left to install`}
        </p>
        <Button
          type="button"
          theme="outline"
          onClick={handleInstallAll}
          disabled={Boolean(activeBinary) || remaining === 0}
        >
          <DownloadIcon size={14} />
          {activeBinary ? "Installing…" : "Set up all"}
        </Button>
      </div>

      <div className="onboarding-emulators__grid">
        {EMULATORS.map((emu) => {
          const installed = isInstalled(emu);
          const isActive = activeBinary === emu.binary;
          return (
            <div
              key={emu.binary}
              className={`onboarding-emu-card${installed ? " onboarding-emu-card--done" : ""}`}
            >
              <div className="onboarding-emu-card__logos">
                <img
                  src={gamehubIcon}
                  alt="GameHub"
                  className="onboarding-emu-card__gamehub"
                />
                <span className="onboarding-emu-card__x">×</span>
                <EmulatorLogo
                  binary={emu.binary}
                  name={emu.name}
                  className="onboarding-emu-card__emu"
                />
                <span className="onboarding-emu-card__x">×</span>
                <img
                  src={emu.art}
                  alt={emu.consoleLabel}
                  className="onboarding-emu-card__platform"
                />
              </div>

              <div className="onboarding-emu-card__info">
                <span className="onboarding-emu-card__name">{emu.name}</span>
                <span className="onboarding-emu-card__console">
                  {emu.consoleLabel}
                </span>
                {emu.hasRetroAchievements && (
                  <span className="onboarding-emu-card__ra">
                    RetroAchievements
                  </span>
                )}
              </div>

              <div className="onboarding-emu-card__action">
                {installed ? (
                  <span className="onboarding-emu-card__installed">
                    <CheckCircleFillIcon size={14} />
                    Installed
                  </span>
                ) : (
                  <Button
                    type="button"
                    onClick={() => handleInstall(emu)}
                    disabled={Boolean(activeBinary) && !isActive}
                  >
                    {actionLabel(emu)}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
