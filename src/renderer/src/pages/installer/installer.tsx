import { useEffect, useRef, useState } from "react";
import GameHubIcon from "@renderer/assets/icons/gamehub.svg?react";
import "./installer.scss";

type Step = "mode" | "installing" | "done";
type Mode = "install" | "portable" | null;

export default function Installer() {
  const [step, setStep] = useState<Step>("mode");
  const [mode, setMode] = useState<Mode>(null);
  const [installDir, setInstallDir] = useState("");
  const [progress, setProgress] = useState(0);
  const [progressFile, setProgressFile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [destDir, setDestDir] = useState("");
  const defaultsRef = useRef<{ install: string; portable: string }>({
    install: "",
    portable: "",
  });
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    window.electron.installerGetDefaults().then((d: any) => {
      defaultsRef.current = {
        install: d.defaultInstallDir,
        portable: d.defaultPortableDir ?? d.defaultInstallDir,
      };
      setInstallDir(d.defaultInstallDir);
    });

    return () => unsubRef.current?.();
  }, []);

  // Swap the suggested folder to match the chosen mode (unless the user has
  // already typed/browsed to a custom path that isn't one of our defaults).
  const handleSelectMode = (next: Exclude<Mode, null>) => {
    setMode(next);
    const { install, portable } = defaultsRef.current;
    if (
      installDir === "" ||
      installDir === install ||
      installDir === portable
    ) {
      setInstallDir(next === "portable" ? portable : install);
    }
  };

  const handleBrowse = async () => {
    const dir = await window.electron.installerBrowseDirectory(installDir);
    if (dir) setInstallDir(dir);
  };

  const handleInstall = async () => {
    setStep("installing");
    setProgress(0);
    setError(null);

    const unsub = window.electron.onInstallerProgress((pct, file) => {
      setProgress(pct);
      setProgressFile(file);
    });
    unsubRef.current = unsub;

    const result: any = await window.electron.installerRunSetup(
      "install",
      installDir
    );

    unsub();
    unsubRef.current = null;

    if (result.ok) {
      setDestDir(result.destDir);
      setProgress(100);
      setStep("done");
    } else {
      setError(result.error ?? "Installation failed");
      setStep("mode");
    }
  };

  const handlePortable = async () => {
    setMode("portable");
    setStep("installing");
    setProgress(0);
    setError(null);

    const unsub = window.electron.onInstallerProgress((pct, file) => {
      setProgress(pct);
      setProgressFile(file);
    });
    unsubRef.current = unsub;

    const result: any = await window.electron.installerRunSetup(
      "portable",
      installDir
    );

    unsub();
    unsubRef.current = null;

    if (result.ok) {
      if (result.destDir) setDestDir(result.destDir);
      setProgress(100);
      setStep("done");
    } else {
      setError(result.error ?? "Setup failed");
      setStep("mode");
    }
  };

  const handleLaunch = async () => {
    // Both modes copy the app to the chosen folder, so relaunch from there.
    if (destDir) {
      await window.electron.installerRelaunch(destDir);
    } else {
      await window.electron.installerCloseAndLaunch();
    }
  };

  return (
    <div className="installer">
      {/* Drag region */}
      <div className="installer__titlebar" />

      <div className="installer__logo">
        <GameHubIcon className="installer__logo-icon" />
        <span className="installer__logo-text">GameHub</span>
      </div>

      {step === "mode" && (
        <div className="installer__body">
          <h1 className="installer__heading">Choose how to install</h1>
          <p className="installer__sub">
            You can always move or uninstall GameHub later.
          </p>

          {error && <p className="installer__error">{error}</p>}

          <div className="installer__cards">
            <button
              type="button"
              className={`installer__card${mode === "install" ? " installer__card--active" : ""}`}
              onClick={() => handleSelectMode("install")}
            >
              <div className="installer__card-icon">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5"
                  />
                </svg>
              </div>
              <div className="installer__card-body">
                <span className="installer__card-title">Install</span>
                <span className="installer__card-desc">
                  Adds GameHub to Program Files, creates Start Menu and Desktop
                  shortcuts.
                </span>
              </div>
            </button>

            <button
              type="button"
              className={`installer__card${mode === "portable" ? " installer__card--active" : ""}`}
              onClick={() => handleSelectMode("portable")}
            >
              <div className="installer__card-icon">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
                  />
                </svg>
              </div>
              <div className="installer__card-body">
                <span className="installer__card-title">Portable</span>
                <span className="installer__card-desc">
                  Self-contained in a folder you choose. No registry changes, no
                  shortcuts.
                </span>
              </div>
            </button>
          </div>

          {mode && (
            <div className="installer__dir-row">
              <input
                className="installer__dir-input"
                value={installDir}
                onChange={(e) => setInstallDir(e.target.value)}
                spellCheck={false}
              />
              <button
                type="button"
                className="installer__btn installer__btn--ghost"
                onClick={handleBrowse}
              >
                Browse
              </button>
            </div>
          )}

          <div className="installer__actions">
            <button
              type="button"
              className="installer__btn installer__btn--primary"
              disabled={!mode}
              onClick={mode === "install" ? handleInstall : handlePortable}
            >
              {mode === "install"
                ? "Install"
                : mode === "portable"
                  ? "Set up Portable"
                  : "Next"}
            </button>
          </div>
        </div>
      )}

      {step === "installing" && (
        <div className="installer__body installer__body--center">
          <div className="installer__spinner" />
          <h2 className="installer__heading">
            {mode === "portable" ? "Setting up…" : "Installing…"}
          </h2>
          <div className="installer__progress-bar">
            <div
              className="installer__progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="installer__progress-label">{progressFile}</p>
        </div>
      )}

      {step === "done" && (
        <div className="installer__body installer__body--center">
          <div className="installer__checkmark">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12.75l6 6 9-13.5"
              />
            </svg>
          </div>
          <h2 className="installer__heading">
            {mode === "portable" ? "Ready to go!" : "Installation complete!"}
          </h2>
          <p className="installer__sub">
            {mode === "portable"
              ? "GameHub is ready to run from your chosen folder."
              : "GameHub has been installed. Shortcuts were added to your Desktop and Start Menu."}
          </p>
          <div className="installer__actions installer__actions--done">
            {destDir && (
              <button
                type="button"
                className="installer__btn installer__btn--ghost"
                onClick={() => window.electron.installerOpenFolder(destDir)}
              >
                Open folder
              </button>
            )}
            <button
              type="button"
              className="installer__btn installer__btn--primary"
              onClick={handleLaunch}
            >
              Launch GameHub
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
