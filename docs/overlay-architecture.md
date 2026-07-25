# GameHub Overlay — Architecture Reference

## Overview

GameHub's in-game overlay provides a HUD and control panel rendered as a transparent `BrowserWindow` positioned over a running game. It supports three modes: **full** (glass panel with music player, friends, volume mixer, performance stats, notes), **pinned** (corner FPS chip), and **toast** (activation notification). All three are React components served from the same renderer bundle, differentiated by URL hash.

---

## Window Management

### Three Overlay Windows

All created in `src/main/services/overlay-manager.ts`:

| Window | Mode | Size | Transparent | Focusable | Loaded Route |
|--------|------|------|-------------|-----------|--------------|
| `overlayWindow` | full | matches game window bounds | yes | yes | `#/overlay` |
| `fpsWindow` | pinned | 218×116 | yes | no | `#/overlay-fps` |
| `toastWindow` | toast | 620×190 | yes | no | `#/overlay-toast` |

**All windows** use:
```ts
backgroundColor: "#00000000"
frame: false
skipTaskbar: true
webPreferences: { preload, sandbox: false }
```

Full overlay additionally disables `backgroundThrottling: false` (keeps performance polling alive). Pinned/toast windows call `setIgnoreMouseEvents(true)` so clicks pass through to the game.

### Positioning

- **Windows**: `overlay-manager.ts:placeWindowOverGame()` uses `NativeAddon.getProcessWindowBounds()` to retrieve the game window's coordinates, then positions the overlay BrowserWindow to match exactly.
- **Linux**: Falls back to the primary display's work area.
- **FPS window**: Always placed at top-left of the primary display.
- **Toast window**: Top-right of the display showing the game, auto-destroys after 8 seconds.

### Lifecycle

Called from `process-watcher.ts` (game detection loop, 2s interval):

```
Game detected → OverlayManager.setActiveGame(game)
               ├─ startControllerPolling() — 32ms Raw Input poll
               ├─ registerShortcut() — Shift+F3 / native keyboard hook
               ├─ overlayFpsMonitor.start() — PresentMon (Windows) / MangoHud (Linux)
               ├─ startTargetProcessPolling() — 250ms, tracks game window
               └─ showActivationToast() — 8s auto-dismiss

User presses Shift+F3 → toggleOverlay()
                         ├─ ensureOverlayWindow() — create if destroyed
                         ├─ placeWindowOverGame() — position on game
                         ├─ showInactive() on fps window if pinned
                         └─ overlayWindow.show() + focus()

User closes overlay → hideOverlay()
                      ├─ overlayWindow.hide()
                      ├─ show fps window if performance is pinned
                      └─ focus game process via NativeAddon.setForegroundWindow()

Game stops → clearActiveGame()
             ├─ hide overlay, destroy toast
             ├─ unregister shortcut / stop polling
             └─ overlayFpsMonitor.stop()
```

Key files:
- `src/main/services/overlay-manager.ts` — all window creation, positioning, gamepad, shortcut management (696 lines)
- `src/main/services/overlay-game-process.ts` — finds the game process window by executable/tracking paths (36 lines)
- `src/main/services/overlay-fps-monitor.ts` — PresentMon/MangoHud CSV parser, rolling 120-sample window (242 lines)

---

## Renderer Architecture

### Route Setup

Defined in `src/renderer/src/main.tsx`:

```tsx
<Route path="/overlay" element={<Overlay />} />
<Route path="/overlay-fps" element={<Overlay />} />
<Route path="/overlay-toast" element={<Overlay />} />
```

All three routes mount the same `Overlay` component. The component detects its mode from `location.pathname`:

```ts
const initialMode = location.pathname.includes("overlay-fps")
  ? "pinned"
  : location.pathname.includes("overlay-toast")
    ? "toast"
    : "full";
```

The renderer HTML is loaded via `WindowManager.loadWindowURL()` which either uses `ELECTRON_RENDERER_URL` (dev HMR) or loads the built `index.html` with the hash fragment.

### Component Structure (`src/renderer/src/pages/overlay/overlay.tsx`, ~1328 lines)

#### State Management

Plain React `useState` hooks (no Redux for overlay):

| State | Type | Purpose |
|-------|------|---------|
| `mode` | `OverlayMode` | hidden / toast / pinned / full |
| `context` | `HydraOverlayContext \| null` | Game info, user, achievements, settings |
| `performance` | `HydraOverlayPerformance \| null` | Live FPS / frame time metrics |
| `note` | `string` | Notes textarea content |
| `friends` | `UserFriend[]` | Online friends list |
| `pinnedApps` | `PinnedApp[]` | Quick-launch pinned apps |
| `audioSessions` | `AudioSession[]` | Per-app volume mixer entries |
| `musicState` | `MusicPlayerState \| null` | Queued tracks, playback state, audio URL |
| `searchQuery` / `searchResults` / `searching` | — | Deezer search UX |
| `playlists` / `creatingPlaylist` / `newPlaylistName` | — | Playlist CRUD |
| `localProgressMs` | `number` | Current audio position from `<audio>` timeupdate |
| `audioRef` | `RefObject` | Reference to hidden `<audio>` element |

#### Layout Structure (full mode)

```
.overlay (fixed fullscreen, z-index 999)
  .overlay-panel (glassmorphism container, min(1280px, 96vw) × min(90vh, 960px))
    .overlay-header — game cover + title + session timer + close button
    .overlay-grid (3-column flex: 240px / flex / 240px)
      .overlay-col--left
        .overlay-card--perf — big FPS + rows (avg, 1% low, frame time) + "Pin HUD" toggle
        .overlay-card--ach — achievement progress + scrollable list (up to 6)
      .overlay-col--center (flex: 1)
        .overlay-card--music — 3-tab music player (Now Playing / Search / Playlists)
      .overlay-col--right
        .overlay-card--friends — up to 6 friends with avatar + online status
        .overlay-card--mixer — per-app volume sliders + mute buttons
        .overlay-card--pins — grid of quick-launch app tiles
        .overlay-card--notes — auto-saving textarea
    .overlay-foot — keyboard shortcut hints
    audio (hidden, controls playback)
```

#### Data Polling Schedule (full mode only)

| Data | Interval | IPC Channel |
|------|----------|-------------|
| Music player state | 2s | `musicGetState` |
| General context & friends | Initial + event-driven | `getOverlayContext`, `getPinnedApps` |
| Audio sessions | 3s | `getAudioSessions` |
| Friends presence | 30s | HydraAPI REST |
| Performance metrics | Pushed via IPC | `on-overlay-performance` |
| Notes | Auto-saved on blur + 600ms debounce | `saveOverlayNote` |

#### Pinned Mode (FPS Chip)

Renders a compact overlay in the top-left corner showing:
- Large FPS number (monospace, teal glow)
- Average FPS, 1% low, frame time rows
- `pointer-events: none` so it doesn't block game input

#### Toast Mode

Top-right activation notification:
- Green dot + "Overlay ready" message
- Right-click to dismiss
- Auto-destroy after 8s (managed by main process)
- `pointer-events: none`

---

## IPC Communication

### Pattern: invoke/handle (request/response)

Renderer calls `window.electron.methodName(args)` → preload calls `ipcRenderer.invoke("channel", args)` → main process handler registered via `registerEvent()`.

All overlay events: `src/main/events/overlay/index.ts` (103 lines)
All music events: `src/main/events/music-player/index.ts` (106 lines)

### Pattern: webContents.send (push from main)

Main process sends events to the overlay renderers via `webContents.send("channel", data)`. The renderer subscribes with `ipcRenderer.on()` and receives an unsubscribe function.

### IPC Channel Inventory

| Channel | Direction | Payload |
|---------|-----------|---------|
| `getOverlayContext` | → main | Returns `HydraOverlayContext \| null` |
| `closeHydraOverlay` | → main | Hides overlay window |
| `setOverlayPerformancePinned` | → main | Boolean |
| `getOverlayNote` / `saveOverlayNote` | → main | String (max 20k chars) |
| `getPinnedApps` / `pickPinnedApp` / `removePinnedApp` / `launchPinnedApp` | → main | Pinned app CRUD |
| `getAudioSessions` / `setAudioSessionVolume` / `setAudioSessionMute` | → main | Per-app mixer |
| `on-overlay-performance` | main → renderer | `HydraOverlayPerformance` (every 500ms) |
| `on-overlay-mode` | main → renderer | `"full" \| "pinned" \| "toast" \| "hidden"` |
| `on-overlay-shown` | main → renderer | Empty |
| `on-overlay-performance-pin` | main → renderer | `boolean` |
| `on-overlay-gamepad-action` | main → renderer | `"up" \| "down" \| "left" \| "right" \| "accept" \| "back" \| "previous-tab" \| "next-tab"` |
| `musicSearch` / `musicGetState` / `musicP*/musicSet*` etc. | → main | Music player operations |

### Preload Bindings

Defined in `src/preload/index.ts`:
- Overlay section: lines ~1675–1724
- Music section: lines ~1725–1800

All are exposed via `contextBridge.exposeInMainWorld("electron", { ... })`.

### Type Declarations

The renderer's `src/renderer/src/declaration.d.ts` defines the `Electron` interface that types `window.electron`. It includes all overlay and music player methods with full return types.

---

## Music Player System

### Architecture

Three layers:

1. **Main process service** — `src/main/services/overlay-music-player.ts` (341 lines)
   - Singleton `OverlayMusicPlayer` class
   - Track search via Deezer API (`api.deezer.com/search/track`)
   - Audio URL resolution via `youtube-dl-exec` (yt-dlp) — searches YouTube for matching video, extracts `bestaudio[m4a]` URL
   - Queue management (array of `MusicTrack`, current index, shuffle, repeat)
   - Playlist CRUD persisted in LevelDB under `levelKeys.musicPlaylists`

2. **IPC bridge** — `src/main/events/music-player/index.ts`
   - 21 IPC handlers delegating to the singleton
   - Registered via `registerEvent()` helper

3. **Renderer** — inline in `overlay.tsx`
   - Polls `musicGetState` every 2 seconds
   - Hidden `<audio>` element (`audioRef`) that plays the resolved audio URL
   - `timeupdate` → updates `localProgressMs` for progress bar
   - `ended` → triggers `musicNext()` via IPC
   - Three sub-tabs: Now Playing, Search, Playlists

### Data Flow

```
User searches → musicSearch(query) → Deezer API → MusicTrack[]
User clicks +Queue → musicAddToQueue(track) → queue pushed
User clicks Play → musicPlay(index) → resolveAudio(track)
  → youtube-dl-exec ytsearch1:"title artist" → videoId
  → youtube-dl-exec "https://youtube.com/watch?v=videoId"
  → { url: "https://..." } → stored as this.audioUrl
→ musicGetState returns { audioUrl, state: "playing", ... }
→ Renderer effect: audioRef.current.src = audioUrl → play()
→ timeupdate events → localProgressMs state → progress bar

User clicks Pause → musicPause() → audio.pause()
User clicks Next → musicNext() → resolve next track's audio → new audioUrl
Track ends → ended event → musicNext() via IPC
```

### Types (`src/types/music-player.types.ts`)

```ts
MusicTrack { id, title, artist, album, coverArt, duration, previewUrl? }
MusicPlaylist { id, name, tracks: MusicTrack[], createdAt, updatedAt }
RepeatMode = "none" | "one" | "all"
MusicPlayerState {
  queue, currentIndex, nowPlaying,
  state: "playing" | "paused" | "stopped",
  shuffle, repeat, progressMs, durationMs, audioUrl
}
```

---

## Performance Monitoring

### Windows: PresentMon

`src/main/services/overlay-fps-monitor.ts` spawns `resources/PresentMon/PresentMon.exe` as a child process with arguments to capture frame time data for the target game process. It parses CSV output line-by-line, accumulates a rolling window of 120 samples, and calculates:
- **FPS**: 1000 / `ApplicationFrameTime` (smoothed)
- **Average FPS**: mean of the rolling window
- **1% Low**: 1st percentile of frame times in the window
- **Frame Time**: most recent `ApplicationFrameTime` in ms

Published via IPC at 500ms intervals.

### Linux: MangoHud

Reads MangoHud's CSV metrics files from the game's overlay data directory. Same rolling window calculation.

---

## Gamepad Navigation

`overlay-manager.ts:startControllerPolling()` uses `NativeAddon.pollGamepadState()` at 32ms intervals (Raw Input API on Windows). When the overlay is open, D-pad presses are translated to navigation actions and sent to the renderer via `on-overlay-gamepad-action`.

The controller chord (View + Menu buttons) toggles the overlay, matching the `Shift+F3` keyboard shortcut.

---

## Styling

`src/renderer/src/pages/overlay/overlay.scss` (1064 lines)

Design system:
- CSS custom properties: `--ink`, `--muted`, `--faint`, `--glass`, `--glass-2`, `--brd`, `--accent`, `--teal`, `--good`
- Glassmorphism: `.overlay-panel` uses `backdrop-filter: blur(24px)` with semi-transparent background
- 3-column flex layout (responsive: stacks on narrow screens)
- BEM class naming
- Card variants: `.overlay-card--perf`, `--ach`, `--music`, `--friends`, `--mixer`, `--pins`, `--notes`
- Scrollable cards use `flex: 1; min-height: 0; overflow-y: auto`

The body gets class `overlay-window` which sets `background: transparent !important` to make the transparent BrowserWindow background work.

---

## Overlay Types

All in `src/types/overlay.types.ts` (81 lines):

```ts
HydraOverlayPreferences         — user settings for overlay features
HydraOverlayPerformanceRows     — which rows to show in FPS display
HydraOverlayGame                — currently-running game metadata
HydraOverlayContext             — full context sent to renderer
HydraOverlaySettings            — performance display config
HydraOverlayPerformance         — live metrics (fps, avg, 1% low, frame time)
HydraOverlayGamepadAction       — directional/navigation actions
PinnedApp                       — { name, path }
AudioSession                    — { pid, name, volume, muted }
```

---

## Build Pipeline

Config: `electron.vite.config.ts` (91 lines)

Four build targets:

| Target | Entry | Plugins |
|--------|-------|---------|
| main | `src/main/main.ts` | swc, externalize (except AWS SDK) |
| preload | `src/preload/index.ts` | externalize |
| bigPicture | `src/big-picture/index.html` | react, CSS scoping |
| renderer | `src/renderer/index.html` | svgr, react, SCSS modern |

Path aliases: `@main`, `@renderer`, `@locales`, `@resources`, `@shared`, `@types`

In development, `ELECTRON_RENDERER_URL` is set for HMR. In production, all windows load the built `index.html` with hash fragments.

---

## Key File Index

| File | Role |
|------|------|
| `src/main/services/overlay-manager.ts` | Window creation, positioning, gamepad, shortcuts, lifecycle |
| `src/main/services/overlay-game-process.ts` | Game window detection and ranking |
| `src/main/services/overlay-fps-monitor.ts` | PresentMon/MangoHud frame time → FPS calculation |
| `src/main/services/overlay-music-player.ts` | Deezer search, yt-dlp audio resolution, queue, playlists |
| `src/main/services/gamepad-state.ts` | Raw Input gamepad state polling |
| `src/main/services/overlay-shortcut.ts` | Native keyboard hook for Shift+F3 |
| `src/main/events/overlay/index.ts` | IPC handlers: context, notes, pins, audio sessions |
| `src/main/events/music-player/index.ts` | IPC handlers: all music player operations |
| `src/preload/index.ts` | contextBridge API exposure (overlay + music sections) |
| `src/renderer/src/pages/overlay/overlay.tsx` | Full React component (all 3 modes) |
| `src/renderer/src/pages/overlay/overlay.scss` | Complete styling (glassmorphism, 3-column, music player) |
| `src/renderer/src/declaration.d.ts` | Electron interface type declarations |
| `src/types/overlay.types.ts` | Overlay-specific interfaces |
| `src/types/music-player.types.ts` | Music-related interfaces |
| `src/types/index.ts` | Re-exports all types |
| `src/shared/overlay-preferences.ts` | Default overlay preference resolution |
| `src/main/services/process-watcher.ts` | Game detection loop (2s), triggers overlay lifecycle |
| `src/main/services/main-loop.ts` | Orchestrates all periodic services |
| `electron.vite.config.ts` | Build pipeline configuration |
| `src/renderer/src/main.tsx` | React router (including overlay routes) |
