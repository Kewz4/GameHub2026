import { useState, useCallback, useEffect } from "react";
import { EpicAuthModal } from "@renderer/pages/settings/epic-auth-modal";
import { GogAuthModal } from "@renderer/pages/settings/gog-auth-modal";
import { useTranslation } from "react-i18next";
import { Button, TextField } from "@renderer/components";
import { useAppSelector } from "@renderer/hooks";
import {
  CheckCircleFillIcon,
  PersonIcon,
  LinkExternalIcon,
  BellIcon,
  GearIcon,
  FileDirectoryIcon,
} from "@primer/octicons-react";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import EpicLogo from "@renderer/assets/epic-logo.svg?react";
import GogLogo from "@renderer/assets/gog-logo.svg?react";
import XboxLogo from "@renderer/assets/xbox-logo.svg?react";
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
  | "steam"
  | "epic"
  | "gog"
  | "xbox"
  | "notifications"
  | "startup"
  | "done";

const ALL_STEPS: StepId[] = [
  "welcome",
  "language",
  "install-path",
  "account",
  "steam",
  "epic",
  "gog",
  "xbox",
  "notifications",
  "startup",
  "done",
];

const NAV_STEPS: StepId[] = [
  "language",
  "install-path",
  "account",
  "steam",
  "epic",
  "gog",
  "xbox",
  "notifications",
  "startup",
];

const STEP_LABELS: Record<StepId, string> = {
  welcome: "Welcome",
  language: "Language",
  "install-path": "Install Path",
  account: "Account",
  steam: "Steam",
  epic: "Epic Games",
  gog: "GOG",
  xbox: "Xbox",
  notifications: "Notifications",
  startup: "Startup",
  done: "Done",
};

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

  const [epicBusy, setEpicBusy] = useState(false);
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

  const [downloadNotifs, setDownloadNotifs] = useState(true);
  const [achievementNotifs, setAchievementNotifs] = useState(true);
  const [startMinimized, setStartMinimized] = useState(false);

  const currentStep = ALL_STEPS[stepIndex];
  void ALL_STEPS.indexOf(currentStep);

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
      setStepIndex((i) => Math.min(i + 1, ALL_STEPS.length - 1));
    });
    return unsub;
  }, [accountWindowOpen]);

  const next = useCallback(() => {
    setStepIndex((i) => Math.min(i + 1, ALL_STEPS.length - 1));
  }, []);

  const skipIntegrations = useCallback(() => {
    setStepIndex(ALL_STEPS.indexOf("notifications"));
  }, []);

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

  const handleEpicConnect = async () => {
    setEpicBusy(true);
    try {
      const status = await window.electron
        .getLegendaryStatus()
        .catch(() => null);
      if (!status?.binaryFound) {
        await window.electron.installLegendary().catch(() => null);
      }
      setEpicModalOpen(true);
    } catch {
      // ignore
    } finally {
      setEpicBusy(false);
    }
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
              {(["steam", "epic", "gog", "xbox"] as StepId[]).map((s) => {
                const PlatformIcon = {
                  steam: SteamLogo,
                  epic: EpicLogo,
                  gog: GogLogo,
                  xbox: XboxLogo,
                }[s];
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
                    onClick={skipIntegrations}
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
                    disabled={epicBusy}
                  >
                    Skip for now
                  </button>
                  <Button
                    type="button"
                    onClick={handleEpicConnect}
                    disabled={epicBusy}
                  >
                    <PersonIcon size={14} />
                    {epicBusy ? "Opening…" : "Connect Epic"}
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
    </div>
  );
}
