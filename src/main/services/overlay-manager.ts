import { isStaging } from "@main/constants";
import { db, levelKeys } from "@main/level";
import type {
  Game,
  HydraOverlayContext,
  HydraOverlayGamepadAction,
  HydraOverlayPerformance,
  User,
  UserPreferences,
} from "@types";
import {
  DEFAULT_HYDRA_OVERLAY_PREFERENCES,
  resolveHydraOverlayPreferences,
} from "@shared";
import {
  BrowserWindow,
  app,
  desktopCapturer,
  globalShortcut,
  screen,
} from "electron";
import path from "node:path";
import { getUnlockedAchievements } from "@main/events/user/get-unlocked-achievements";
import { getGameAssets } from "@main/events/catalogue/get-game-assets";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";
import { findOverlayGameProcesses } from "./overlay-game-process";
import {
  excludeOverlayLaunchHelpers,
  selectUnambiguousOverlayRenderProcess,
} from "./overlay-game-process-ranking";
import { overlayFpsMonitor } from "./overlay-fps-monitor";
import { WindowManager } from "./window-manager";
import { GameRecorderManager } from "./game-recorder-manager";
import { isGameWindowDisplaySized } from "./game-recorder-capture-source";
import { destroyOverlayWindow } from "./overlay-window-lifecycle";
import { isOverlayShortcutInput } from "./overlay-shortcut";
import {
  OVERLAY_ACTIVATION_GRACE_MS,
  calculateActivationToastBounds,
  canShowActivationToast,
  isOverlayInteractionForeground,
  type OverlayActivationToastKind,
} from "./overlay-activation-policy";
import {
  evaluateOverlayWindowMode,
  isExactDesktopWindowSource,
  type OverlayWindowModeEligibility,
  type OverlayWindowModeFailureReason,
} from "./overlay-window-mode";

const PREFERRED_SHORTCUT = "Shift+F3";
const FALLBACK_SHORTCUT = "Control+Shift+F3";
const CONTROLLER_SHORTCUT = "Guide";
const FPS_WIDTH = 218;
const FPS_HEIGHT = 116;
const TOGGLE_DEBOUNCE_MS = 350;
// Taking the foreground can lose a race with a fullscreen game, so retry a
// bounded number of times before accepting that the game kept input.
const OVERLAY_FOREGROUND_ATTEMPTS = 4;
const OVERLAY_FOREGROUND_RETRY_MS = 120;
/**
 * The renderer handshake is racy and used to fail permanently when it lost.
 *
 * getContext() awaits three slow reads (user, achievements, assets). If the
 * overlay page reloads during that window the context generation moves on, the
 * fetch returns null, and rendererContextGeneration is never assigned — so the
 * renderer never reports ready and nothing ever asks it again. The overlay then
 * cannot be opened at all until something else reloads it, which is exactly the
 * "shortcut does nothing" failure. Re-drive the handshake instead of aborting,
 * and bound the wait so a renderer that never answers cannot hang the toggle.
 */
const RENDERER_READY_ATTEMPTS = 4;
const RENDERER_READY_TIMEOUT_MS = 1_500;
const GAMEPAD_REPEAT_DELAY_MS = 360;
const GAMEPAD_REPEAT_INTERVAL_MS = 105;

const GAMEPAD_ACTIONS: Array<[number, HydraOverlayGamepadAction]> = [
  [0x1000, "accept"],
  [0x2000, "back"],
  [0x0100, "previous-tab"],
  [0x0200, "next-tab"],
  [0x0001, "up"],
  [0x0002, "down"],
  [0x0004, "left"],
  [0x0008, "right"],
];
const GAMEPAD_DIRECTION_MASK = 0x000f;
const GAMEPAD_GUIDE_BUTTON = 0x0400;
const GAMEPAD_OVERLAY_CHORD = 0x0030;

const emptyPerformance = (): HydraOverlayPerformance => ({
  fps: null,
  averageFps: null,
  onePercentLow: null,
  frameTimeMs: null,
  updatedAt: Date.now(),
});

export class OverlayManager {
  private static overlayWindow: BrowserWindow | null = null;
  private static toastWindow: BrowserWindow | null = null;
  private static toastKind: OverlayActivationToastKind = "ready";
  private static fpsWindow: BrowserWindow | null = null;
  private static activeGame: Game | null = null;
  private static servicesActive = false;
  private static sessionStartedAt = 0;
  private static registeredShortcut: string | null = null;
  private static registeredWithElectron = false;
  private static controllerPoll: NodeJS.Timeout | null = null;
  private static wasControllerTogglePressed = false;
  private static previousGamepadButtons = 0;
  private static repeatingGamepadButton = 0;
  private static nextGamepadRepeatAt = 0;
  private static keyboardEventCount = 0;
  private static performancePinned = false;
  private static performance = emptyPerformance();
  private static preferences = DEFAULT_HYDRA_OVERLAY_PREFERENCES;
  private static lastToggleAt = 0;
  private static targetPid = 0;
  private static targetPoll: NodeJS.Timeout | null = null;
  private static targetRefreshPending = false;
  private static lastTargetRefreshAt = 0;
  private static targetExecutable: string | null = null;
  private static targetCreationTicks: string | null = null;
  private static activationToastPending = false;
  private static activationToastShown = false;
  private static overlayRendererReady = false;
  private static overlayTogglePending = false;
  private static overlayActivationGraceUntil = 0;
  private static lastOverlayPlacement: Electron.Rectangle | null = null;
  private static overlayContextGeneration = 0;
  private static rendererContextGeneration = -1;
  private static windowModeEligibility: OverlayWindowModeEligibility | null =
    null;
  private static windowModeCheck: Promise<OverlayWindowModeEligibility> | null =
    null;
  private static overlayRendererReadyWaiters = new Set<
    (ready: boolean) => void
  >();
  public static initialize() {
    GameRecorderManager.initialize();
    overlayFpsMonitor.setUpdateHandler((metrics) =>
      this.updatePerformance(metrics)
    );
    app.once("will-quit", () => this.dispose());
    app.on("browser-window-created", (_event, window) => {
      window.webContents.on("before-input-event", (event, input) => {
        if (this.servicesActive && isOverlayShortcutInput(input)) {
          event.preventDefault();
          this.handleShortcutTrigger("window-keyboard");
        }
      });
    });
  }

  public static setActiveGame(game: Game) {
    if (
      this.activeGame?.objectId === game.objectId &&
      this.activeGame.shop === game.shop
    ) {
      const previousGame = this.activeGame;
      const targetDefinitionChanged =
        previousGame.executablePath !== game.executablePath ||
        previousGame.nativeExecutablePath !== game.nativeExecutablePath ||
        JSON.stringify(previousGame.trackingExecutablePaths ?? []) !==
          JSON.stringify(game.trackingExecutablePaths ?? []);
      this.activeGame = game;
      if (targetDefinitionChanged) {
        logger.info("Overlay active game executable changed", {
          title: game.title,
          executable: game.nativeExecutablePath ?? game.executablePath ?? null,
        });
        void GameRecorderManager.setActiveGame(game);
        this.lastTargetRefreshAt = 0;
        if (this.servicesActive) {
          void this.refreshTargetProcess(game).then(() =>
            this.synchronizeTargetWindows()
          );
        }
      }
      // A transient preference/database/native failure can leave the game
      // selected while its overlay services are down. Process-watcher will
      // keep reporting the same game, so use that report as a re-arm attempt
      // instead of leaving the session permanently without a shortcut.
      if (!this.servicesActive) {
        void this.configureActiveGame(game).catch((error) =>
          logger.error(
            "Overlay could not be reconfigured for the active game",
            error
          )
        );
      }
      return;
    }

    this.stopActiveServices();
    this.activeGame = game;
    this.lastOverlayPlacement = null;
    this.sessionStartedAt = Date.now();
    this.performancePinned = false;
    this.invalidateOverlayRendererContext(true);
    void GameRecorderManager.setActiveGame(game);
    // Rejections here used to vanish: a throw anywhere in the preference read
    // or service start left the overlay unarmed with nothing in the log.
    void this.configureActiveGame(game).catch((error) =>
      logger.error("Overlay could not be configured for the active game", error)
    );
  }

  public static applyUserPreferences(preferences: UserPreferences) {
    const wasOverlayEnabled = this.preferences.overlayEnabled;
    const wasPerformanceEnabled = this.preferences.overlayPerformanceEnabled;
    this.readPreferences(preferences);
    void GameRecorderManager.applyUserPreferences(preferences);

    const game = this.activeGame;
    if (!game) return;
    if (!this.preferences.overlayEnabled) {
      this.stopActiveServices();
      return;
    }
    if (!wasOverlayEnabled || !this.servicesActive) {
      this.startActiveServices(game);
      return;
    }
    if (this.preferences.overlayPerformanceEnabled !== wasPerformanceEnabled) {
      this.performancePinned = false;
      this.destroyFpsWindow();
      if (this.preferences.overlayPerformanceEnabled) {
        overlayFpsMonitor.start(game, this.targetPid, this.targetExecutable);
      } else {
        overlayFpsMonitor.stop();
      }
    }
    this.notifyOverlayContextChanged();
  }

  private static async configureActiveGame(game: Game) {
    const preferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);
    if (
      this.activeGame?.objectId !== game.objectId ||
      this.activeGame.shop !== game.shop
    ) {
      return;
    }
    this.readPreferences(preferences);
    if (!this.preferences.overlayEnabled) {
      logger.warn("Overlay disabled in preferences", { title: game.title });
      return;
    }
    this.startActiveServices(game);
  }

  private static startActiveServices(game: Game) {
    // Both of these used to return in silence, which is why "the shortcut does
    // nothing" was indistinguishable from "the overlay was never armed".
    if (this.servicesActive || !this.preferences.overlayEnabled) {
      logger.warn("Overlay services not started", {
        title: game.title,
        alreadyActive: this.servicesActive,
        overlayEnabled: this.preferences.overlayEnabled,
      });
      return;
    }
    logger.info("Overlay services starting", { title: game.title });
    this.servicesActive = true;
    this.activationToastPending = true;
    this.activationToastShown = false;
    // Electron must reserve Shift+F3 before the native raw-input fallback is
    // started. The native watcher used to reserve the same OS hotkey first,
    // making globalShortcut.register() fail against GameHub's own process.
    const osHotkey = this.registerShortcut();
    const nativeWatcher = this.startControllerPolling();
    logger.info("Hydra overlay shortcut armed", {
      shortcut: this.registeredShortcut,
      nativeWatcher,
      osHotkey,
    });
    if (!nativeWatcher && !osHotkey) {
      logger.warn("Could not register a global Hydra overlay shortcut");
      this.servicesActive = false;
      this.stopControllerPolling();
      this.unregisterShortcut();
      return;
    }
    if (this.preferences.overlayPerformanceEnabled) {
      overlayFpsMonitor.start(game, this.targetPid, this.targetExecutable);
    }
    this.startTargetPolling();
    void this.refreshTargetProcess(game).then(() => {
      if (
        this.servicesActive &&
        this.activeGame?.objectId === game.objectId &&
        this.activeGame.shop === game.shop
      ) {
        this.synchronizeTargetWindows();
      }
    });
  }

  public static getActiveGame() {
    return this.activeGame;
  }

  public static getTargetProcessId() {
    return this.targetPid;
  }

  public static clearActiveGame(game: Game) {
    if (
      !this.activeGame ||
      this.activeGame.objectId !== game.objectId ||
      this.activeGame.shop !== game.shop
    ) {
      return;
    }

    this.activeGame = null;
    this.sessionStartedAt = 0;
    this.invalidateOverlayRendererContext(false);
    this.stopActiveServices();
    void GameRecorderManager.clearActiveGame(game);
  }

  public static async getContext(): Promise<HydraOverlayContext | null> {
    const game = this.activeGame;
    if (!game) return null;
    const contextGeneration = this.overlayContextGeneration;

    const [user, achievements, assets] = await Promise.all([
      db
        .get<string, User>(levelKeys.user, { valueEncoding: "json" })
        .catch(() => null),
      getUnlockedAchievements(game.objectId, game.shop, true).catch(() => []),
      getGameAssets(game.objectId, game.shop).catch(() => null),
    ]);

    if (
      contextGeneration !== this.overlayContextGeneration ||
      this.activeGame?.objectId !== game.objectId ||
      this.activeGame.shop !== game.shop
    ) {
      return null;
    }

    const context: HydraOverlayContext = {
      game: {
        title: game.title,
        objectId: game.objectId,
        shop: game.shop,
        iconUrl: game.customIconUrl ?? assets?.iconUrl ?? game.iconUrl,
        logoImageUrl:
          game.customLogoImageUrl ??
          assets?.logoImageUrl ??
          game.logoImageUrl ??
          (game.shop === "steam"
            ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/logo_2x.png`
            : null),
        heroImageUrl:
          game.customHeroImageUrl ??
          assets?.libraryHeroImageUrl ??
          game.libraryHeroImageUrl,
        coverImageUrl: assets?.coverImageUrl ?? null,
        playTimeInMilliseconds: game.playTimeInMilliseconds ?? 0,
        sessionStartedAt: this.sessionStartedAt,
      },
      user: user
        ? {
            displayName: user.displayName,
            profileImageUrl: user.profileImageUrl,
          }
        : null,
      achievements,
      shortcut: this.registeredShortcut ?? PREFERRED_SHORTCUT,
      keyboardShortcutAvailable:
        !this.targetPid ||
        !NativeAddon.isProcessElevated(this.targetPid) ||
        NativeAddon.isCurrentProcessElevated(),
      controllerShortcut: CONTROLLER_SHORTCUT,
      performance: this.performance,
      performancePinned: this.performancePinned,
      settings: {
        performanceEnabled: this.preferences.overlayPerformanceEnabled,
        performanceRows: {
          fps: this.preferences.overlayPerformanceShowFps,
          averageFps: this.preferences.overlayPerformanceShowAverageFps,
          frameTime: this.preferences.overlayPerformanceShowFrameTime,
          onePercentLow: this.preferences.overlayPerformanceShowOnePercentLow,
        },
      },
    };
    this.rendererContextGeneration = contextGeneration;
    return context;
  }

  public static toggleOverlay() {
    if (!this.activeGame || !this.servicesActive) {
      // The outermost gate, and the only one that still returned in total
      // silence — every "Overlay toggle ignored" line added in v1.1.28 sits
      // behind it, so this is precisely the shape of "I press the shortcut,
      // nothing happens, and the log says nothing at all".
      logger.warn("Overlay toggle ignored", {
        reason: this.activeGame ? "services not active" : "no active game",
      });
      return;
    }
    void this.toggleOverlayWindow();
  }

  public static markRendererReady() {
    if (this.rendererContextGeneration !== this.overlayContextGeneration) {
      return;
    }
    this.overlayRendererReady = true;
    for (const resolve of this.overlayRendererReadyWaiters) resolve(true);
    this.overlayRendererReadyWaiters.clear();
  }

  private static waitForRendererReady(contextGeneration: number) {
    if (contextGeneration !== this.overlayContextGeneration) {
      return Promise.resolve(false);
    }
    if (
      this.overlayRendererReady &&
      this.rendererContextGeneration === contextGeneration
    ) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      this.overlayRendererReadyWaiters.add(resolve);
    });
  }

  /**
   * Wait for the renderer, re-requesting the context whenever a reload
   * invalidates the generation mid-handshake. Returns false only if the window
   * died or the renderer stayed silent across every attempt.
   */
  private static async acquireRendererContext(overlayWindow: BrowserWindow) {
    for (let attempt = 0; attempt < RENDERER_READY_ATTEMPTS; attempt += 1) {
      const generation = this.overlayContextGeneration;
      const ready = await Promise.race([
        this.waitForRendererReady(generation),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), RENDERER_READY_TIMEOUT_MS)
        ),
      ]);
      if (ready && generation === this.overlayContextGeneration) return true;
      if (
        overlayWindow.isDestroyed() ||
        overlayWindow.webContents.isDestroyed()
      )
        return false;
      logger.warn("Overlay renderer context retry", {
        attempt,
        ready,
        contextChanged: generation !== this.overlayContextGeneration,
      });
      this.requestOverlayRendererContext();
    }
    return false;
  }

  private static resetOverlayRendererReadiness() {
    this.overlayContextGeneration += 1;
    this.overlayRendererReady = false;
    this.rendererContextGeneration = -1;
    for (const resolve of this.overlayRendererReadyWaiters) resolve(false);
    this.overlayRendererReadyWaiters.clear();
  }

  private static requestOverlayRendererContext() {
    const overlayWindow = this.overlayWindow;
    if (
      !overlayWindow ||
      overlayWindow.isDestroyed() ||
      overlayWindow.webContents.isDestroyed()
    ) {
      return;
    }
    overlayWindow.webContents.send("on-overlay-mode", "hidden");
    if (!overlayWindow.webContents.isLoadingMainFrame()) {
      overlayWindow.webContents.send("on-overlay-shown");
    }
  }

  private static invalidateOverlayRendererContext(requestRefresh: boolean) {
    this.resetOverlayRendererReadiness();
    if (requestRefresh) {
      this.requestOverlayRendererContext();
    } else if (
      this.overlayWindow &&
      !this.overlayWindow.isDestroyed() &&
      !this.overlayWindow.webContents.isDestroyed()
    ) {
      this.overlayWindow.webContents.send("on-overlay-mode", "hidden");
    }
  }

  private static async toggleOverlayWindow() {
    if (this.overlayTogglePending) {
      logger.warn("Overlay toggle ignored", { reason: "toggle in progress" });
      return;
    }
    this.overlayTogglePending = true;

    try {
      if (this.overlayWindow?.isVisible()) {
        const now = Date.now();
        if (now - this.lastToggleAt < TOGGLE_DEBOUNCE_MS) return;
        this.lastToggleAt = now;
        if (this.isTargetForeground(true)) {
          this.hideOverlay();
        } else {
          this.hideOverlayWindow(false, false);
        }
        return;
      }

      const game = this.activeGame;
      if (!game) {
        logger.warn("Overlay toggle ignored", { reason: "no active game" });
        return;
      }
      // Target discovery can enumerate every process in the install tree. The
      // 125 ms window tracker has normally already selected the visible game,
      // so keep the shortcut path synchronous when that cached target still
      // owns the foreground. Rescan only when the cached target is stale.
      let targetBounds = this.getTargetBounds();
      if (!targetBounds || !this.isTargetForeground(false)) {
        await this.refreshTargetProcess(game);
        targetBounds = this.getTargetBounds();
      }
      if (
        !this.activeGame ||
        this.activeGame.objectId !== game.objectId ||
        this.activeGame.shop !== game.shop
      ) {
        logger.warn("Overlay toggle ignored", {
          reason: "active game changed",
        });
        return;
      }
      // Every early return here looks identical from outside — the shortcut
      // simply does nothing — so name the one that fired.
      if (!targetBounds || !this.isTargetForeground(false)) {
        logger.warn("Overlay toggle ignored", {
          reason: !targetBounds ? "no target bounds" : "target not foreground",
          targetPid: this.targetPid,
          foregroundPid: NativeAddon.getForegroundProcessId(),
        });
        return;
      }

      const now = Date.now();
      if (now - this.lastToggleAt < TOGGLE_DEBOUNCE_MS) {
        logger.warn("Overlay toggle ignored", { reason: "debounced" });
        return;
      }
      this.lastToggleAt = now;

      const windowMode = await this.resolveWindowModeEligibility(
        targetBounds,
        true
      );
      if (!windowMode.allowed) {
        logger.warn("Overlay window mode rejected", {
          targetPid: this.targetPid,
          reason: windowMode.reason,
        });
        this.showOverlayUnavailableToast(targetBounds, windowMode.reason);
        return;
      }

      const overlayWindow = this.ensureOverlayWindow(targetBounds);
      if (
        !this.overlayRendererReady &&
        !overlayWindow.webContents.isLoadingMainFrame()
      ) {
        this.requestOverlayRendererContext();
      }
      const openingTargetPid = this.targetPid;

      const show = async () => {
        const rendererReady = await this.acquireRendererContext(overlayWindow);
        if (
          !rendererReady ||
          overlayWindow.isDestroyed() ||
          this.activeGame?.objectId !== game.objectId ||
          this.activeGame.shop !== game.shop ||
          this.targetPid !== openingTargetPid
        ) {
          logger.warn("Overlay show aborted", {
            rendererReady,
            destroyed: overlayWindow.isDestroyed(),
            gameChanged: this.activeGame?.objectId !== game.objectId,
            targetChanged: this.targetPid !== openingTargetPid,
          });
          return;
        }
        const currentBounds = this.getTargetBounds();
        if (!currentBounds || !this.isTargetForeground(false)) {
          logger.warn("Overlay show aborted", {
            reason: !currentBounds
              ? "no target bounds"
              : "target not foreground",
          });
          return;
        }
        const currentWindowMode = await this.resolveWindowModeEligibility(
          currentBounds,
          true
        );
        if (!currentWindowMode.allowed) {
          this.showOverlayUnavailableToast(
            currentBounds,
            currentWindowMode.reason
          );
          return;
        }
        this.activationToastPending = false;
        this.activationToastShown = true;
        this.destroyToast();
        this.fpsWindow?.hide();
        this.fpsWindow?.setAlwaysOnTop(false);
        this.placeWindowOverGame(overlayWindow, currentBounds);
        overlayWindow.setAlwaysOnTop(false);
        overlayWindow.setAlwaysOnTop(true, "screen-saver", 1);
        this.overlayActivationGraceUntil =
          Date.now() + OVERLAY_ACTIVATION_GRACE_MS;
        overlayWindow.show();
        overlayWindow.moveTop();
        overlayWindow.focus();
        const ownsForeground = await this.claimForeground(overlayWindow);
        const delayedBounds = this.getTargetBounds();
        if (
          !ownsForeground ||
          overlayWindow.isDestroyed() ||
          !overlayWindow.isVisible() ||
          !delayedBounds ||
          this.targetPid !== openingTargetPid
        ) {
          this.hideOverlayWindow(false, false);
          if (delayedBounds) {
            this.showOverlayUnavailableToast(delayedBounds, "focus-refused");
          }
          return;
        }
        overlayWindow.setAlwaysOnTop(true, "screen-saver", 1);
        this.placeWindowOverGame(overlayWindow, delayedBounds);
        overlayWindow.moveTop();
        overlayWindow.webContents.send("on-overlay-shown");
      };

      if (overlayWindow.webContents.isLoadingMainFrame()) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timeout);
            resolve();
          };
          const timeout = setTimeout(() => {
            overlayWindow.webContents.removeListener("did-finish-load", finish);
            resolve();
          }, RENDERER_READY_TIMEOUT_MS);
          overlayWindow.webContents.once("did-finish-load", finish);
        });
      }
      await show();
    } catch (error) {
      this.hideOverlayWindow(false, false);
      logger.error("Overlay toggle failed", error);
    } finally {
      this.overlayTogglePending = false;
    }
  }

  public static hideOverlay() {
    this.hideOverlayWindow(true, true);
  }

  /** Hide for a launcher navigation without returning focus to the game. */
  public static hideOverlayForMainWindow() {
    this.hideOverlayWindow(false, false);
  }

  /**
   * Require real foreground ownership before exposing interactive controls.
   * The native helper only performs normal Win32 focus hand-off; it never
   * modifies the game. If a game keeps display ownership, activation closes
   * and asks for Borderless or Windowed mode.
   */
  private static async claimForeground(overlayWindow: BrowserWindow) {
    if (process.platform !== "win32") return true;
    for (
      let attempt = 0;
      attempt <= OVERLAY_FOREGROUND_ATTEMPTS;
      attempt += 1
    ) {
      if (overlayWindow.isDestroyed() || !overlayWindow.isVisible()) {
        return false;
      }
      try {
        const handle = overlayWindow.getNativeWindowHandle();
        // HWND is pointer-sized; Electron hands it over as raw little-endian
        // bytes, so read the full 64 bits on x64.
        const hwnd =
          handle.length >= 8
            ? Number(handle.readBigUInt64LE(0))
            : handle.readUInt32LE(0);
        if (!hwnd) {
          logger.warn("Overlay window has no native handle to focus");
          return false;
        }

        const claimed = NativeAddon.forceForegroundWindow(hwnd);
        const foregroundPid = NativeAddon.getForegroundProcessId();
        const won =
          claimed && foregroundPid === process.pid && overlayWindow.isFocused();

        // Report the outcome rather than assume it. If the game keeps the
        // foreground, it also keeps keyboard, mouse and controller input, and
        // that is invisible from the app side without this.
        logger[won || attempt >= OVERLAY_FOREGROUND_ATTEMPTS ? "info" : "warn"](
          "Overlay foreground claim",
          {
            attempt,
            claimed,
            foregroundPid,
            gamePid: this.targetPid,
            overlayHasForeground: won,
          }
        );

        if (won) return true;
      } catch (error) {
        logger.warn("Could not bring the overlay to the foreground", error);
      }
      if (attempt < OVERLAY_FOREGROUND_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, OVERLAY_FOREGROUND_RETRY_MS)
        );
      }
    }
    return false;
  }

  private static hideOverlayWindow(
    restoreGameFocus: boolean,
    showPinnedPerformance: boolean
  ) {
    this.overlayActivationGraceUntil = 0;
    const overlayWindow = this.overlayWindow;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
      overlayWindow.setAlwaysOnTop(false);
    }
    if (
      showPinnedPerformance &&
      this.activeGame &&
      this.performancePinned &&
      this.isTargetForeground(false)
    ) {
      this.showFpsWindow();
    }
    if (!restoreGameFocus) return;
    const pid = this.targetPid;
    if (pid) setTimeout(() => NativeAddon.focusProcessWindow(pid), 25);
  }

  public static setPerformancePinned(pinned: boolean) {
    if (!this.preferences.overlayPerformanceEnabled) return;
    this.performancePinned = pinned;
    this.overlayWindow?.webContents.send("on-overlay-performance-pin", pinned);
    if (!pinned) {
      this.destroyFpsWindow();
    } else if (
      !this.overlayWindow?.isVisible() &&
      this.isTargetForeground(false)
    ) {
      this.showFpsWindow();
    }
  }

  private static ensureOverlayWindow(bounds: Electron.Rectangle) {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      return this.overlayWindow;
    }

    this.lastOverlayPlacement = null;
    const electronBounds = this.toElectronBounds(bounds);
    const overlayWindow = new BrowserWindow({
      x: electronBounds.x,
      y: electronBounds.y,
      width: electronBounds.width,
      height: electronBounds.height,
      show: false,
      transparent: true,
      backgroundColor: "#00000000",
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
        backgroundThrottling: false,
      },
    });

    overlayWindow.removeMenu();
    overlayWindow.webContents.on("did-start-loading", () => {
      this.resetOverlayRendererReadiness();
    });
    WindowManager.loadWindowURL(overlayWindow, "overlay");

    if ((!app.isPackaged || isStaging) && process.env.HYDRA_OVERLAY_DEVTOOLS) {
      overlayWindow.webContents.openDevTools({ mode: "detach" });
    }

    overlayWindow.on("closed", () => {
      // Teardown clears the reference before destroy(); do not let a delayed
      // `closed` event from the previous session wipe a replacement renderer.
      if (this.overlayWindow === overlayWindow) {
        this.overlayWindow = null;
        this.lastOverlayPlacement = null;
        this.overlayRendererReady = false;
        this.rendererContextGeneration = -1;
        for (const resolve of this.overlayRendererReadyWaiters) resolve(false);
        this.overlayRendererReadyWaiters.clear();
      }
    });
    overlayWindow.on("blur", () => {
      setTimeout(() => {
        if (overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return;
        if (!this.isTargetForeground(true)) {
          this.hideOverlayWindow(false, false);
          return;
        }
        this.synchronizeTargetWindows();
      }, 75);
    });

    this.overlayWindow = overlayWindow;
    return overlayWindow;
  }

  private static async refreshTargetProcess(game: Game) {
    if (this.targetRefreshPending) return this.targetPid;
    this.targetRefreshPending = true;
    try {
      const candidates = await findOverlayGameProcesses(
        game,
        this.targetPid,
        Boolean(this.overlayWindow?.isVisible())
      );
      if (
        !this.servicesActive ||
        this.activeGame?.objectId !== game.objectId ||
        this.activeGame.shop !== game.shop
      ) {
        return this.targetPid;
      }
      // A configured executable may deliberately be a long-lived loader (for
      // example Khazan's steamclient_loader_x64.exe). It owns the play session,
      // but is not a render surface and must never receive overlay/PresentMon.
      const eligibleCandidates = excludeOverlayLaunchHelpers(candidates);
      const visiblePids = new Set(
        eligibleCandidates
          .filter((candidate) =>
            Boolean(NativeAddon.getProcessWindowBounds(candidate.pid))
          )
          .map((candidate) => candidate.pid)
      );
      const foregroundPid = NativeAddon.getForegroundProcessId();
      const target = selectUnambiguousOverlayRenderProcess(
        eligibleCandidates,
        visiblePids,
        this.targetPid,
        foregroundPid
      );
      if (!target && visiblePids.size > 1) {
        logger.warn("Overlay render target is ambiguous; input gate disabled", {
          foregroundPid,
          visiblePids: [...visiblePids],
        });
      }
      const candidatePid = target?.pid ?? 0;
      const targetCreationTicks = candidatePid
        ? NativeAddon.getProcessCreationTimeTicks(candidatePid)
        : null;
      const targetPid =
        process.platform !== "win32" || targetCreationTicks ? candidatePid : 0;
      const targetExecutable = targetPid ? (target?.exe ?? null) : null;
      const targetChanged =
        targetPid !== this.targetPid ||
        targetExecutable !== this.targetExecutable ||
        targetCreationTicks !== this.targetCreationTicks;
      if (targetChanged && this.overlayWindow?.isVisible()) {
        // Hide before publishing a loader -> renderer handoff.
        this.hideOverlayWindow(false, false);
      }
      this.targetPid = targetPid;
      this.targetExecutable = targetExecutable;
      this.targetCreationTicks = targetPid ? targetCreationTicks : null;
      this.lastTargetRefreshAt = Date.now();
      if (targetChanged) {
        this.lastOverlayPlacement = null;
        this.windowModeEligibility = null;
        this.windowModeCheck = null;
        logger.info("GameHub overlay render target changed", {
          pid: targetPid,
          executable: targetExecutable,
        });
        if (this.preferences.overlayPerformanceEnabled) {
          overlayFpsMonitor.setTargetProcess(targetPid, targetExecutable);
        }
      }
      return this.targetPid;
    } finally {
      this.targetRefreshPending = false;
    }
  }

  private static getTargetBounds(): Electron.Rectangle | null {
    if (this.targetPid) {
      const bounds = NativeAddon.getProcessWindowBounds(this.targetPid);
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        };
      }
    }
    if (process.platform === "win32") return null;
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
  }

  private static resolveWindowModeEligibility(
    targetBounds: Electron.Rectangle,
    force = false
  ): Promise<OverlayWindowModeEligibility> {
    if (!force && this.windowModeEligibility) {
      return Promise.resolve(this.windowModeEligibility);
    }
    if (this.windowModeCheck) return this.windowModeCheck;

    const targetPid = this.targetPid;
    const targetCreationTicks = this.targetCreationTicks;
    const check = (async () => {
      if (process.platform !== "win32") {
        return evaluateOverlayWindowMode({
          platform: process.platform,
          targetWindowId: null,
          exactWindowSourceAvailable: false,
          displaySized: false,
        });
      }

      const nativeBounds = targetPid
        ? NativeAddon.getProcessWindowBounds(targetPid)
        : null;
      const targetWindowId =
        nativeBounds?.windowId ?? nativeBounds?.window_id ?? null;
      const display = screen.getDisplayMatching({
        x: targetBounds.x,
        y: targetBounds.y,
        width: Math.max(1, targetBounds.width),
        height: Math.max(1, targetBounds.height),
      });
      const sources = targetWindowId
        ? await desktopCapturer
            .getSources({
              types: ["window"],
              thumbnailSize: { width: 0, height: 0 },
              fetchWindowIcons: false,
            })
            .catch(() => [])
        : [];
      return evaluateOverlayWindowMode({
        platform: process.platform,
        targetWindowId,
        exactWindowSourceAvailable: Boolean(
          targetWindowId &&
            sources.some((source) =>
              isExactDesktopWindowSource(source.id, targetWindowId)
            )
        ),
        displaySized: isGameWindowDisplaySized(nativeBounds, display),
      });
    })();

    this.windowModeCheck = check;
    return check
      .then((eligibility) => {
        if (
          this.targetPid === targetPid &&
          this.targetCreationTicks === targetCreationTicks
        ) {
          this.windowModeEligibility = eligibility;
        }
        return eligibility;
      })
      .finally(() => {
        if (this.windowModeCheck === check) this.windowModeCheck = null;
      });
  }

  private static isTargetForeground(includeOverlayWindow: boolean) {
    if (process.platform !== "win32") return true;
    return isOverlayInteractionForeground({
      targetPid: this.targetPid,
      foregroundPid: NativeAddon.getForegroundProcessId(),
      appPid: process.pid,
      overlayVisible:
        includeOverlayWindow && Boolean(this.overlayWindow?.isVisible()),
      overlayFocused:
        includeOverlayWindow && Boolean(this.overlayWindow?.isFocused()),
      activationGraceUntil: includeOverlayWindow
        ? this.overlayActivationGraceUntil
        : 0,
      now: Date.now(),
    });
  }

  /** Convert Win32 physical screen coordinates before using Electron bounds. */
  private static toElectronBounds(bounds: Electron.Rectangle) {
    if (process.platform !== "win32") return bounds;
    try {
      return screen.screenToDipRect(null, bounds);
    } catch {
      return bounds;
    }
  }

  private static placeWindowOverGame(
    window: BrowserWindow,
    bounds: Electron.Rectangle
  ) {
    if (window.isDestroyed()) return;
    const previous = this.lastOverlayPlacement;
    if (
      previous &&
      previous.x === bounds.x &&
      previous.y === bounds.y &&
      previous.width === bounds.width &&
      previous.height === bounds.height
    ) {
      return;
    }
    if (process.platform === "win32" && this.targetPid) {
      if (
        NativeAddon.placeOverlayWindow(
          window.getNativeWindowHandle(),
          this.targetPid
        )
      ) {
        this.lastOverlayPlacement = { ...bounds };
        return;
      }
      // Keep the fallback safe for DPI, but do not cache a failed native
      // placement: the next tracker tick must be allowed to retry it.
      window.setBounds(this.toElectronBounds(bounds));
      this.lastOverlayPlacement = null;
      return;
    }
    window.setBounds(this.toElectronBounds(bounds));
    this.lastOverlayPlacement = { ...bounds };
  }

  private static startTargetPolling() {
    this.stopTargetPolling();
    this.targetPoll = setInterval(() => {
      const game = this.activeGame;
      if (!game) return;
      if (Date.now() - this.lastTargetRefreshAt >= 2_000) {
        void this.refreshTargetProcess(game).then(() =>
          this.synchronizeTargetWindows()
        );
        return;
      }
      this.synchronizeTargetWindows();
    }, 125);
  }

  private static stopTargetPolling() {
    if (this.targetPoll) clearInterval(this.targetPoll);
    this.targetPoll = null;
    this.targetRefreshPending = false;
    this.lastTargetRefreshAt = 0;
  }

  private static synchronizeTargetWindows() {
    if (!this.servicesActive || !this.activeGame) return;
    const bounds = this.getTargetBounds();
    const isForeground = Boolean(bounds) && this.isTargetForeground(true);

    if (!bounds || !isForeground) {
      if (this.overlayWindow?.isVisible()) {
        this.hideOverlayWindow(false, false);
      }
      this.destroyToast();
      if (this.fpsWindow && !this.fpsWindow.isDestroyed()) {
        this.fpsWindow.hide();
        this.fpsWindow.setAlwaysOnTop(false);
      }
      return;
    }

    if (this.overlayWindow?.isVisible()) {
      if (
        process.platform === "win32" &&
        (NativeAddon.getForegroundProcessId() !== process.pid ||
          !this.overlayWindow.isFocused())
      ) {
        this.hideOverlayWindow(false, false);
        return;
      }
      this.overlayWindow.setAlwaysOnTop(true, "screen-saver", 1);
      this.placeWindowOverGame(this.overlayWindow, bounds);
      this.destroyToast();
      if (this.fpsWindow && !this.fpsWindow.isDestroyed()) {
        this.fpsWindow.hide();
        this.fpsWindow.setAlwaysOnTop(false);
      }
      return;
    }

    // Warm the renderer while the game is in view. The ready notification must
    // mean that the actual overlay (including its game context) is painted and
    // can open immediately, not merely that a shortcut was registered.
    this.ensureOverlayWindow(bounds);

    if (!this.windowModeEligibility && !this.windowModeCheck) {
      void this.resolveWindowModeEligibility(bounds).then(() =>
        this.synchronizeTargetWindows()
      );
      return;
    }

    if (
      canShowActivationToast(
        this.activationToastPending,
        this.activationToastShown,
        this.overlayRendererReady,
        this.windowModeEligibility?.allowed === true
      ) &&
      !this.toastWindow
    ) {
      this.showActivationToast(bounds);
    } else if (this.toastWindow?.isVisible()) {
      this.toastWindow.setBounds(this.getActivationToastBounds(bounds));
    }

    if (this.performancePinned) {
      this.showFpsWindow(bounds);
    } else if (this.fpsWindow?.isVisible()) {
      this.fpsWindow.hide();
      this.fpsWindow.setAlwaysOnTop(false);
    }
  }

  private static getActivationToastBounds(
    targetBounds: Electron.Rectangle,
    kind: OverlayActivationToastKind = this.toastKind
  ): Electron.Rectangle {
    return calculateActivationToastBounds(
      this.toElectronBounds(targetBounds),
      kind
    );
  }

  private static showActivationToast(targetBounds: Electron.Rectangle) {
    if (
      !this.activationToastPending ||
      this.activationToastShown ||
      !this.isTargetForeground(false)
    ) {
      return;
    }
    this.destroyToast();
    this.toastKind = "ready";
    const toastBounds = this.getActivationToastBounds(targetBounds, "ready");

    const toastWindow = new BrowserWindow({
      ...toastBounds,
      show: false,
      transparent: true,
      backgroundColor: "#00000000",
      frame: false,
      hasShadow: false,
      focusable: false,
      resizable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
    });

    toastWindow.removeMenu();
    toastWindow.setIgnoreMouseEvents(true);
    WindowManager.loadWindowURL(toastWindow, "overlay-toast");
    toastWindow.once("ready-to-show", () => {
      const bounds = this.getTargetBounds();
      if (
        this.toastWindow !== toastWindow ||
        !bounds ||
        !this.isTargetForeground(false)
      ) {
        if (this.toastWindow === toastWindow) this.destroyToast();
        return;
      }
      this.activationToastPending = false;
      this.activationToastShown = true;
      toastWindow.setBounds(this.getActivationToastBounds(bounds, "ready"));
      toastWindow.setAlwaysOnTop(true, "screen-saver", 1);
      toastWindow.showInactive();
      setTimeout(() => {
        if (this.toastWindow === toastWindow) this.destroyToast();
      }, 8_000);
    });
    toastWindow.on("closed", () => {
      if (this.toastWindow === toastWindow) this.toastWindow = null;
    });

    this.toastWindow = toastWindow;
  }

  private static showOverlayUnavailableToast(
    targetBounds: Electron.Rectangle,
    reason: OverlayWindowModeFailureReason | "focus-refused"
  ) {
    if (!this.activeGame) return;
    this.destroyToast();
    this.toastKind = "error";
    const toastBounds = this.getActivationToastBounds(targetBounds, "error");
    const toastWindow = new BrowserWindow({
      ...toastBounds,
      show: false,
      transparent: true,
      backgroundColor: "#00000000",
      frame: false,
      hasShadow: false,
      focusable: false,
      resizable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
    });

    toastWindow.removeMenu();
    toastWindow.setIgnoreMouseEvents(true);
    WindowManager.loadWindowURL(
      toastWindow,
      `overlay-toast?kind=overlay-unavailable&reason=${reason}`
    );
    toastWindow.once("ready-to-show", () => {
      const bounds = this.getTargetBounds();
      if (
        this.toastWindow !== toastWindow ||
        !bounds ||
        !this.isTargetForeground(false)
      ) {
        if (this.toastWindow === toastWindow) this.destroyToast();
        return;
      }
      toastWindow.setBounds(this.getActivationToastBounds(bounds, "error"));
      toastWindow.setAlwaysOnTop(true, "screen-saver", 1);
      toastWindow.showInactive();
      setTimeout(() => {
        if (this.toastWindow === toastWindow) this.destroyToast();
      }, 8_000);
    });
    toastWindow.on("closed", () => {
      if (this.toastWindow === toastWindow) this.toastWindow = null;
    });
    this.toastWindow = toastWindow;
  }

  private static destroyToast() {
    if (this.toastWindow && !this.toastWindow.isDestroyed()) {
      this.toastWindow.destroy();
    }
    this.toastWindow = null;
    this.toastKind = "ready";
  }

  private static updatePerformance(metrics: HydraOverlayPerformance) {
    this.performance = metrics;
    if (!this.activeGame) return;
    this.fpsWindow?.webContents.send("on-overlay-performance", metrics);
    this.overlayWindow?.webContents.send("on-overlay-performance", metrics);
  }

  private static readPreferences(preferences: UserPreferences | null) {
    this.preferences = resolveHydraOverlayPreferences(preferences);
  }

  private static notifyOverlayContextChanged() {
    this.fpsWindow?.webContents.send("on-overlay-shown");
    this.overlayWindow?.webContents.send("on-overlay-shown");
  }

  private static stopActiveServices() {
    // Cleanup is intentionally unconditional. A partial shortcut/controller
    // startup failure can leave servicesActive false after PresentMon or one of
    // the windows was already created, and early-returning here strands those
    // resources until the launcher exits.
    this.servicesActive = false;
    this.hideOverlayWindow(false, false);
    this.destroyOverlayWindow();
    this.destroyToast();
    this.unregisterShortcut();
    this.stopControllerPolling();
    this.stopTargetPolling();
    overlayFpsMonitor.stop();
    this.destroyFpsWindow();
    this.performancePinned = false;
    this.performance = emptyPerformance();
    this.targetPid = 0;
    this.targetExecutable = null;
    this.targetCreationTicks = null;
    this.windowModeEligibility = null;
    this.windowModeCheck = null;
    this.lastOverlayPlacement = null;
    this.activationToastPending = false;
    this.activationToastShown = false;
  }

  private static destroyOverlayWindow() {
    const overlayWindow = this.overlayWindow;
    destroyOverlayWindow(overlayWindow, () => {
      if (this.overlayWindow === overlayWindow) this.overlayWindow = null;
    });
    this.lastOverlayPlacement = null;
    this.overlayRendererReady = false;
    this.rendererContextGeneration = -1;
    for (const resolve of this.overlayRendererReadyWaiters) resolve(false);
    this.overlayRendererReadyWaiters.clear();
  }

  private static showFpsWindow(targetBounds = this.getTargetBounds()) {
    if (
      !targetBounds ||
      !this.servicesActive ||
      !this.performancePinned ||
      this.overlayWindow?.isVisible() ||
      !this.isTargetForeground(false)
    ) {
      return;
    }

    const fpsWindow = this.ensureFpsWindow(targetBounds);
    if (fpsWindow.isVisible()) {
      const electronBounds = this.toElectronBounds(targetBounds);
      fpsWindow.setPosition(electronBounds.x + 24, electronBounds.y + 24);
      fpsWindow.setAlwaysOnTop(true, "screen-saver", 1);
      return;
    }
    const show = () => {
      const bounds = this.getTargetBounds();
      if (
        fpsWindow.isDestroyed() ||
        !bounds ||
        !this.performancePinned ||
        this.overlayWindow?.isVisible() ||
        !this.isTargetForeground(false)
      ) {
        return;
      }
      const electronBounds = this.toElectronBounds(bounds);
      fpsWindow.setPosition(electronBounds.x + 24, electronBounds.y + 24);
      fpsWindow.setAlwaysOnTop(true, "screen-saver", 1);
      fpsWindow.showInactive();
    };
    if (fpsWindow.webContents.isLoadingMainFrame()) {
      fpsWindow.webContents.once("did-finish-load", show);
    } else {
      show();
    }
  }

  private static ensureFpsWindow(targetBounds: Electron.Rectangle) {
    if (this.fpsWindow && !this.fpsWindow.isDestroyed()) return this.fpsWindow;
    const electronBounds = this.toElectronBounds(targetBounds);
    const fpsWindow = new BrowserWindow({
      x: electronBounds.x + 24,
      y: electronBounds.y + 24,
      width: FPS_WIDTH,
      height: FPS_HEIGHT,
      show: false,
      transparent: true,
      backgroundColor: "#00000000",
      frame: false,
      focusable: false,
      resizable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    fpsWindow.removeMenu();
    fpsWindow.setIgnoreMouseEvents(true);
    WindowManager.loadWindowURL(fpsWindow, "overlay-fps");
    fpsWindow.on("closed", () => {
      if (this.fpsWindow === fpsWindow) this.fpsWindow = null;
    });
    this.fpsWindow = fpsWindow;
    return fpsWindow;
  }

  private static destroyFpsWindow() {
    if (this.fpsWindow && !this.fpsWindow.isDestroyed())
      this.fpsWindow.destroy();
    this.fpsWindow = null;
  }

  /**
   * Arm every shortcut path we have rather than the first one that reports
   * success.
   *
   * This used to return as soon as the native raw-input watcher started, so on
   * Windows the OS hotkey was never registered and that watcher became a single
   * point of failure: if its event counter stopped advancing, the shortcut did
   * nothing whatsoever — and did it silently, because toggleOverlay() is only
   * ever reached once one of these fires. Registering both is safe: a double
   * toggle is absorbed by TOGGLE_DEBOUNCE_MS.
   */
  private static registerShortcut() {
    this.unregisterShortcut();

    this.registeredShortcut = PREFERRED_SHORTCUT;

    let osHotkey = globalShortcut.register(PREFERRED_SHORTCUT, () =>
      this.handleShortcutTrigger("os-hotkey")
    );

    // Other overlays may reserve Shift+F3 on Windows too. Keep the native
    // Shift+F3 watcher and advertise the working OS fallback when it is taken.
    if (!osHotkey) {
      osHotkey = globalShortcut.register(FALLBACK_SHORTCUT, () =>
        this.handleShortcutTrigger("os-hotkey")
      );
      if (osHotkey) this.registeredShortcut = FALLBACK_SHORTCUT;
    }

    if (osHotkey) this.registeredWithElectron = true;
    return osHotkey;
  }

  private static handleShortcutTrigger(
    source:
      | "os-hotkey"
      | "raw-input"
      | "guide"
      | "controller-chord"
      | "window-keyboard"
  ) {
    logger.info("Overlay shortcut triggered", { source });
    this.toggleOverlay();
  }

  private static unregisterShortcut() {
    if (this.registeredShortcut && this.registeredWithElectron) {
      globalShortcut.unregister(this.registeredShortcut);
    }
    this.registeredShortcut = null;
    this.registeredWithElectron = false;
  }

  private static startControllerPolling() {
    this.stopControllerPolling();
    const rawInputActive =
      process.platform === "win32" && NativeAddon.startOverlayKeyboardWatcher();
    if (!rawInputActive && process.platform === "win32") {
      logger.warn(
        "GameHub native keyboard shortcut watcher could not be started"
      );
    }
    this.keyboardEventCount = NativeAddon.getOverlayKeyboardEventCount();
    this.controllerPoll = setInterval(() => {
      const keyboardEventCount = NativeAddon.getOverlayKeyboardEventCount();
      const gamepadButtons = NativeAddon.getOverlayGamepadButtons();
      const isGuidePressed = (gamepadButtons & GAMEPAD_GUIDE_BUTTON) !== 0;
      const isFallbackChordPressed =
        (gamepadButtons & GAMEPAD_OVERLAY_CHORD) === GAMEPAD_OVERLAY_CHORD;
      const isTogglePressed = isGuidePressed || isFallbackChordPressed;
      if (keyboardEventCount !== this.keyboardEventCount) {
        this.handleShortcutTrigger("raw-input");
      }
      if (isTogglePressed && !this.wasControllerTogglePressed) {
        this.handleShortcutTrigger(
          isGuidePressed ? "guide" : "controller-chord"
        );
      }
      this.processGamepadNavigation(gamepadButtons);
      this.keyboardEventCount = keyboardEventCount;
      this.wasControllerTogglePressed = isTogglePressed;
    }, 32);
    return rawInputActive;
  }

  private static stopControllerPolling() {
    if (this.controllerPoll) clearInterval(this.controllerPoll);
    this.controllerPoll = null;
    if (process.platform === "win32") {
      const stopped = NativeAddon.stopOverlayKeyboardWatcher();
      if (!stopped) {
        logger.warn("GameHub Raw Input shortcut watcher did not stop cleanly");
      }
    }
    this.keyboardEventCount = 0;
    this.wasControllerTogglePressed = false;
    this.previousGamepadButtons = 0;
    this.repeatingGamepadButton = 0;
    this.nextGamepadRepeatAt = 0;
  }

  private static processGamepadNavigation(buttons: number) {
    const overlayVisible = Boolean(this.overlayWindow?.isVisible());
    if (!overlayVisible) {
      this.previousGamepadButtons = buttons;
      this.repeatingGamepadButton = 0;
      return;
    }

    const risingButtons = buttons & ~this.previousGamepadButtons;
    const risingAction = GAMEPAD_ACTIONS.find(
      ([button]) => (risingButtons & button) !== 0
    );
    const now = Date.now();
    if (risingAction) {
      this.sendGamepadAction(risingAction[1]);
      if ((risingAction[0] & GAMEPAD_DIRECTION_MASK) !== 0) {
        this.repeatingGamepadButton = risingAction[0];
        this.nextGamepadRepeatAt = now + GAMEPAD_REPEAT_DELAY_MS;
      }
    } else {
      const heldDirection = GAMEPAD_ACTIONS.find(
        ([button]) =>
          (button & GAMEPAD_DIRECTION_MASK) !== 0 && (buttons & button) !== 0
      );
      if (!heldDirection) {
        this.repeatingGamepadButton = 0;
      } else if (this.repeatingGamepadButton !== heldDirection[0]) {
        this.repeatingGamepadButton = heldDirection[0];
        this.nextGamepadRepeatAt = now + GAMEPAD_REPEAT_DELAY_MS;
      } else if (now >= this.nextGamepadRepeatAt) {
        this.sendGamepadAction(heldDirection[1]);
        this.nextGamepadRepeatAt = now + GAMEPAD_REPEAT_INTERVAL_MS;
      }
    }
    this.previousGamepadButtons = buttons;
  }

  private static sendGamepadAction(action: HydraOverlayGamepadAction) {
    this.overlayWindow?.webContents.send("on-overlay-gamepad-action", action);
  }

  private static dispose() {
    this.stopActiveServices();
    this.performance = emptyPerformance();
  }
}
