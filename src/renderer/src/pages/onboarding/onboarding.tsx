import { useState, useCallback, useEffect } from "react";
import { EpicAuthModal } from "@renderer/pages/settings/epic-auth-modal";
import { GogAuthModal } from "@renderer/pages/settings/gog-auth-modal";
import { SettingsBattleNet } from "@renderer/pages/settings/settings-battlenet";
import { useTranslation } from "react-i18next";
import {
  Button,
  TextField,
  ScanApprovalModal,
  ProgressBar,
  type ScannedGame,
} from "@renderer/components";
import { useAppSelector } from "@renderer/hooks";
import {
  CheckCircleFillIcon,
  PersonIcon,
  BellIcon,
  GearIcon,
  FileDirectoryIcon,
  SearchIcon,
  TrophyIcon,
  SyncIcon,
  ArrowLeftIcon,
} from "@primer/octicons-react";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import EpicLogo from "@renderer/assets/epic-logo.svg?react";
import GogLogo from "@renderer/assets/gog-logo.svg?react";
import BattlenetLogo from "@renderer/assets/battlenet-logo.svg?react";
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
  | "battlenet"
  | "xbox"
  | "riot"
  | "ubisoft"
  | "ea"
  | "achievements"
  | "tools"
  | "preferences"
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
  "battlenet",
  "xbox",
  "riot",
  "ubisoft",
  "ea",
  "achievements",
  "tools",
  "preferences",
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
  "battlenet",
  "xbox",
  "riot",
  "ubisoft",
  "ea",
  "achievements",
  "tools",
  "preferences",
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
  battlenet: "Battle.net",
  xbox: "Xbox",
  riot: "Riot Games",
  ubisoft: "Ubisoft Connect",
  ea: "EA app",
  achievements: "Achievements",
  tools: "Tools",
  preferences: "Preferences",
  done: "Done",
};

const PLATFORM_STEPS: StepId[] = [
  "steam",
  "epic",
  "gog",
  "battlenet",
  "xbox",
  "riot",
  "ubisoft",
  "ea",
];

interface OnboardingProps {
  onComplete: () => void;
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

  const [steamLinked, setSteamLinked] = useState(false);
  const [steamError, setSteamError] = useState("");
  const [steamInAppBusy, setSteamInAppBusy] = useState(false);
  const [steamProfile, setSteamProfile] = useState<{
    personaname: string;
    avatarfull: string;
  } | null>(null);

  const [epicModalOpen, setEpicModalOpen] = useState(false);
  const [epicLinked, setEpicLinked] = useState(false);
  const [epicAccount, setEpicAccount] = useState<string | null>(null);

  const [gogBusy, setGogBusy] = useState(false);
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
  const [ubisoftLinked, setUbisoftLinked] = useState(false);
  const [ubisoftAccountName, setUbisoftAccountName] = useState<string | null>(
    null
  );
  const [ubisoftConnecting, setUbisoftConnecting] = useState(false);
  const [ubisoftSyncResult, setUbisoftSyncResult] = useState<string>("");

  const [eaState, setEaState] = useState<{
    installed: boolean;
    detected: Array<{ offerId: string | null; title: string }>;
  } | null>(null);
  const [eaBusy, setEaBusy] = useState(false);
  const [eaResult, setEaResult] = useState("");
  const [eaLinked, setEaLinked] = useState(false);
  const [eaAccountName, setEaAccountName] = useState<string | null>(null);
  const [eaConnecting, setEaConnecting] = useState(false);
  const [eaSyncResult, setEaSyncResult] = useState<string>("");

  // Achievements (Exophase) step state
  const [exophaseUsername, setExophaseUsername] = useState<string | null>(null);
  const [exophaseConnecting, setExophaseConnecting] = useState(false);
  const [exophaseSyncChoice, setExophaseSyncChoice] = useState<
    "pending" | "running" | "skipped" | null
  >(null);
  const [exophasePsnImporting, setExophasePsnImporting] = useState(false);
  const [exophasePsnResult, setExophasePsnResult] = useState<string>("");
  // Extra PUBLIC Exophase profiles added by URL (no login needed).
  const [exophaseProfileUrl, setExophaseProfileUrl] = useState("");
  const [exophaseAddingProfile, setExophaseAddingProfile] = useState(false);
  const [exophaseAddedProfiles, setExophaseAddedProfiles] = useState<string[]>(
    []
  );
  // Live achievement-import progress (drives the onboarding progress modal).
  const [importActive, setImportActive] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    current: number;
    total: number;
    title: string;
    phase?: string;
  } | null>(null);

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
  const [themeMode, setThemeMode] = useState<"dark" | "light" | "system">(
    userPreferences?.themeMode ?? "dark"
  );

  const handleThemeModeChange = (mode: "dark" | "light" | "system") => {
    setThemeMode(mode);
    // Apply live so the user sees the change while still onboarding.
    document.documentElement.setAttribute("data-theme-mode", mode);
  };

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
        return (firstSelected as StepId) ?? "achievements";
      }
      if (PLATFORM_STEPS.includes(from)) {
        const remaining = PLATFORM_STEPS.filter((s) =>
          selectedIntegrations.has(s)
        );
        const idx = remaining.indexOf(from);
        if (idx >= 0 && idx < remaining.length - 1)
          return remaining[idx + 1] as StepId;
        return "achievements";
      }
      if (from === "achievements") return "tools";
      if (from === "tools") return "preferences";
      if (from === "preferences") return "done";
      // Default linear progression for other steps
      const idx = ALL_STEPS.indexOf(from);
      return ALL_STEPS[idx + 1] as StepId;
    },
    [selectedIntegrations]
  );

  const getPrevStep = useCallback(
    (from: StepId): StepId => {
      if (from === "install-path") return "language";
      if (from === "account") return "install-path";
      if (from === "integrations-select") return "account";
      if (PLATFORM_STEPS.includes(from)) {
        const selected = PLATFORM_STEPS.filter((s) =>
          selectedIntegrations.has(s)
        );
        const idx = selected.indexOf(from);
        if (idx > 0) return selected[idx - 1] as StepId;
        return "integrations-select";
      }
      if (from === "achievements") {
        const lastSelected = [...PLATFORM_STEPS]
          .reverse()
          .find((s) => selectedIntegrations.has(s));
        return (lastSelected as StepId) ?? "integrations-select";
      }
      if (from === "tools") return "achievements";
      if (from === "preferences") return "tools";
      return "language";
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

  const back = useCallback(() => {
    setStepIndex((i) => {
      const current = ALL_STEPS[i];
      const prevStep = getPrevStep(current);
      return ALL_STEPS.indexOf(prevStep);
    });
  }, [getPrevStep]);

  const finish = useCallback(async () => {
    await window.electron.updateUserPreferences({
      onboardingComplete: true,
      downloadNotificationsEnabled: downloadNotifs,
      achievementNotificationsEnabled: achievementNotifs,
      startMinimized,
      themeMode,
    });
    onComplete();
  }, [
    onComplete,
    downloadNotifs,
    achievementNotifs,
    startMinimized,
    themeMode,
  ]);

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

  // In-app Steam login: reads the user's OWN games via the authenticated
  // session — works even when their Steam profile games are private (which the
  // OpenID + public-XML path cannot do).
  const handleSteamInAppConnect = async () => {
    setSteamInAppBusy(true);
    setSteamError("");
    try {
      const result = await window.electron.openSteamLoginWindow();
      if (!result?.steamId) {
        setSteamError("Steam login failed.");
        return;
      }
      const summary = await window.electron
        .getSteamPlayerSummary(result.steamId, undefined)
        .catch(() => null);
      await window.electron.updateUserPreferences({
        steamId: result.steamId,
        steamUsername: summary?.personaname ?? null,
        steamAvatarUrl: summary?.avatarfull ?? null,
      });
      if (summary) setSteamProfile(summary);
      setSteamLinked(true);
      // Authenticated session is established; sync owned games in background.
      window.electron
        .syncSteamLibrary(result.steamId, undefined)
        .catch(() => {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSteamError(msg || "Steam login failed.");
    } finally {
      setSteamInAppBusy(false);
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
        window.electron
          .updateUserPreferences({ epicAccountName: result.account ?? "Epic" })
          .catch(() => {});
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
      setGogBusy(true);
      try {
        await window.electron.updateUserPreferences({
          gogRefreshToken: result.refresh_token,
          gogUsername: result.username ?? "GOG User",
        });
        setGogLinked(true);
        setGogUsername(result.username ?? "GOG User");
        // gogdl is needed to download GOG games — install it in the background
        // if it isn't present yet
        const gogdlStatus = await window.electron
          .getGogdlStatus()
          .catch(() => ({ binaryFound: false }));
        if (!gogdlStatus.binaryFound)
          window.electron.installGogdl().catch(() => {});
        window.electron.syncGogLibrary().catch(() => {});
      } finally {
        setGogBusy(false);
      }
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
    setRiotBusy(true);
    try {
      const result = await window.electron.addRiotGamesToLibrary([
        "league_of_legends",
        "valorant",
        "bacon",
      ]);
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

  const handleUbisoftConnect = async () => {
    setUbisoftConnecting(true);
    try {
      const result = await window.electron.openUbisoftAuthWindow();
      if (result) {
        setUbisoftLinked(true);
        setUbisoftAccountName(result.username);
        const syncResult = await window.electron
          .syncUbisoftLibrary()
          .catch(() => null);
        if (syncResult && !syncResult.error) {
          setUbisoftSyncResult(
            `Synced ${syncResult.total} game${syncResult.total !== 1 ? "s" : ""} from your Ubisoft library.`
          );
        }
      }
    } catch {
      // ignore
    } finally {
      setUbisoftConnecting(false);
    }
  };

  const handleEaConnect = async () => {
    setEaConnecting(true);
    try {
      const result = await window.electron.openEaAuthWindow();
      if (result) {
        setEaLinked(true);
        setEaAccountName(result.username);
        const syncResult = await window.electron
          .syncEaLibrary()
          .catch(() => null);
        if (syncResult && !syncResult.error) {
          setEaSyncResult(
            `Synced ${syncResult.total} game${syncResult.total !== 1 ? "s" : ""} from your EA library.`
          );
        }
      }
    } catch {
      // ignore
    } finally {
      setEaConnecting(false);
    }
  };

  // Subscribe to the SAME live sync signals the report page uses, so the
  // onboarding progress modal reflects the import as it happens — and so the
  // user can continue into the app and watch the rest on the Sync report.
  useEffect(() => {
    const offProgress = window.electron.onExophaseSyncProgress((p) => {
      setImportActive(true);
      setImportProgress(p);
    });
    const offActive = window.electron.onExophaseSyncActive((active) => {
      setImportActive(active);
      if (!active) setImportProgress(null);
    });
    return () => {
      offProgress();
      offActive();
    };
  }, []);

  const handleExophaseConnect = async () => {
    setExophaseConnecting(true);
    try {
      const state = await window.electron.openExophaseAuthWindow();
      if (state.authenticated) {
        setExophaseUsername(state.username);
        await window.electron.updateUserPreferences({
          exophaseUserId: state.username,
          exophaseEnabled: true,
        });
        // Show the "run sync now?" prompt instead of auto-starting.
        setExophaseSyncChoice("pending");
      }
    } catch {
      // ignore
    } finally {
      setExophaseConnecting(false);
    }
  };

  const handleExophaseAddProfile = async () => {
    const input = exophaseProfileUrl.trim();
    if (!input) return;
    setExophaseAddingProfile(true);
    try {
      const res = await window.electron.validateExophaseProfile(input);
      if (!res.ok || !res.username) return;
      const prefs = await window.electron
        .getUserPreferences()
        .catch(() => null);
      const extras = prefs?.exophaseExtraProfiles ?? [];
      await window.electron.updateUserPreferences({
        exophaseExtraProfiles: [...extras, res.username],
        exophaseEnabled: true,
      });
      setExophaseProfileUrl("");
      setExophaseAddedProfiles((list) => [...list, res.username!]);
      window.electron.runExophaseBackgroundSync().catch(() => {});
    } catch {
      // ignore
    } finally {
      setExophaseAddingProfile(false);
    }
  };

  const handleExophaseSyncNow = () => {
    setExophaseSyncChoice("running");
    setImportActive(true);
    setImportProgress(null);
    // Small delay so session cookies flush before the background sync window opens.
    setTimeout(
      () => window.electron.runExophaseBackgroundSync().catch(() => {}),
      800
    );
  };

  const handleExophasePsnImport = async () => {
    setExophasePsnImporting(true);
    setExophasePsnResult("");
    try {
      const result = await window.electron.importPlaystationAchievements();
      if (!result.error) {
        setExophasePsnResult(
          `Credited ${result.totalUnlocked} trophies onto ${result.gamesMatched} game${result.gamesMatched !== 1 ? "s" : ""}.`
        );
      }
    } catch {
      // ignore
    } finally {
      setExophasePsnImporting(false);
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
      const cached = result.cached?.length ?? 0;
      if (result.matched === 0 && cached === 0) {
        setPlayniteResult(
          result.total === 0
            ? "No Playnite games with playtime found."
            : `No matching games found (${result.total} Playnite games scanned).`
        );
      } else {
        const parts: string[] = [];
        if (result.matched > 0)
          parts.push(
            `Updated ${result.matched} game${result.matched !== 1 ? "s" : ""}`
          );
        if (cached > 0)
          parts.push(
            `saved playtime for ${cached} more — will apply when you add them`
          );
        setPlayniteResult(parts.join(", ") + ".");
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
              {(() => {
                const connected = [
                  { name: "Steam", linked: steamLinked, Icon: SteamLogo },
                  { name: "Epic Games", linked: epicLinked, Icon: EpicLogo },
                  { name: "GOG", linked: gogLinked, Icon: GogLogo },
                  { name: "Xbox", linked: xboxLinked, Icon: XboxLogo },
                  {
                    name: "Ubisoft Connect",
                    linked: ubisoftLinked,
                    Icon: UbisoftLogo,
                  },
                  { name: "EA app", linked: eaLinked, Icon: EaLogo },
                ].filter((p) => p.linked);
                if (connected.length === 0) return null;
                return (
                  <div className="onboarding-done-summary">
                    {connected.map(({ name, Icon }) => (
                      <div
                        key={name}
                        className="onboarding-connected-badge"
                        style={{ margin: 0 }}
                      >
                        <Icon style={{ width: 16, height: 16 }} />
                        {name}
                        <CheckCircleFillIcon size={14} />
                      </div>
                    ))}
                  </div>
                );
              })()}
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
                  "battlenet",
                  "xbox",
                  "riot",
                  "ubisoft",
                  "ea",
                ] as StepId[]
              )
                .filter(
                  (s) =>
                    stepIndex <= ALL_STEPS.indexOf("integrations-select") ||
                    selectedIntegrations.has(s)
                )
                .map((s) => {
                  const PlatformIcon = {
                    steam: SteamLogo,
                    epic: EpicLogo,
                    gog: GogLogo,
                    battlenet: BattlenetLogo,
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
                        !isSelected ? "onboarding-nav-item--disabled" : "",
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
                      <PlatformIcon className="onboarding-nav-item__platform-icon" />
                    </div>
                  );
                })}

              <div className="onboarding-sidebar__section-label">
                Achievements
              </div>
              <div
                className={[
                  "onboarding-nav-item",
                  navStepIsActive("achievements")
                    ? "onboarding-nav-item--active"
                    : "",
                  navStepIsDone("achievements")
                    ? "onboarding-nav-item--done"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="onboarding-nav-item__dot">
                  {navStepIsDone("achievements") ? "✓" : ""}
                </span>
                <span className="onboarding-nav-item__label">
                  {STEP_LABELS["achievements"]}
                </span>
              </div>

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
              {(["preferences"] as StepId[]).map((s) => (
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
          {showSidebar && (
            <div className="onboarding-progress">
              <div
                className="onboarding-progress__fill"
                style={{
                  width: `${(stepIndex / (ALL_STEPS.length - 1)) * 100}%`,
                }}
              />
            </div>
          )}
          {showSidebar && currentStep !== "language" && (
            <button
              type="button"
              className="onboarding-back"
              onClick={back}
              aria-label="Go back"
            >
              <ArrowLeftIcon size={14} />
              Back
            </button>
          )}
          <div key={currentStep} className="onboarding-step-body">
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
                  You can override this per-download later. Leave blank to use
                  the default.
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
                      {
                        id: "battlenet",
                        name: "Battle.net",
                        Icon: BattlenetLogo,
                      },
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
                    onClick={() =>
                      setStepIndex(ALL_STEPS.indexOf("achievements"))
                    }
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
                    <SteamLogo />
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
                    <div className="onboarding-actions onboarding-actions--start">
                      <Button
                        type="button"
                        onClick={handleSteamInAppConnect}
                        disabled={steamInAppBusy}
                        style={{
                          background: "#1b2838",
                          color: "#c7d5e0",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <SteamLogo style={{ width: 18, height: 18 }} />
                        {steamInAppBusy
                          ? "Opening Steam…"
                          : "Sign in with Steam"}
                      </Button>
                    </div>

                    <p className="onboarding-step-description">
                      Sign in inside the app — we read your owned games
                      directly, even if your Steam profile is private.
                    </p>

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
                    </div>
                  </>
                )}
              </>
            )}

            {/* ── Epic ── */}
            {currentStep === "epic" && (
              <>
                <div className="onboarding-step-header">
                  <div className="onboarding-step-header__icon">
                    <EpicLogo />
                  </div>
                  <div>
                    <h2>Epic Games</h2>
                    <p>Connect via Legendary (open-source CLI)</p>
                  </div>
                </div>
                <p className="onboarding-step-description">
                  Connect your Epic Games account to import your owned library
                  into GameHub.
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
                    <GogLogo />
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
                    <XboxLogo />
                  </div>
                  <div>
                    <h2>Xbox / Game Pass</h2>
                    <p>Import your Xbox and Game Pass PC library</p>
                  </div>
                </div>
                <p className="onboarding-step-description">
                  Sign in with your Microsoft account to import your Xbox and
                  Game Pass PC library into GameHub.
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
                    <RiotLogo />
                  </div>
                  <div>
                    <h2>Riot Games</h2>
                    <p>League of Legends, VALORANT, Legends of Runeterra</p>
                  </div>
                </div>
                <p className="onboarding-step-description">
                  Riot games are free to play — add League of Legends, VALORANT,
                  and Legends of Runeterra to your library. They launch through
                  the Riot Client.
                </p>

                {riotState === null ? (
                  <p style={{ opacity: 0.6 }}>Detecting Riot Client…</p>
                ) : (
                  <>
                    {riotState.detected.length > 0 && (
                      <p style={{ opacity: 0.8 }}>
                        Installed:{" "}
                        {riotState.detected.map((g) => g.title).join(", ")}
                      </p>
                    )}
                    {!riotState.installed && (
                      <p style={{ opacity: 0.6, fontSize: "0.82rem" }}>
                        Riot Client not detected — games can&apos;t be launched
                        until you install it.
                      </p>
                    )}
                  </>
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
                  {!riotResult && (
                    <Button
                      type="button"
                      onClick={handleAddRiotGames}
                      disabled={riotBusy}
                    >
                      {riotBusy ? "Adding…" : "Add Riot games"}
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
                    <UbisoftLogo />
                  </div>
                  <div>
                    <h2>Ubisoft Connect</h2>
                    <p>Import your Ubisoft library</p>
                  </div>
                </div>
                <p className="onboarding-step-description">
                  Connect your Ubisoft account to import your owned games — no
                  client required. Games launch through Ubisoft Connect when
                  it&apos;s installed.
                </p>

                {ubisoftLinked ? (
                  <>
                    <div className="onboarding-connected-badge">
                      <CheckCircleFillIcon size={16} />
                      Connected as {ubisoftAccountName}
                      {ubisoftSyncResult && (
                        <span style={{ opacity: 0.7, fontSize: "0.85em" }}>
                          {" "}
                          — {ubisoftSyncResult}
                        </span>
                      )}
                    </div>
                    <div className="onboarding-actions">
                      <Button type="button" onClick={next}>
                        Continue
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="onboarding-actions">
                      <button
                        type="button"
                        className="onboarding-skip"
                        onClick={next}
                      >
                        Skip for now
                      </button>
                      <Button
                        type="button"
                        onClick={handleUbisoftConnect}
                        disabled={ubisoftConnecting}
                      >
                        <PersonIcon size={14} />
                        {ubisoftConnecting ? "Connecting…" : "Connect Ubisoft"}
                      </Button>
                    </div>

                    {ubisoftState !== null &&
                      ubisoftState.installed &&
                      ubisoftState.detected.length > 0 && (
                        <>
                          <div className="onboarding-divider onboarding-divider--spaced">
                            or add installed games
                          </div>
                          {ubisoftResult ? (
                            <div className="onboarding-connected-badge">
                              <CheckCircleFillIcon size={16} />
                              {ubisoftResult}
                            </div>
                          ) : (
                            <div className="onboarding-actions">
                              <Button
                                type="button"
                                onClick={handleAddUbisoftGames}
                                disabled={ubisoftBusy}
                              >
                                {ubisoftBusy
                                  ? "Adding…"
                                  : `Add ${ubisoftState.detected.length} installed game${ubisoftState.detected.length !== 1 ? "s" : ""}`}
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                  </>
                )}
              </>
            )}

            {/* ── Battle.net ── */}
            {currentStep === "battlenet" && (
              <>
                <div className="onboarding-step-header">
                  <div className="onboarding-step-header__icon">
                    <BattlenetLogo />
                  </div>
                  <div>
                    <h2>Battle.net</h2>
                    <p>Import your Blizzard games</p>
                  </div>
                </div>
                <p className="onboarding-step-description">
                  Detect installed Blizzard games (WoW, Diablo, Overwatch,
                  StarCraft, Hearthstone…) and add them to your library. They
                  launch through Battle.net.
                </p>

                <SettingsBattleNet />

                <div className="onboarding-actions onboarding-actions--spaced">
                  <Button type="button" onClick={next}>
                    Continue
                  </Button>
                </div>
              </>
            )}

            {/* ── EA app ── */}
            {currentStep === "ea" && (
              <>
                <div className="onboarding-step-header">
                  <div className="onboarding-step-header__icon">
                    <EaLogo />
                  </div>
                  <div>
                    <h2>EA app</h2>
                    <p>Import your EA library</p>
                  </div>
                </div>
                <p className="onboarding-step-description">
                  Connect your EA account to import your owned games — no client
                  required. Games launch through the EA app when it&apos;s
                  installed.
                </p>

                {eaLinked ? (
                  <>
                    <div className="onboarding-connected-badge">
                      <CheckCircleFillIcon size={16} />
                      Connected as {eaAccountName}
                      {eaSyncResult && (
                        <span style={{ opacity: 0.7, fontSize: "0.85em" }}>
                          {" "}
                          — {eaSyncResult}
                        </span>
                      )}
                    </div>
                    <div className="onboarding-actions">
                      <Button type="button" onClick={next}>
                        Continue
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="onboarding-actions">
                      <button
                        type="button"
                        className="onboarding-skip"
                        onClick={next}
                      >
                        Skip for now
                      </button>
                      <Button
                        type="button"
                        onClick={handleEaConnect}
                        disabled={eaConnecting}
                      >
                        <PersonIcon size={14} />
                        {eaConnecting ? "Connecting…" : "Connect EA"}
                      </Button>
                    </div>

                    {eaState !== null &&
                      eaState.installed &&
                      eaState.detected.length > 0 && (
                        <>
                          <div className="onboarding-divider onboarding-divider--spaced">
                            or add installed games
                          </div>
                          {eaResult ? (
                            <div className="onboarding-connected-badge">
                              <CheckCircleFillIcon size={16} />
                              {eaResult}
                            </div>
                          ) : (
                            <div className="onboarding-actions">
                              <Button
                                type="button"
                                onClick={handleAddEaGames}
                                disabled={eaBusy}
                              >
                                {eaBusy
                                  ? "Adding…"
                                  : `Add ${eaState.detected.length} installed game${eaState.detected.length !== 1 ? "s" : ""}`}
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                  </>
                )}
              </>
            )}

            {/* ── Achievements (Exophase) ── */}
            {currentStep === "achievements" && (
              <>
                <div className="onboarding-step-header">
                  <div className="onboarding-step-header__icon">
                    <TrophyIcon size={20} />
                  </div>
                  <div>
                    <h2>Achievements</h2>
                    <p>Track achievements across every store</p>
                  </div>
                </div>
                <p className="onboarding-step-description">
                  GameHub uses <strong>Exophase</strong> as a single source for
                  achievements — one account covers Steam, Xbox, GOG, Epic and
                  more. Sign in with your Exophase account, or create one for
                  free on the same screen.
                </p>

                {exophaseUsername ? (
                  <>
                    <div className="onboarding-connected-badge">
                      <CheckCircleFillIcon size={16} />
                      Connected as {exophaseUsername}
                    </div>

                    {/* Background sync decision prompt */}
                    {exophaseSyncChoice === "pending" && (
                      <div className="onboarding-tool-card">
                        <div className="onboarding-tool-card__header">
                          <SyncIcon size={16} />
                          <span className="onboarding-tool-card__title">
                            Run Achievement Sync?
                          </span>
                        </div>
                        <p className="onboarding-tool-card__desc">
                          Sync your Exophase achievements now. It runs fully in
                          the background — you can continue setup while it
                          works. Check progress anytime on the Sync Report page.
                        </p>
                        <div className="onboarding-tool-card__actions">
                          <button
                            type="button"
                            className="onboarding-skip"
                            onClick={() => setExophaseSyncChoice("skipped")}
                          >
                            Later
                          </button>
                          <Button type="button" onClick={handleExophaseSyncNow}>
                            <SyncIcon size={14} />
                            Run Now
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Live progress banner — shown while sync is running */}
                    {exophaseSyncChoice === "running" && (
                      <div className="onboarding-tool-card">
                        <div className="onboarding-tool-card__import-banner-text">
                          <SyncIcon
                            size={12}
                            className="onboarding-tool-card__spin"
                          />
                          {importProgress
                            ? `Syncing… ${importProgress.current}/${importProgress.total} — ${importProgress.title}`
                            : importActive
                              ? "Syncing achievements…"
                              : "Sync complete."}
                        </div>
                        {(importActive || importProgress) && (
                          <ProgressBar
                            current={importProgress?.current ?? 1}
                            total={importProgress?.total ?? 25}
                            className="onboarding-tool-card__progress"
                          />
                        )}
                        <p className="onboarding-tool-card__import-hint">
                          Continues in the background — keep going with setup.
                        </p>
                      </div>
                    )}

                    {exophaseSyncChoice === "skipped" && (
                      <p
                        style={{
                          fontSize: "0.82rem",
                          opacity: 0.55,
                          margin: 0,
                        }}
                      >
                        Sync skipped — you can run it anytime from{" "}
                        <strong>Settings → Achievements</strong>.
                      </p>
                    )}

                    {/* PSN import — always available, never blocked by bg sync */}
                    <div className="onboarding-tool-card">
                      <div className="onboarding-tool-card__header">
                        <TrophyIcon size={16} />
                        <span className="onboarding-tool-card__title">
                          Import PlayStation Trophies
                        </span>
                      </div>
                      <p className="onboarding-tool-card__desc">
                        Played on PlayStation? We&apos;ll credit your PSN
                        trophies onto the matching PC games (e.g. God of War PS4
                        → God of War PC). You need to link your PSN account on
                        Exophase first — then come back here to import.
                      </p>
                      {exophasePsnResult ? (
                        <div
                          className="onboarding-connected-badge"
                          style={{ fontSize: "0.82rem" }}
                        >
                          <CheckCircleFillIcon size={14} />
                          {exophasePsnResult}
                        </div>
                      ) : (
                        <div className="onboarding-tool-card__actions">
                          <button
                            type="button"
                            className="onboarding-skip"
                            onClick={next}
                          >
                            Skip
                          </button>
                          <Button
                            type="button"
                            theme="outline"
                            onClick={() =>
                              window.electron.openExternal(
                                "https://www.exophase.com/account"
                              )
                            }
                          >
                            Link PSN on Exophase
                          </Button>
                          <Button
                            type="button"
                            theme="outline"
                            onClick={handleExophasePsnImport}
                            disabled={exophasePsnImporting}
                          >
                            {exophasePsnImporting
                              ? "Importing…"
                              : "Import Trophies"}
                          </Button>
                        </div>
                      )}
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
                    <Button
                      type="button"
                      onClick={handleExophaseConnect}
                      disabled={exophaseConnecting}
                    >
                      <PersonIcon size={14} />
                      {exophaseConnecting
                        ? "Waiting for sign-in…"
                        : "Login to Exophase"}
                    </Button>
                  </div>
                )}

                {/* Add public Exophase profiles by URL — works with or without
                    a login; the profile just needs to be public. */}
                <div className="onboarding-tool-card">
                  <div className="onboarding-tool-card__header">
                    <PersonIcon size={16} />
                    <span className="onboarding-tool-card__title">
                      Add a public profile by URL
                    </span>
                  </div>
                  <p className="onboarding-tool-card__desc">
                    Track another Exophase profile without logging in — just
                    paste its public link (e.g.{" "}
                    https://www.exophase.com/user/Kewz4/).
                  </p>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <input
                      type="text"
                      value={exophaseProfileUrl}
                      onChange={(e) => setExophaseProfileUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !exophaseAddingProfile)
                          handleExophaseAddProfile();
                      }}
                      placeholder="https://www.exophase.com/user/…"
                      spellCheck={false}
                      style={{
                        flex: 1,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.15)",
                        background: "rgba(255,255,255,0.04)",
                        color: "inherit",
                        fontSize: "0.875em",
                      }}
                    />
                    <Button
                      type="button"
                      theme="outline"
                      onClick={handleExophaseAddProfile}
                      disabled={
                        exophaseAddingProfile || !exophaseProfileUrl.trim()
                      }
                    >
                      {exophaseAddingProfile ? "Checking…" : "Add"}
                    </Button>
                  </div>
                  {exophaseAddedProfiles.length > 0 && (
                    <p
                      style={{
                        fontSize: "0.82rem",
                        opacity: 0.7,
                        margin: "8px 0 0",
                      }}
                    >
                      Added: {exophaseAddedProfiles.join(", ")}
                    </p>
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
                      <>
                        {" "}
                        GameHub detected your Playnite library automatically.
                      </>
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
                    Let GameHub automatically detect your installed games and
                    set up their paths.
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
                    <ProgressBar
                      current={scanProgress.scanned}
                      total={scanProgress.total}
                      label={`${scanProgress.scanned}/${scanProgress.total} — ${scanProgress.currentTitle} (${scanProgress.foundCount} found)`}
                    />
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

            {/* ── Preferences ── */}
            {currentStep === "preferences" && (
              <>
                <div className="onboarding-step-header">
                  <div className="onboarding-step-header__icon">
                    <BellIcon size={20} />
                  </div>
                  <div>
                    <h2>Preferences</h2>
                    <p>Appearance, notifications and startup behavior</p>
                  </div>
                </div>

                <div className="onboarding-field-label">Appearance</div>
                <div className="onboarding-theme-choices">
                  {(
                    [
                      { id: "dark", label: "Dark" },
                      { id: "light", label: "Light" },
                      { id: "system", label: "Follow system" },
                    ] as const
                  ).map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      className={[
                        "onboarding-theme-choice",
                        themeMode === id
                          ? "onboarding-theme-choice--active"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => handleThemeModeChange(id)}
                    >
                      {themeMode === id && <CheckCircleFillIcon size={14} />}
                      {label}
                    </button>
                  ))}
                </div>

                <div className="onboarding-field-label">Notifications</div>
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
                      <small>
                        Show a pop-up when you unlock an achievement
                      </small>
                    </div>
                    <input
                      type="checkbox"
                      checked={achievementNotifs}
                      onChange={(e) => setAchievementNotifs(e.target.checked)}
                    />
                  </label>
                </div>
                <div className="onboarding-field-label onboarding-field-label--spaced">
                  Startup
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
