# Production overlay window-mode policy

GameHub's production overlay is an external transparent Electron window. It
supports games running in **Borderless** or **Windowed** mode. **Exclusive
fullscreen is unsupported**: the launcher keeps the game untouched, leaves
anti-cheat and graphics memory alone, and displays a right-edge notification
asking the user to change the game's display mode.

On Windows, activation requires Electron to enumerate the exact target HWND as
a compositor-backed window source. A display-sized game missing that evidence
is reported as exclusive fullscreen; any other missing exact source is reported
as unavailable. After showing, GameHub also verifies that the overlay actually
owns foreground focus. It closes and explains the requirement if the game keeps
exclusive display control.

The activation/refusal notification shares the game's right coordinate, has
square right corners, enters from `translateX(100%)`, and uses a 64 DIP ready or
80 DIP refusal host at normal widths. The host height equals its content surface
so there is no unused area under the notification.

Achievement souvenir frames follow Hydra PR #2735's SDR approach: exact-window
video capture, CSS `dynamic-range-limit: standard`, blank-frame retries, and a
tagged sRGB JPEG. Windows capture never falls back to the whole desktop.

Historical input-hook, supervised-launch, and renderer-hook fixtures remain in
the repository for audit history only. Normal builds do not build their DLL or
broker, CI does not execute their native suites, electron-builder does not
unpack an injection dependency, and the main-process overlay/native adapter has
no injection or input-gate call path.
