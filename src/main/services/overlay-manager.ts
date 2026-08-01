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
import { BrowserWindow, app, globalShortcut, screen } from "electron";
import path from "node:path";
import { getUnlockedAchievements } from "@main/events/user/get-unlocked-achievements";
import { getGameAssets } from "@main/events/catalogue/get-game-assets";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";
import { OverlayBroker } from "./overlay-broker";
import { findOverlayGameProcesses } from "./overlay-game-process";
import { overlayFpsMonitor } from "./overlay-fps-monitor";
import { WindowManager } from "./window-manager";
import { GameRecorderManager } from "./game-recorder-manager";

const PREFERRED_SHORTCUT = "Shift+F3";
const FALLBACK_SHORTCUT = "Control+Shift+F3";
const CONTROLLER_SHORTCUT = "Guide";
// The toast is a single line of text, so it is sized wide and short: the extra
// width keeps the shortcut hint on one line instead of wrapping (and being
// clipped), and the reduced height keeps it out of the way of the game.
const TOAST_WIDTH = 820;
const TOAST_HEIGHT = 118;
const TOAST_MARGIN = 24;
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
  /** PID the input gate is currently loaded into, 0 when not injected. */
  private static inputHookPid = 0;
  private static inputBlocked = false;
  private static activationToastPending = false;
  private static activationToastShown = false;
  private static overlayRendererReady = false;
  private static overlayContextGeneration = 0;
  private static rendererContextGeneration = -1;
  private static overlayRendererReadyWaiters = new Set<
    (ready: boolean) => void
  >();

  public static initialize() {
    GameRecorderManager.initialize();
    overlayFpsMonitor.setUpdateHandler((metrics) =>
      this.updatePerformance(metrics)
    );
    app.once("will-quit", () => this.dispose());
  }

  public static setActiveGame(game: Game) {
    if (
      this.activeGame?.objectId === game.objectId &&
      this.activeGame.shop === game.shop
    ) {
      return;
    }

    this.stopActiveServices();
    this.activeGame = game;
    this.sessionStartedAt = Date.now();
    this.performancePinned = false;
    this.invalidateOverlayRendererContext(true);
    void GameRecorderManager.setActiveGame(game);
    void this.configureActiveGame(game);
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
    if (this.preferences.overlayEnabled) this.startActiveServices(game);
  }

  private static startActiveServices(game: Game) {
    if (this.servicesActive || !this.preferences.overlayEnabled) return;
    this.servicesActive = true;
    this.activationToastPending = true;
    this.activationToastShown = false;
    const nativeKeyboardActive = this.startControllerPolling();
    this.registerShortcut(nativeKeyboardActive);
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
    if (!this.activeGame || !this.servicesActive) return;
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
    await this.refreshTargetProcess(game);
    if (
      !this.activeGame ||
      this.activeGame.objectId !== game.objectId ||
      this.activeGame.shop !== game.shop
    ) {
      logger.warn("Overlay toggle ignored", { reason: "active game changed" });
      return;
    }
    const targetBounds = this.getTargetBounds();
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

    const overlayWindow = this.ensureOverlayWindow(targetBounds);
    if (
      !this.overlayRendererReady &&
      !overlayWindow.webContents.isLoadingMainFrame()
    ) {
      this.requestOverlayRendererContext();
    }

    const show = async () => {
      const rendererReady = await this.acquireRendererContext(overlayWindow);
      if (
        !rendererReady ||
        overlayWindow.isDestroyed() ||
        this.activeGame?.objectId !== game.objectId ||
        this.activeGame.shop !== game.shop
      ) {
        logger.warn("Overlay show aborted", {
          rendererReady,
          destroyed: overlayWindow.isDestroyed(),
          gameChanged: this.activeGame?.objectId !== game.objectId,
        });
        return;
      }
      const currentBounds = this.getTargetBounds();
      if (!currentBounds || !this.isTargetForeground(false)) {
        logger.warn("Overlay show aborted", {
          reason: !currentBounds ? "no target bounds" : "target not foreground",
        });
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
      overlayWindow.show();
      this.placeWindowOverGame(overlayWindow, currentBounds);
      overlayWindow.moveTop();
      overlayWindow.focus();
      overlayWindow.webContents.send("on-overlay-shown");
      this.claimForeground(overlayWindow);
      this.setGameInputBlocked(true);
      setTimeout(() => {
        if (!overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
          const delayedBounds = this.getTargetBounds();
          if (!delayedBounds || !this.isTargetForeground(true)) {
            this.hideOverlayWindow(false, false);
            return;
          }
          overlayWindow.setAlwaysOnTop(true, "screen-saver", 1);
          this.placeWindowOverGame(overlayWindow, delayedBounds);
          overlayWindow.moveTop();
          overlayWindow.focus();
          // A fullscreen game commonly grabs the foreground straight back after
          // being covered. Re-assert it, otherwise the game keeps keyboard,
          // mouse and controller input while the overlay is on screen.
          this.claimForeground(overlayWindow);
        }
      }, 75);
    };

    if (overlayWindow.webContents.isLoadingMainFrame()) {
      overlayWindow.webContents.once("did-finish-load", show);
    } else {
      show();
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
   * Claim the foreground so the game stops reading the controller.
   *
   * XInput already does the right thing here: Microsoft deprecated
   * XInputEnable on Windows 10+ because "game controller input is
   * automatically enabled/disabled by the system based on the application
   * window focus". Once the overlay genuinely owns the foreground, an XInput
   * 1.4 game reads neutral state without anything being hooked or suspended.
   *
   * The catch is that Electron's focus() loses to Windows' foreground lock
   * over a fullscreen game, leaving the overlay merely on top while the game
   * keeps focus — and keeps reacting to the stick. The native helper attaches
   * to the foreground thread's input queue first, which is the documented way
   * to make SetForegroundWindow succeed.
   *
   * Games that ship the older XInput 1.3 redistributable do not get the
   * system's focus gating and will still see input; blocking those would mean
   * hooking the API inside the game process, which is what Steam does.
   */
  private static claimForeground(overlayWindow: BrowserWindow, attempt = 0) {
    if (process.platform !== "win32" || overlayWindow.isDestroyed()) return;
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
        return;
      }

      const claimed = NativeAddon.forceForegroundWindow(hwnd);
      const foregroundPid = NativeAddon.getForegroundProcessId();
      const won = claimed && foregroundPid !== this.targetPid;

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

      // A fullscreen game frequently wins the race on the first try, so retry
      // a bounded number of times before giving up.
      if (!won && attempt < OVERLAY_FOREGROUND_ATTEMPTS) {
        setTimeout(() => {
          if (!overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
            this.claimForeground(overlayWindow, attempt + 1);
          }
        }, OVERLAY_FOREGROUND_RETRY_MS);
      }
    } catch (error) {
      logger.warn("Could not bring the overlay to the foreground", error);
    }
  }

  private static hideOverlayWindow(
    restoreGameFocus: boolean,
    showPinnedPerformance: boolean
  ) {
    const overlayWindow = this.overlayWindow;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
      overlayWindow.setAlwaysOnTop(false);
    }
    // Hand input back before anything else: leaving the gate set would leave
    // the game unplayable, so it must clear even on the early-return paths.
    this.setGameInputBlocked(false);
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

  /**
   * Gate the game's input while the overlay is on screen.
   *
   * Foreground alone does not do this — measured: the overlay wins the
   * foreground on the first attempt and games keep responding, because XInput
   * 1.3 never gates on focus, `GetAsyncKeyState` is global, and a window
   * registered with `RIDEV_INPUTSINK` is explicitly asking for background
   * input. The injected hook answers all three with neutral state while this
   * flag is set.
   */
  private static setGameInputBlocked(blocked: boolean) {
    if (process.platform !== "win32") return;
    if (this.inputBlocked === blocked) return;
    this.inputBlocked = blocked;
    if (!NativeAddon.setOverlayInputBlock(blocked)) {
      logger.warn("Overlay input gate unavailable", { blocked });
    }
  }

  /**
   * Load the input gate into the game. Best effort by design: a protected or
   * 32-bit process, or an antivirus block, must not stop the overlay opening —
   * it just means the game keeps reading input while the overlay is up.
   */
  private static injectInputHook(pid: number) {
    if (process.platform !== "win32" || !pid) return;
    if (this.inputHookPid === pid) return;
    // Creating the shared flag before injecting means the hook finds it on its
    // first look instead of retrying.
    const gate = NativeAddon.createOverlayInputGate();
    const result = NativeAddon.injectInputHook(pid);
    if (result.injected) {
      this.inputHookPid = pid;
      logger.info("Overlay input hook injection", { pid, gate, ...result });
      return;
    }

    // ERROR_ACCESS_DENIED on OpenProcess means the game runs at a higher
    // integrity level than the launcher — common for repacks that start
    // elevated. Nothing an unelevated process can do reaches it, so hand the
    // job to the broker, which holds an administrator token.
    const deniedByIntegrity = result.stage === "open" && result.errorCode === 5;
    if (!deniedByIntegrity) {
      this.inputHookPid = 0;
      logger.warn("Overlay input hook injection", { pid, gate, ...result });
      return;
    }

    void OverlayBroker.request(
      "inject",
      String(pid),
      OverlayBroker.inputHookPath()
    ).then((reply) => {
      // Reply shape: OK<TAB>injected<TAB>stage<TAB>errorCode
      const injected = reply?.ok === true && reply.fields[0] === "true";
      this.inputHookPid = injected ? pid : 0;
      logger[injected ? "info" : "warn"]("Overlay input hook injection", {
        pid,
        gate,
        via: "broker",
        injected,
        stage: reply?.fields[1] ?? "no-reply",
        errorCode: Number(reply?.fields[2] ?? 0),
        unelevatedStage: result.stage,
      });
    });
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

  private static ensureOverlayWindow(bounds = this.getWindowCreationBounds()) {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      return this.overlayWindow;
    }

    const overlayWindow = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      show: false,
      transparent: true,
      backgroundColor: "#00000000",
      frame: false,
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
      this.overlayWindow = null;
      this.overlayRendererReady = false;
      this.rendererContextGeneration = -1;
      for (const resolve of this.overlayRendererReadyWaiters) resolve(false);
      this.overlayRendererReadyWaiters.clear();
    });
    overlayWindow.on("blur", () => {
      setTimeout(() => this.synchronizeTargetWindows(), 50);
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
      const target = candidates[0] ?? null;
      const targetPid = target?.pid ?? 0;
      const targetExecutable = target?.exe ?? null;
      const targetChanged =
        targetPid !== this.targetPid ||
        targetExecutable !== this.targetExecutable;
      this.targetPid = targetPid;
      this.targetExecutable = targetExecutable;
      this.lastTargetRefreshAt = Date.now();
      if (targetChanged) {
        logger.info("GameHub overlay render target changed", {
          pid: targetPid,
          executable: targetExecutable,
        });
        if (this.preferences.overlayPerformanceEnabled) {
          overlayFpsMonitor.setTargetProcess(targetPid, targetExecutable);
        }
        this.injectInputHook(targetPid);
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

  private static getWindowCreationBounds(): Electron.Rectangle {
    return (
      this.getTargetBounds() ??
      screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds
    );
  }

  private static isTargetForeground(includeOverlayWindow: boolean) {
    if (process.platform !== "win32") return true;
    if (!this.targetPid) return false;
    if (
      includeOverlayWindow &&
      this.overlayWindow?.isVisible() &&
      this.overlayWindow.isFocused()
    ) {
      return true;
    }
    return NativeAddon.getForegroundProcessId() === this.targetPid;
  }

  private static placeWindowOverGame(
    window: BrowserWindow,
    bounds: Electron.Rectangle
  ) {
    if (window.isDestroyed()) return;
    if (
      process.platform === "win32" &&
      this.targetPid &&
      NativeAddon.placeOverlayWindow(
        window.getNativeWindowHandle(),
        this.targetPid
      )
    ) {
      return;
    }
    window.setBounds(bounds);
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
      this.overlayWindow.setAlwaysOnTop(true, "screen-saver", 1);
      this.placeWindowOverGame(this.overlayWindow, bounds);
      this.destroyToast();
      if (this.fpsWindow && !this.fpsWindow.isDestroyed()) {
        this.fpsWindow.hide();
        this.fpsWindow.setAlwaysOnTop(false);
      }
      return;
    }

    if (
      this.activationToastPending &&
      !this.activationToastShown &&
      !this.toastWindow &&
      (!this.overlayWindow || this.overlayRendererReady)
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
    targetBounds: Electron.Rectangle
  ): Electron.Rectangle {
    const horizontalInset = Math.min(
      TOAST_MARGIN,
      Math.floor(Math.max(0, targetBounds.width - TOAST_WIDTH) / 2)
    );
    const verticalInset = Math.min(
      TOAST_MARGIN,
      Math.floor(Math.max(0, targetBounds.height - TOAST_HEIGHT) / 2)
    );
    const width = Math.max(
      1,
      Math.min(TOAST_WIDTH, targetBounds.width - horizontalInset * 2)
    );
    const height = Math.max(
      1,
      Math.min(TOAST_HEIGHT, targetBounds.height - verticalInset * 2)
    );
    return {
      x: targetBounds.x + targetBounds.width - horizontalInset - width,
      y: targetBounds.y + verticalInset,
      width,
      height,
    };
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
    const toastBounds = this.getActivationToastBounds(targetBounds);

    const toastWindow = new BrowserWindow({
      ...toastBounds,
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
      toastWindow.setBounds(this.getActivationToastBounds(bounds));
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
    if (!this.servicesActive) return;
    this.servicesActive = false;
    this.hideOverlayWindow(false, false);
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
    // hideOverlayWindow above already cleared the gate; drop the injection
    // record too so a relaunch of the same game re-injects into the new
    // process rather than trusting a PID that has since been recycled.
    this.inputHookPid = 0;
    this.activationToastPending = false;
    this.activationToastShown = false;
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
      fpsWindow.setPosition(targetBounds.x + 24, targetBounds.y + 24);
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
      fpsWindow.setPosition(bounds.x + 24, bounds.y + 24);
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
    const fpsWindow = new BrowserWindow({
      x: targetBounds.x + 24,
      y: targetBounds.y + 24,
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

  private static registerShortcut(nativeKeyboardActive: boolean) {
    this.unregisterShortcut();

    this.registeredShortcut = PREFERRED_SHORTCUT;
    if (process.platform === "win32" && nativeKeyboardActive) {
      logger.info("Using native Windows Hydra overlay shortcut watcher");
      return;
    }

    if (
      globalShortcut.register(PREFERRED_SHORTCUT, () => this.toggleOverlay())
    ) {
      this.registeredWithElectron = true;
      return;
    }

    if (process.platform === "win32") {
      logger.warn(
        "Shift+F3 OS registration failed; native overlay polling remains active"
      );
      return;
    }

    if (
      globalShortcut.register(FALLBACK_SHORTCUT, () => this.toggleOverlay())
    ) {
      this.registeredShortcut = FALLBACK_SHORTCUT;
      this.registeredWithElectron = true;
      return;
    }

    logger.warn("Could not register a global Hydra overlay shortcut");
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
      logger.warn("Hydra Raw Input shortcut watcher could not be started");
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
        this.toggleOverlay();
      }
      if (isTogglePressed && !this.wasControllerTogglePressed) {
        this.toggleOverlay();
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
