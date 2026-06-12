import { useState, useCallback, useEffect } from "react";
import { EpicAuthModal } from "@renderer/pages/settings/epic-auth-modal";
import { GogAuthModal } from "@renderer/pages/settings/gog-auth-modal";
import { useTranslation } from "react-i18next";
import {
  Button,
  TextField,
  ScanApprovalModal,
  type ScannedGame,
} from "@renderer/components";
import { useAppSelector } from "@renderer/hooks";
import {
  CheckCircleFillIcon,
  PersonIcon,
  LinkExternalIcon,
  BellIcon,
  GearIcon,
  FileDirectoryIcon,
  SearchIcon,
} from "@primer/octicons-react";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import EpicLogo from "@renderer/assets/epic-logo.svg?react";
import GogLogo from "@renderer/assets/gog-logo.svg?react";
import XboxLogo from "@renderer/assets/xbox-logo.svg?react";
import RiotLogo from "@renderer/assets/riot-logo.svg?react";
import UbisoftLogo from "@renderer/assets/ubisoft-logo.svg?react";
import EaLogo from "@renderer/assets/ea-logo.svg?react";
import LudusaviIcon from "@renderer/assets/ludusavi-icon.svg?react";
import PlayniteIcon from "@renderer/assets/playnite-icon.svg?react";
import gamehubIcon from "@renderer/assets/icons/gamehub.png";
import { AuthPage } from "@shared";
import { orderBy } from "lodash-es";
import languageResources from "@locales";
import "./onboarding.scss";

type StepId =
  | "welcome"
  | "language"
  | "install-path"
  | "account"
  | "integrations-select"
  | "steam"
  | "epic"
  | "gog"
  | "xbox"
  | "riot"
  | "ubisoft"
  | "ea"
  | "tools"
  | "notifications"
  | "startup"
  | "done";

const ALL_STEPS: StepId[] = [
  "welcome",
  "language",
  "install-path",
  "account",
  "integrations-select",
  "steam",
  "epic",
  "gog",
  "xbox",
  "riot",
  "ubisoft",
  "ea",
  "tools",
  "notifications",
  "startup",
  "done",
];

const NAV_STEPS: StepId[] = [
  "language",
  "install-path",
  "account",
  "integrations-select",
  "steam",
  "epic",
  "gog",
  "xbox",
  "riot",
  "ubisoft",
  "ea",
  "tools",
  "notifications",
  "startup",
];

const STEP_LABELS: Record<StepId, string> = {
  welcome: "Welcome",
  language: "Language",
  "install-path": "Install Path",
  account: "Account",
  "integrations-select": "Platforms",
  steam: "Steam",
  epic: "Epic Games",
  gog: "GOG",
  xbox: "Xbox",
  riot: "Riot Games",
  ubisoft: "Ubisoft Connect",
  ea: "EA app",
  tools: "Tools",
  notifications: "Notifications",
  startup: "Startup",
  done: "Done",
};

const PLATFORM_STEPS: StepId[] = [
  "steam",
  "epic",
  "gog",
  "xbox",
  "riot",
  "ubisoft",
  "ea",
];

interface OnboardingProps {
  onComplete: () => void;
}

function parseSteamId(input: string): string {
  const trimmed = input.trim();
  const profileMatch = trimmed.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  if (profileMatch) return profileMatch[1];
  if (/^\d{15,18}$/.test(trimmed)) return trimmed;
  return trimmed;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const { t: _t, i18n } = useTranslation("settings");
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  useEffect(() => {
    window.electron.setWindowSize(960, 680, 960, 680).catch(() => {});
    return () => {
      window.electron.setWindowSize(1200, 860, 1024, 860).catch(() => {});
    };
  }, []);

  const [stepIndex, setStepIndex] = useState(0);

  const languageOptions = orderBy(
    Object.entries(languageResources).map(([option, value]) => ({
      option,
      nativeName: value.language_name as string,
    })),
    "nativeName"
  );
  const [selectedLanguage, setSelectedLanguage] = useState(
    userPreferences?.language ?? "en"
  );

  const [installPath, setInstallPath] = useState("");
  const [defaultInstallPath, setDefaultInstallPath] = useState("");

  const [accountWindowOpen, setAccountWindowOpen] = useState(false);
  const [accountLinked, setAccountLinked] = useState(false);

  const [selectedIntegrations, setSelectedIntegrations] = useState<Set<string>>(
    new Set()
  );

  const [steamInput, setSteamInput] = useState("");
  const [steamApiKey, setSteamApiKey] = useState("");
  const [steamLinked, setSteamLinked] = useState(false);
  const [steamBusy, setSteamBusy] = useState(false);
  const [steamError, setSteamError] = useState("");
  const [steamOpenIdBusy, setSteamOpenIdBusy] = useState(false);
  const [steamProfile, setSteamProfile] = useState<{
    personaname: string;
    avatarfull: string;
  } | null>(null);

  const [epicModalOpen, setEpicModalOpen] = useState(false);
  const [epicLinked, setEpicLinked] = useState(false);
  const [epicAccount, setEpicAccount] = useState<string | null>(null);

  const [gogBusy, _setGogBusy] = useState(false);
  const [gogModalOpen, setGogModalOpen] = useState(false);
  const [gogLinked, setGogLinked] = useState(false);
  const [gogUsername, setGogUsername] = useState<string | null>(null);

  const [xboxBusy, setXboxBusy] = useState(false);
  const [xboxWindowOpen, setXboxWindowOpen] = useState(false);
  const [xboxLinked, setXboxLinked] = useState(!!userPreferences?.xboxGamertag);
  const [xboxGamertag, setXboxGamertag] = useState(
    userPreferences?.xboxGamertag ?? null
  );

  const [riotState, setRiotState] = useState<{
    installed: boolean;
    detected: Array<{ productId: string; title: string }>;
  } | null>(null);
  const [riotBusy, setRiotBusy] = useState(false);
  const [riotResult, setRiotResult] = useState("");

  const [ubisoftState, setUbisoftState] = useState<{
    installed: boolean;
    detected: Array<{ installId: string; title: string }>;
  } | null>(null);
  const [ubisoftBusy, setUbisoftBusy] = useState(false);
  const [ubisoftResult, setUbisoftResult] = useState("");

  const [eaState, setEaState] = useState<{
    installed: boolean;
    detected: Array<{ offerId: string | null; title: string }>;
  } | null>(null);
  const [eaBusy, setEaBusy] = useState(false);
  const [eaResult, setEaResult] = useState("");

  // Tools step state
  const [ludusaviResult, setLudusaviResult] = useState<string>("");
  const [ludusaviBusy, setLudusaviBusy] = useState(false);
  const [scanResult, setScanResult] = useState<string>("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanProgress, setScanProgress] = useState<{
    scanned: number;
    total: number;
    foundCount: number;
    currentTitle: string;
  } | null>(null);
  const [scanCandidates, setScanCandidates] = useState<ScannedGame[]>([]);
  const [showScanApproval, setShowScanApproval] = useState(false);
  const [playniteResult, setPlayniteResult] = useState<string>("");
  const [playniteBusy, setPlayniteBusy] = useState(false);
  const [playniteDetectedPath, setPlayniteDetectedPath] = useState<
    string | null
  >(null);

  const [downloadNotifs, setDownloadNotifs] = useState(true);
  const [achievementNotifs, setAchievementNotifs] = useState(true);
  const [startMinimized, setStartMinimized] = useState(false);

  const currentStep = ALL_STEPS[stepIndex];

  useEffect(() => {
    window.electron.getDefaultDownloadsPath().then((p) => {
      setDefaultInstallPath(p);
      setInstallPath((prev) => prev || p);
    });
  }, []);

  useEffect(() => {
    if (!accountWindowOpen) return;
    const unsub = window.electron.onSignIn(() => {
      setAccountLinked(true);
      setAccountWindowOpen(false);
      setStepIndex(ALL_STEPS.indexOf("integrations-select"));
    });
    return unsub;
  }, [accountWindowOpen]);

  const getNextStep = useCallback(
    (from: StepId): StepId => {
      if (from === "account") return "integrations-select";
      if (from === "integrations-select") {
        const firstSelected = PLATFORM_STEPS.find((s) =>
          selectedIntegrations.has(s)
        );
        return (firstSelected as StepId) ?? "tools";
      }
      if (PLATFORM_STEPS.includes(from)) {
        const remaining = PLATFORM_STEPS.filter((s) =>
          selectedIntegrations.has(s)
        );
        const idx = remaining.indexOf(from);
        if (idx >= 0 && idx < remaining.length - 1)
          return remaining[idx + 1] as StepId;
        return "tools";
      }
      if (from === "tools") return "notifications";
      // Default linear progression for other steps
      const idx = ALL_STEPS.indexOf(from);
      return ALL_STEPS[idx + 1] as StepId;
    },
    [selectedIntegrations]
  );

  const next = useCallback(() => {
    setStepIndex((i) => {
      const current = ALL_STEPS[i];
      const nextStep = getNextStep(current);
      return ALL_STEPS.indexOf(nextStep);
    });
  }, [getNextStep]);

  const finish = useCallback(async () => {
    await window.electron.updateUserPreferences({
      onboardingComplete: true,
      downloadNotificationsEnabled: downloadNotifs,
      achievementNotificationsEnabled: achievementNotifs,
      startMinimized,
    });
    onComplete();
  }, [onComplete, downloadNotifs, achievementNotifs, startMinimized]);

  const handleLanguageSave = async () => {
    await window.electron.updateUserPreferences({ language: selectedLanguage });
    i18n.changeLanguage(selectedLanguage);
    next();
  };

  const handleInstallPathSave = async () => {
    const path = installPath.trim() || defaultInstallPath;
    await window.electron.updateUserPreferences({ downloadsPath: path });
    next();
  };

  const handlePickFolder = async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result && !result.canceled && result.filePaths[0]) {
      setInstallPath(result.filePaths[0]);
    }
  };

  const handleAccountSignIn = () => {
    setAccountWindowOpen(true);
    window.electron.openAuthWindow(AuthPage.SignIn);
  };

  const toggleIntegration = (platform: string) => {
    setSelectedIntegrations((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) {
        next.delete(platform);
      } else {
        next.add(platform);
      }
      return next;
    });
  };

  const handleSteamOpenIdConnect = async () => {
    setSteamOpenIdBusy(true);
    setSteamError("");
    try {
      const detectedId = await window.electron.startSteamOpenIdLogin();
      const summary = await window.electron
        .getSteamPlayerSummary(detectedId, undefined)
        .catch(() => null);
      await window.electron.updateUserPreferences({ steamId: detectedId });
      if (summary) setSteamProfile(summary);
      setSteamLinked(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSteamError(msg || "Steam login failed.");
    } finally {
      setSteamOpenIdBusy(false);
    }
  };

  const handleSteamConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setSteamError("");
    const steamId = parseSteamId(steamInput);
    if (!steamId) return;
    setSteamBusy(true);
    try {
      const summary = await window.electron.getSteamPlayerSummary(
        steamId,
        steamApiKey.trim() || undefined
      );
      if (!summary) {
        setSteamError("Steam account not found. Check your Steam ID.");
        return;
      }
      await window.electron.updateUserPreferences({
        steamId,
        steamApiKey: steamApiKey.trim() || undefined,
      });
      if (summary) setSteamProfile(summary);
      setSteamLinked(true);
    } catch {
      setSteamError("Could not connect to Steam. Verify your credentials.");
    } finally {
      setSteamBusy(false);
    }
  };

  const handleEpicConnect = () => {
    setEpicModalOpen(true);
  };

  const handleEpicAuthResult = useCallback(
    (result: { success: boolean; account?: string }) => {
      if (result.success) {
        setEpicLinked(true);
        setEpicAccount(result.account ?? "Epic");
        window.electron.syncEpicLibrary().catch(() => {});
      }
    },
    []
  );

  const handleGogConnect = () => {
    setGogModalOpen(true);
  };

  const handleGogAuthResult = useCallback(
    async (result: { refresh_token: string; username: string } | null) => {
      if (!result) return;
      await window.electron.updateUserPreferences({
        gogRefreshToken: result.refresh_token,
      });
      setGogLinked(true);
      setGogUsername(result.username ?? "GOG User");
      const gogdlStatus = await window.electron
        .getGogdlStatus()
        .catch(() => ({ binaryFound: false }));
      if (!gogdlStatus.binaryFound)
        window.electron.installGogdl().catch(() => {});
      window.electron.syncGogLibrary().catch(() => {});
    },
    []
  );

  const handleXboxConnect = async () => {
    setXboxBusy(true);
    try {
      setXboxWindowOpen(true);
      const result = await window.electron.openXboxAuthWindow();
      setXboxWindowOpen(false);
      if (result?.success) {
        setXboxLinked(true);
        setXboxGamertag(result.gamertag ?? "Xbox User");
      }
    } catch {
      setXboxWindowOpen(false);
    } finally {
      setXboxBusy(false);
    }
  };

  useEffect(() => {
    if (currentStep === "riot" && !riotState) {
      window.electron
        .getRiotGames()
        .then((res) => setRiotState(res))
        .catch(() => setRiotState({ installed: false, detected: [] }));
    }
    if (currentStep === "ubisoft" && !ubisoftState) {
      window.electron
        .getUbisoftGames()
        .then((res) => setUbisoftState(res))
        .catch(() => setUbisoftState({ installed: false, detected: [] }));
    }
    if (currentStep === "ea" && !eaState) {
      window.electron
        .getEaGames()
        .then((res) => setEaState(res))
        .catch(() => setEaState({ installed: false, detected: [] }));
    }
  }, [currentStep, riotState, ubisoftState, eaState]);

  const handleAddRiotGames = async () => {
    if (!riotState) return;
    setRiotBusy(true);
    try {
      const result = await window.electron.addRiotGamesToLibrary(
        riotState.detected.map((g) => g.productId)
      );
      setRiotResult(
        `Added ${result.added} game${result.added !== 1 ? "s" : ""} to your library.`
      );
    } catch {
      setRiotResult("Failed to add Riot games.");
    } finally {
      setRiotBusy(false);
    }
  };

  const handleAddUbisoftGames = async () => {
    if (!ubisoftState) return;
    setUbisoftBusy(true);
    try {
      const result = await window.electron.addUbisoftGamesToLibrary(
        ubisoftState.detected.map((g) => g.installId)
      );
      setUbisoftResult(
        `Added ${result.added} game${result.added !== 1 ? "s" : ""} to your library.`
      );
    } catch {
      setUbisoftResult("Failed to add Ubisoft games.");
    } finally {
      setUbisoftBusy(false);
    }
  };

  const handleAddEaGames = async () => {
    if (!eaState) return;
    setEaBusy(true);
    try {
      const result = await window.electron.addEaGamesToLibrary(
        eaState.detected.map((g) => g.title)
      );
      setEaResult(
        `Added ${result.added} game${result.added !== 1 ? "s" : ""} to your library.`
      );
    } catch {
      setEaResult("Failed to add EA games.");
    } finally {
      setEaBusy(false);
    }
  };

  const handleLudusaviImport = async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Ludusavi Backup Folder",
    });
    if (!result || result.canceled || !result.filePaths[0]) return;
    const folderPath = result.filePaths[0];
    setLudusaviBusy(true);
    setLudusaviResult("");
    try {
      const entries =
        await window.electron.scanLudusaviBackupFolder(folderPath);
      if (entries.length === 0) {
        setLudusaviResult(
          "No valid Ludusavi backups found. Pick the root backup directory (the one containing per-game subfolders)."
        );
        return;
      }

      let imported = 0;
      let failed = 0;
      for (const entry of entries) {
        setLudusaviResult(
          `Uploading ${imported + failed + 1}/${entries.length}: ${entry.gameName}…`
        );
        try {
          // Match the backup to a library game so the save lands on the right page
          const match = await window.electron
            .findLibraryGameByTitle(entry.gameName)
            .catch(() => null);
          await window.electron.importLudusaviBackup(
            entry.folderPath,
            entry.gameName,
            match?.objectId ?? entry.gameName,
            match?.shop ?? "steam"
          );
          imported++;
        } catch {
          failed++;
        }
      }

      setLudusaviResult(
        failed === 0
          ? `Imported ${imported} save backup${imported !== 1 ? "s" : ""} to GameHub Cloud.`
          : `Imported ${imported} of ${entries.length} backups (${failed} failed).`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLudusaviResult(msg || "Import failed.");
    } finally {
      setLudusaviBusy(false);
    }
  };

  useEffect(() => {
    const unsubscribe = window.electron.onScanProgress((progress) => {
      setScanProgress(progress);
    });
    return unsubscribe;
  }, []);

  const handleDeepScan = async () => {
    setScanBusy(true);
    setScanResult("");
    setScanProgress(null);
    try {
      const result = await window.electron.scanInstalledGames(true);
      if (result.foundGames.length === 0) {
        setScanResult(
          `Scan complete — no new games found (${result.total} checked).`
        );
      } else {
        setScanCandidates(result.foundGames);
        setShowScanApproval(true);
      }
    } catch {
      setScanResult("Scan failed.");
    } finally {
      setScanBusy(false);
      setScanProgress(null);
    }
  };

  const handleSelectiveScan = async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (!result || result.canceled || !result.filePaths[0]) return;
    setScanBusy(true);
    setScanResult("");
    setScanProgress(null);
    try {
      const scanRes = await window.electron.selectiveScanInstalledGames(
        result.filePaths,
        true
      );
      if (scanRes.foundGames.length === 0) {
        setScanResult(
          `Scan complete — no new games found (${scanRes.total} checked).`
        );
      } else {
        setScanCandidates(scanRes.foundGames);
        setShowScanApproval(true);
      }
    } catch {
      setScanResult("Scan failed.");
    } finally {
      setScanBusy(false);
      setScanProgress(null);
    }
  };

  const handleScanConfirm = async (approved: ScannedGame[]) => {
    setShowScanApproval(false);
    try {
      await window.electron.confirmScanGames(approved);
      setScanResult(
        approved.length === 0
          ? "No games added."
          : `Added ${approved.length} game${approved.length !== 1 ? "s" : ""} to library.`
      );
    } catch {
      setScanResult("Failed to save scan results.");
    }
  };

  const handlePlayniteImport = async (dbPath?: string) => {
    setPlayniteBusy(true);
    setPlayniteResult("");
    try {
      const result = await window.electron.importPlaynitePlaytime(dbPath);
      if (result.detectedPath && !playniteDetectedPath) {
        setPlayniteDetectedPath(result.detectedPath);
      }
      if (result.matched === 0) {
        setPlayniteResult(
          result.total === 0
            ? "No Playnite games with playtime found."
            : `No matching games found (${result.total} Playnite games scanned).`
        );
      } else {
        setPlayniteResult(
          `Imported playtime for ${result.matched} game${result.matched !== 1 ? "s" : ""}.`
        );
      }
    } catch {
      setPlayniteResult("Import failed.");
    } finally {
      setPlayniteBusy(false);
    }
  };

  const handlePickPlayniteDb = async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "LiteDB", extensions: ["db"] }],
    });
    if (!result || result.canceled || !result.filePaths[0]) return;
    handlePlayniteImport(result.filePaths[0]);
  };

  const isWelcome = currentStep === "welcome";
  const isDone = currentStep === "done";
  const showSidebar = !isWelcome && !isDone;

  const navStepIsDone = (s: StepId) =>
    NAV_STEPS.indexOf(s) < NAV_STEPS.indexOf(currentStep as StepId);
  const navStepIsActive = (s: StepId) => currentStep === s;

  if (isWelcome || isDone) {
    return (
      <div className="onboarding-overlay">
        <div className="onboarding-splash">
          <img
            src={gamehubIcon}
            alt="GameHub"
            className="onboarding-splash__logo"
          />
          {isWelcome ? (
            <>
              <h1>Welcome to GameHub</h1>
              <p>
                Your all-in-one game launcher. Let&apos;s get you set up in just
                a few steps — you can change everything later in Settings.
              </p>
              <Button type="button" onClick={next}>
                Get Started
              </Button>
            </>
          ) : (
            <>
              <h1>You&apos;re all set!</h1>
              <p>
                Your libraries will sync in the background. Connect more
                services anytime from <strong>Settings → Integrations</strong>.
              </p>
              <Button type="button" onClick={finish}>
                Launch GameHub
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-layout">
        {/* ── Left sidebar ── */}
        {showSidebar && (
          <aside className="onboarding-sidebar">
            <div className="onboarding-sidebar__brand">
              <img
                src={gamehubIcon}
                alt="GameHub"
                className="onboarding-sidebar__logo"
              />
              <h2 className="onboarding-sidebar__app-name">GameHub</h2>
              <p className="onboarding-sidebar__tagline">
                Your all-in-one game launcher
              </p>
            </div>

            <nav className="onboarding-sidebar__nav">
              <div className="onboarding-sidebar__section-label">Setup</div>
              {(["language", "install-path", "account"] as StepId[]).map(
                (s) => (
                  <div
                    key={s}
                    className={[
                      "onboarding-nav-item",
                      navStepIsActive(s) ? "onboarding-nav-item--active" : "",
                      navStepIsDone(s) ? "onboarding-nav-item--done" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className="onboarding-nav-item__dot">
                      {navStepIsDone(s) ? "✓" : ""}
                    </span>
                    <span className="onboarding-nav-item__label">
                      {STEP_LABELS[s]}
                    </span>
                  </div>
                )
              )}

              <div className="onboarding-sidebar__section-label">Platforms</div>
              <div
                className={[
                  "onboarding-nav-item",
                  navStepIsActive("integrations-select")
                    ? "onboarding-nav-item--active"
                    : "",
                  navStepIsDone("integrations-select")
                    ? "onboarding-nav-item--done"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="onboarding-nav-item__dot">
                  {navStepIsDone("integrations-select") ? "✓" : ""}
                </span>
                <span className="onboarding-nav-item__label">
                  {STEP_LABELS["integrations-select"]}
                </span>
              </div>
              {(
                [
                  "steam",
                  "epic",
                  "gog",
                  "xbox",
                  "riot",
                  "ubisoft",
                  "ea",
                ] as StepId[]
              ).map((s) => {
                const PlatformIcon = {
                  steam: SteamLogo,
                  epic: EpicLogo,
                  gog: GogLogo,
                  xbox: XboxLogo,
                  riot: RiotLogo,
                  ubisoft: UbisoftLogo,
                  ea: EaLogo,
                }[s];
                const isSelected = selectedIntegrations.has(s);
                return (
                  <div
                    key={s}
                    className={[
                      "onboarding-nav-item",
                      navStepIsActive(s) ? "onboarding-nav-item--active" : "",
                      navStepIsDone(s) ? "onboarding-nav-item--done" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={!isSelected ? { opacity: 0.4 } : undefined}
                  >
                    <span className="onboarding-nav-item__dot">
                      {navStepIsDone(s) ? "✓" : ""}
                    </span>
                    <span className="onboarding-nav-item__label">
                      {STEP_LABELS[s]}
                    </span>
                    <PlatformIcon className="onboarding-nav-item__platform-icon" />
                  </div>
                );
              })}

              <div className="onboarding-sidebar__section-label">Tools</div>
              <div
                className={[
                  "onboarding-nav-item",
                  navStepIsActive("tools") ? "onboarding-nav-item--active" : "",
                  navStepIsDone("tools") ? "onboarding-nav-item--done" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="onboarding-nav-item__dot">
                  {navStepIsDone("tools") ? "✓" : ""}
                </span>
                <span className="onboarding-nav-item__label">
                  {STEP_LABELS["tools"]}
                </span>
              </div>

              <div className="onboarding-sidebar__section-label">
                Preferences
              </div>
              {(["notifications", "startup"] as StepId[]).map((s) => (
                <div
                  key={s}
                  className={[
                    "onboarding-nav-item",
                    navStepIsActive(s) ? "onboarding-nav-item--active" : "",
                    navStepIsDone(s) ? "onboarding-nav-item--done" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="onboarding-nav-item__dot">
                    {navStepIsDone(s) ? "✓" : ""}
                  </span>
                  <span className="onboarding-nav-item__label">
                    {STEP_LABELS[s]}
                  </span>
                </div>
              ))}
            </nav>
          </aside>
        )}

        {/* ── Right content ── */}
        <div className="onboarding-content">
          {/* ── Language ── */}
          {currentStep === "language" && (
            <>
              <div className="onboarding-step-header">
                <div className="onboarding-step-header__icon">
                  <GearIcon size={20} />
                </div>
                <div>
                  <h2>Language</h2>
                  <p>Choose the language GameHub should use</p>
                </div>
              </div>
              <div className="onboarding-select-list">
                {languageOptions.map(({ option, nativeName }) => (
                  <button
                    key={option}
                    type="button"
                    className={[
                      "onboarding-select-item",
                      selectedLanguage === option
                        ? "onboarding-select-item--active"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => setSelectedLanguage(option)}
                  >
                    {selectedLanguage === option && (
                      <CheckCircleFillIcon size={14} />
                    )}
                    {nativeName}
                  </button>
                ))}
              </div>
              <div className="onboarding-actions">
                <Button type="button" onClick={handleLanguageSave}>
                  Continue
                </Button>
              </div>
            </>
          )}

          {/* ── Install Path ── */}
          {currentStep === "install-path" && (
            <>
              <div className="onboarding-step-header">
                <div className="onboarding-step-header__icon">
                  <FileDirectoryIcon size={20} />
                </div>
                <div>
                  <h2>Default Install Folder</h2>
                  <p>Where should GameHub download and install games?</p>
                </div>
              </div>
              <p className="onboarding-step-description">
                You can override this per-download later. Leave blank to use the
                default.
              </p>
              <div className="onboarding-path-row">
                <TextField
                  value={installPath}
                  onChange={(e) => setInstallPath(e.target.value)}
                  placeholder={defaultInstallPath}
                />
                <Button
                  type="button"
                  theme="outline"
                  onClick={handlePickFolder}
                >
                  Browse…
                </Button>
              </div>
              <div className="onboarding-actions">
                <button
                  type="button"
                  className="onboarding-skip"
                  onClick={next}
                >
                  Use default
                </button>
                <Button type="button" onClick={handleInstallPathSave}>
                  Continue
                </Button>
              </div>
            </>
          )}

          {/* ── GameHub Account ── */}
          {currentStep === "account" && (
            <>
              <div className="onboarding-step-header">
                <div className="onboarding-step-header__icon">
                  <PersonIcon size={20} />
                </div>
                <div>
                  <h2>GameHub Account</h2>
                  <p>Optional — enables cloud saves and profiles</p>
                </div>
              </div>
              <p className="onboarding-step-description">
                Sign in or create a GameHub account to enable cloud saves,
                profiles, and cross-device sync.
              </p>

              {accountLinked ? (
                <>
                  <div className="onboarding-connected-badge">
                    <CheckCircleFillIcon size={16} />
                    Signed in — you&apos;re all set
                  </div>
                  <div className="onboarding-actions">
                    <Button type="button" onClick={next}>
                      Continue
                    </Button>
                  </div>
                </>
              ) : accountWindowOpen ? (
                <div
                  className="onboarding-actions"
                  style={{ justifyContent: "center" }}
                >
                  <span style={{ opacity: 0.6, fontSize: "0.9rem" }}>
                    Waiting for sign-in…
                  </span>
                </div>
              ) : (
                <div className="onboarding-actions">
                  <button
                    type="button"
                    className="onboarding-skip"
                    onClick={next}
                  >
                    Skip — use without account
                  </button>
                  <Button type="button" onClick={handleAccountSignIn}>
                    <PersonIcon size={14} />
                    Sign in / Register
                  </Button>
                </div>
              )}
            </>
          )}

          {/* ── Integrations Select ── */}
          {currentStep === "integrations-select" && (
            <>
              <div className="onboarding-step-header">
                <div className="onboarding-step-header__icon">
                  <GearIcon size={20} />
                </div>
                <div>
                  <h2>Connect Platforms</h2>
                  <p>Select the platforms you want to set up</p>
                </div>
              </div>
              <p className="onboarding-step-description">
                Choose which platforms to connect. You can set up each one in
                the next steps, or skip all to continue.
              </p>
              <div className="onboarding-integrations-grid">
                {(
                  [
                    { id: "steam", name: "Steam", Icon: SteamLogo },
                    { id: "epic", name: "Epic Games", Icon: EpicLogo },
                    { id: "gog", name: "GOG", Icon: GogLogo },
                    { id: "xbox", name: "Xbox", Icon: XboxLogo },
                    { id: "riot", name: "Riot Games", Icon: RiotLogo },
                    {
                      id: "ubisoft",
                      name: "Ubisoft Connect",
                      Icon: UbisoftLogo,
                    },
                    { id: "ea", name: "EA app", Icon: EaLogo },
                  ] as const
                ).map(({ id, name, Icon }) => {
                  const isSelected = selectedIntegrations.has(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={[
                        "onboarding-integration-card",
                        isSelected
                          ? "onboarding-integration-card--selected"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => toggleIntegration(id)}
                    >
                      <Icon className="onboarding-integration-card__icon" />
                      <span className="onboarding-integration-card__name">
                        {name}
                      </span>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleIntegration(id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ pointerEvents: "none" }}
                      />
                    </button>
                  );
                })}
              </div>
              <div className="onboarding-actions">
                <button
                  type="button"
                  className="onboarding-skip"
                  onClick={() => setStepIndex(ALL_STEPS.indexOf("tools"))}
                >
                  Skip All
                </button>
                <Button type="button" onClick={next}>
                  {selectedIntegrations.size > 0
                    ? "Set Up Selected"
                    : "Continue"}
                </Button>
              </div>
            </>
          )}

          {/* ── Steam ── */}
          {currentStep === "steam" && (
            <>
              <div className="onboarding-step-header">
                <div className="onboarding-step-header__icon">
                  <SteamLogo style={{ width: 20, height: 20 }} />
                </div>
                <div>
                  <h2>Steam</h2>
                  <p>
                    Import your Steam library and enable achievement tracking
                  </p>
                </div>
              </div>

              {steamLinked ? (
                <>
                  {steamProfile ? (
                    <div
                      className="onboarding-connected-badge"
                      style={{ gap: "10px" }}
                    >
                      <img
                        src={steamProfile.avatarfull}
                        alt={steamProfile.personaname}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          flexShrink: 0,
                        }}
                      />
                      <div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <CheckCircleFillIcon size={14} />
                          <strong>{steamProfile.personaname}</strong>
                        </div>
                        <small style={{ opacity: 0.6 }}>
                          Steam connected — library will sync
                        </small>
                      </div>
                    </div>
                  ) : (
                    <div className="onboarding-connected-badge">
                      <CheckCircleFillIcon size={16} />
                      Steam connected — library will sync
                    </div>
                  )}
                  <div className="onboarding-actions">
                    <Button type="button" onClick={next}>
                      Continue
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div
                    className="onboarding-actions"
                    style={{ justifyContent: "flex-start", marginTop: 0 }}
                  >
                    <Button
                      type="button"
                      onClick={handleSteamOpenIdConnect}
                      disabled={steamOpenIdBusy}
                      style={{
                        background: "#1b2838",
                        color: "#c7d5e0",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <SteamLogo style={{ width: 18, height: 18 }} />
                      {steamOpenIdBusy
                        ? "Opening Steam…"
                        : "Sign in with Steam"}
                    </Button>
                  </div>

                  <div className="onboarding-divider">or enter manually</div>

                  <form
                    className="onboarding-form"
                    onSubmit={handleSteamConnect}
                  >
                    <TextField
                      label="Steam Profile URL or ID"
                      value={steamInput}
                      onChange={(e) => setSteamInput(e.target.value)}
                      placeholder="https://steamcommunity.com/profiles/76561198…"
                      hint="Paste your full profile URL — we'll extract the ID automatically"
                    />

                    <TextField
                      label="Steam Web API Key (optional)"
                      value={steamApiKey}
                      onChange={(e) => setSteamApiKey(e.target.value)}
                      type="password"
                      placeholder="32-character API key (optional)"
                      hint={
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          Only needed for achievement tracking.{" "}
                          <button
                            type="button"
                            className="onboarding-link"
                            onClick={() =>
                              window.electron.openExternal(
                                "https://steamcommunity.com/dev/apikey"
                              )
                            }
                          >
                            Get key
                            <LinkExternalIcon size={10} />
                          </button>
                        </span>
                      }
                    />

                    {steamError && (
                      <p
                        style={{
                          color: "var(--color-danger, #f87171)",
                          margin: 0,
                          fontSize: "0.85rem",
                        }}
                      >
                        {steamError}
                      </p>
                    )}

                    <div className="onboarding-actions">
                      <button
                        type="button"
                        className="onboarding-skip"
                        onClick={next}
                      >
                        Skip for now
                      </button>
                      <Button
                        type="submit"
                        disabled={!steamInput.trim() || steamBusy}
                      >
                        {steamBusy ? "Connecting…" : "Connect Steam"}
                      </Button>
                    </div>
                  </form>
                </>
              )}
            </>
          )}

          {/* ── Epic ── */}
          {currentStep === "epic" && (
            <>
              <div className="onboarding-step-header">
                <div className="onboarding-step-header__icon">
                  <EpicLogo style={{ width: 20, height: 20 }} />
                </div>
                <div>
                  <h2>Epic Games</h2>
                  <p>Connect via Legendary (open-source CLI)</p>
                </div>
              </div>
              <p className="onboarding-step-description">
                GameHub will install Legendary automatically if needed. Your
                Epic library will sync and you&apos;ll be able to download
                games.
              </p>

              {epicLinked ? (
                <>
                  <div className="onboarding-connected-badge">
                    <CheckCircleFillIcon size={16} />
                    Signed in as {epicAccount}
                  </div>
                  <div className="onboarding-actions">
                    <Button type="button" onClick={next}>
                      Continue
                    </Button>
                  </div>
                </>
              ) : (
                <div className="onboarding-actions">
                  <button
                    type="button"
                    className="onboarding-skip"
                    onClick={next}
                  >
                    Skip for now
                  </button>
                  <Button type="button" onClick={handleEpicConnect}>
                    <PersonIcon size={14} />
                    Connect Epic
                  </Button>
                </div>
              )}
            </>
          )}

          {/* ── GOG ── */}
          {currentStep === "gog" && (
            <>
              <div className="onboarding-step-header">
                <div className="onboarding-step-header__icon">
                  <GogLogo style={{ width: 20, height: 20 }} />
                </div>
                <div>
                  <h2>GOG</h2>
                  <p>Import your DRM-free GOG library</p>
                </div>
              </div>
              <p className="onboarding-step-description">
                Connect your GOG account to import your library and enable
                downloading GOG games directly through GameHub.
              </p>

              {gogLinked ? (
                <>
                  <div className="onboarding-connected-badge">
                    <CheckCircleFillIcon size={16} />
                    Connected as {gogUsername}
                  </div>
                  <div className="onboarding-actions">
                    <Button type="button" onClick={next}>
                      Continue
                    </Button>
                  </div>
                </>
              ) : (
                <div className="onboarding-actions">
                  <button
                    type="button"
                    className="onboarding-skip"
                    onClick={next}
                    disabled={gogBusy}
                  >
                    Skip for now
                  </button>
                  <Button
                    type="button"
                    onClick={handleGogConnect}
                    disabled={gogBusy}
                  >
                    <PersonIcon size={14} />
                    {gogBusy ? "Opening…" : "Connect GOG"}
                  </Button>
                </div>
              )}
            </>
          )}

          {/* ── Xbox ── */}
          {currentStep === "xbox" && (
            <>
              <div className="onboarding-step-header">
                <div className="onboarding-step-header__icon">
                  <XboxLogo style={{ width: 20, height: 20 }} />
                </div>
                <div>
                  <h2>Xbox / Game Pass</h2>
                  <p>Import your Xbox and Game Pass PC library</p>
                </div>
              </div>
              <p className="onboarding-step-description">
                Sign in with your Microsoft account to import your Xbox and Game
                Pass PC library into GameHub.
              </p>

              {xboxLinked ? (
                <>
                  <div className="onboarding-connected-badge">
                    <CheckCircleFillIcon size={16} />
                    Signed in as {xboxGamertag}
                  </div>
                  <div className="onboarding-actions">
                    <Button type="button" onClick={next}>
                      Continue
                    </Button>
                  </div>
                </>
              ) : xboxWindowOpen ? (
                <div
                  className="onboarding-actions"
                  style={{ justifyContent: "center" }}
                >
                  <span style={{ opacity: 0.6, fontSize: "0.9rem" }}>
                    Waiting for sign-in…
                  </span>
                </div>
              ) : (
                <div className="onboarding-actions">
                  <button
                    type="button"
                    className="onboarding-skip"
                    onClick={next}
                    disabled={xboxBusy}
                  >
                    Skip for now
                  </button>
                  <Button
                    type="button"
                    onClick={handleXboxConnect}
                    disabled={xboxBusy}
                  >
                    <PersonIcon size={14} />
                    {xboxBusy ? "Opening…" : "Connect Xbox"}
                  </Button>
                </div>
              )}
            </>
          )}

          {/* ── Riot Games ── */}
          {currentStep === "riot" && (
            <>
              <div className="onboarding-step-header">
                <div className="onboarding-step-header__icon">
                  <RiotLogo style={{ width: 20, height: 20 }} />
                </div>
                <div>
                  <h2>Riot Games</h2>
                  <p>League of Legends, VALORANT, Legends of Runeterra</p>
                </div>
              </div>
              <p className="onboarding-step-description">
                GameHub detects games installed through the Riot Client and adds
                them to your library. They launch through the Riot Client.
              </p>

              {riotState === null ? (
                <p style={{ opacity: 0.6 }}>Detecting Riot Client…</p>
              ) : !riotState.installed ? (
                <p style={{ opacity: 0.7 }}>
                  Riot Client not detected on this machine. You can add Riot
                  games later from Settings → Integrations.
                </p>
              ) : riotState.detected.length === 0 ? (
                <p style={{ opacity: 0.7 }}>
                  Riot Client found, but no installed games were detected.
                </p>
              ) : (
                <p style={{ opacity: 0.8 }}>
                  Detected: {riotState.detected.map((g) => g.title).join(", ")}
                </p>
              )}

              {riotResult && (
                <div className="onboarding-connected-badge">
                  <CheckCircleFillIcon size={16} />
                  {riotResult}
                </div>
              )}

              <div className="onboarding-actions">
                <button
                  type="button"
                  className="onboarding-skip"
                  onClick={next}
                >
                  {riotResult ? "Continue" : "Skip for now"}
                </button>
                {riotState?.installed &&
                  riotState.detected.length > 0 &&
                  !riotResult && (
                    <Button
                      type="button"
                      onClick={handleAddRiotGames}
                      disabled={riotBusy}
                    >
                      {riotBusy
                        ? "Adding…"
                        : `Add ${riotState.detected.length} game${riotState.detected.length !== 1 ? "s" : ""}`}
                    </Button>
                  )}
              </div>
            </>
          )}

          {/* ── Ubisoft Connect ── */}
          {currentStep === "ubisoft" && (
            <>
              <div className="onboarding-step-header">
                <div className="onboarding-step-header__icon">
                  <UbisoftLogo style={{ width: 20, height: 20 }} />
                </div>
                <div>
                  <h2>Ubisoft Connect</h2>
                  <p>Import games installed through Ubisoft Connect</p>
                </div>
              </div>
              <p className="onboarding-step-description">
                GameHub detects games installed through Ubisoft Connect and adds
                them to your library. They launch through the Ubisoft Connect
                client.
              </p>

              {ubisoftState === null ? (
                <p style={{ opacity: 0.6 }}>Detecting Ubisoft Connect…</p>
              ) : !ubisoftState.installed ? (
                <p style={{ opacity: 0.7 }}>
                  Ubisoft Connect not detected on this machine. You can add
                  Ubisoft games later from Settings → Integrations.
                </p>
              ) : ubisoftState.detected.length === 0 ? (
                <p style={{ opacity: 0.7 }}>
                  Ubisoft Connect found, but no installed games were detected.
                </p>
              ) : (
                <p style={{ opacity: 0.8 }}>
                  Detected:{" "}
                  {ubisoftState.detected.map((g) => g.title).join(", ")}
                </p>
              )}

              {ubisoftResult && (
                <div className="onboarding-connected-badge">
                  <CheckCircleFillIcon size={16} />
                  {ubisoftResult}
                </div>
              )}

              <div className="onboarding-actions">
                <button
                  type="button"
                  className="onboarding-skip"
                  onClick={next}
                >
                  {ubisoftResult ? "Continue" : "Skip for now"}
                </button>
                {ubisoftState?.installed &&
                  ubisoftState.detected.length > 0 &&
                  !ubisoftResult && (
                    <Button
                      type="button"
                      onClick={handleAddUbisoftGames}
                      disabled={ubisoftBusy}
                    >
                      {ubisoftBusy
                        ? "Adding…"
                        : `Add ${ubisoftState.detected.length} game${ubisoftState.detected.length !== 1 ? "s" : ""}`}
                    </Button>
                  )}
              </div>
            </>
          )}

          {/* ── EA app ── */}
          {currentStep === "ea" && (
            <>
              <div className="onboarding-step-header">
                <div className="onboarding-step-header__icon">
                  <EaLogo style={{ width: 20, height: 20 }} />
                </div>
                <div>
                  <h2>EA app</h2>
                  <p>Import games installed through the EA app or Origin</p>
                </div>
              </div>
              <p className="onboarding-step-description">
                GameHub detects games installed through the EA app (or Origin)
                and adds them to your library. They launch through the EA app.
              </p>

              {eaState === null ? (
                <p style={{ opacity: 0.6 }}>Detecting EA app…</p>
              ) : !eaState.installed ? (
                <p style={{ opacity: 0.7 }}>
                  EA app not detected on this machine. You can add EA games
                  later from Settings → Integrations.
                </p>
              ) : eaState.detected.length === 0 ? (
                <p style={{ opacity: 0.7 }}>
                  EA app found, but no installed games were detected.
                </p>
              ) : (
                <p style={{ opacity: 0.8 }}>
                  Detected: {eaState.detected.map((g) => g.title).join(", ")}
                </p>
              )}

              {eaResult && (
                <div className="onboarding-connected-badge">
                  <CheckCircleFillIcon size={16} />
                  {eaResult}
                </div>
              )}

              <div className="onboarding-actions">
                <button
                  type="button"
                  className="onboarding-skip"
                  onClick={next}
                >
                  {eaResult ? "Continue" : "Skip for now"}
                </button>
                {eaState?.installed &&
                  eaState.detected.length > 0 &&
                  !eaResult && (
                    <Button
                      type="button"
                      onClick={handleAddEaGames}
                      disabled={eaBusy}
                    >
                      {eaBusy
                        ? "Adding…"
                        : `Add ${eaState.detected.length} game${eaState.detected.length !== 1 ? "s" : ""}`}
                    </Button>
                  )}
              </div>
            </>
          )}

          {/* ── Tools ── */}
          {currentStep === "tools" && (
            <>
              <div className="onboarding-step-header">
                <div className="onboarding-step-header__icon">
                  <GearIcon size={20} />
                </div>
                <div>
                  <h2>Tools</h2>
                  <p>Import saves and scan for installed games</p>
                </div>
              </div>

              {/* Card 1: Ludusavi — only if signed in */}
              {accountLinked && (
                <div className="onboarding-tool-card">
                  <div className="onboarding-tool-card__header">
                    <LudusaviIcon className="onboarding-tool-card__svg-icon" />
                    <span className="onboarding-tool-card__title">
                      Import Cloud Saves from Ludusavi
                    </span>
                  </div>
                  <p className="onboarding-tool-card__desc">
                    Pick your Ludusavi backup folder and GameHub will upload
                    each game&apos;s saves to GameHub Cloud, matched to your
                    library automatically.
                  </p>
                  <div className="onboarding-tool-card__actions">
                    <Button
                      type="button"
                      disabled={ludusaviBusy}
                      onClick={handleLudusaviImport}
                    >
                      {ludusaviBusy ? "Importing…" : "Pick Backup Folder"}
                    </Button>
                  </div>
                  {ludusaviResult && (
                    <p className="onboarding-tool-card__result">
                      {ludusaviResult}
                    </p>
                  )}
                </div>
              )}

              {/* Card 2: Playnite playtime import */}
              <div className="onboarding-tool-card">
                <div className="onboarding-tool-card__header">
                  <PlayniteIcon className="onboarding-tool-card__svg-icon" />
                  <span className="onboarding-tool-card__title">
                    Import Playtime from Playnite
                  </span>
                </div>
                <p className="onboarding-tool-card__desc">
                  Sync your playtime hours from Playnite&apos;s library
                  database.
                  {playniteDetectedPath ? (
                    <> GameHub detected your Playnite library automatically.</>
                  ) : (
                    <>
                      {" "}
                      Auto-detects{" "}
                      <code style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                        %AppData%\Playnite\library\games.db
                      </code>{" "}
                      or pick the file manually.
                    </>
                  )}
                </p>
                <div className="onboarding-tool-card__actions">
                  <Button
                    type="button"
                    disabled={playniteBusy}
                    onClick={() => handlePlayniteImport()}
                  >
                    {playniteBusy
                      ? "Importing…"
                      : playniteDetectedPath
                        ? "Import Playtime"
                        : "Auto-detect & Import"}
                  </Button>
                  <Button
                    type="button"
                    theme="outline"
                    disabled={playniteBusy}
                    onClick={handlePickPlayniteDb}
                  >
                    Browse…
                  </Button>
                </div>
                {playniteResult && (
                  <p className="onboarding-tool-card__result">
                    {playniteResult}
                  </p>
                )}
              </div>

              {/* Card 3: Scan for Games */}
              <div className="onboarding-tool-card">
                <div className="onboarding-tool-card__header">
                  <SearchIcon size={18} />
                  <span className="onboarding-tool-card__title">
                    Scan for Installed Games
                  </span>
                </div>
                <p className="onboarding-tool-card__desc">
                  Let GameHub automatically detect your installed games and set
                  up their paths.
                </p>
                <div className="onboarding-tool-card__actions">
                  <Button
                    type="button"
                    disabled={scanBusy}
                    onClick={handleDeepScan}
                  >
                    {scanBusy ? "Scanning…" : "Deep Scan"}
                  </Button>
                  <Button
                    type="button"
                    theme="outline"
                    disabled={scanBusy}
                    onClick={handleSelectiveScan}
                  >
                    Selective Scan
                  </Button>
                </div>
                {scanBusy && scanProgress && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                    }}
                  >
                    <div
                      style={{
                        height: "4px",
                        background: "rgba(255,255,255,0.12)",
                        borderRadius: "2px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${scanProgress.total > 0 ? Math.round((scanProgress.scanned / scanProgress.total) * 100) : 0}%`,
                          background: "var(--color-primary, #8c67ef)",
                          borderRadius: "2px",
                          transition: "width 0.2s ease",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: "0.75rem", opacity: 0.6 }}>
                      {scanProgress.scanned}/{scanProgress.total} —{" "}
                      {scanProgress.currentTitle} ({scanProgress.foundCount}{" "}
                      found)
                    </span>
                  </div>
                )}
                {scanResult && (
                  <p className="onboarding-tool-card__result">{scanResult}</p>
                )}
              </div>

              <div className="onboarding-actions">
                <Button type="button" onClick={next}>
                  Continue
                </Button>
              </div>
            </>
          )}

          {/* ── Notifications ── */}
          {currentStep === "notifications" && (
            <>
              <div className="onboarding-step-header">
                <div className="onboarding-step-header__icon">
                  <BellIcon size={20} />
                </div>
                <div>
                  <h2>Notifications</h2>
                  <p>Choose which alerts GameHub should show</p>
                </div>
              </div>
              <div className="onboarding-toggles">
                <label
                  className="onboarding-toggle"
                  aria-label="Download completed"
                >
                  <div className="onboarding-toggle__text">
                    <span>Download completed</span>
                    <small>Notify when a download finishes</small>
                  </div>
                  <input
                    type="checkbox"
                    checked={downloadNotifs}
                    onChange={(e) => setDownloadNotifs(e.target.checked)}
                  />
                </label>
                <label
                  className="onboarding-toggle"
                  aria-label="Achievement unlocked"
                >
                  <div className="onboarding-toggle__text">
                    <span>Achievement unlocked</span>
                    <small>Show a pop-up when you unlock an achievement</small>
                  </div>
                  <input
                    type="checkbox"
                    checked={achievementNotifs}
                    onChange={(e) => setAchievementNotifs(e.target.checked)}
                  />
                </label>
              </div>
              <div className="onboarding-actions">
                <Button type="button" onClick={next}>
                  Continue
                </Button>
              </div>
            </>
          )}

          {/* ── Startup ── */}
          {currentStep === "startup" && (
            <>
              <div className="onboarding-step-header">
                <div className="onboarding-step-header__icon">
                  <GearIcon size={20} />
                </div>
                <div>
                  <h2>Startup Behavior</h2>
                  <p>How GameHub behaves when your computer starts</p>
                </div>
              </div>
              <div className="onboarding-toggles">
                <label
                  className="onboarding-toggle"
                  aria-label="Start minimized to tray"
                >
                  <div className="onboarding-toggle__text">
                    <span>Start minimized to tray</span>
                    <small>
                      Launch in background without opening the window
                    </small>
                  </div>
                  <input
                    type="checkbox"
                    checked={startMinimized}
                    onChange={(e) => setStartMinimized(e.target.checked)}
                  />
                </label>
              </div>
              <div className="onboarding-actions">
                <Button type="button" onClick={next}>
                  Continue
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      <EpicAuthModal
        visible={epicModalOpen}
        onClose={() => setEpicModalOpen(false)}
        onSuccess={handleEpicAuthResult}
      />
      <GogAuthModal
        visible={gogModalOpen}
        onClose={() => setGogModalOpen(false)}
        onSuccess={handleGogAuthResult}
      />

      <ScanApprovalModal
        visible={showScanApproval}
        foundGames={scanCandidates}
        onConfirm={handleScanConfirm}
        onClose={() => setShowScanApproval(false)}
      />
    </div>
  );
}
