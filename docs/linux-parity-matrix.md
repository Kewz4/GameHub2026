# Linux parity tracking

Requested scope: all GameHub frontend/backend functionality. Baseline 1.1.49,
commit `9eda03031`. **Complete Linux parity is not certified by this document.**

The shipped application currently targets Linux x64. Architecture-specific
helper selection also understands ARM64, but an ARM64 application/package
acceptance matrix is separate and has not been completed.

## Acceptance matrix

| Feature family                        | Linux implementation/work                                                                                                                                    | Evidence or remaining acceptance                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop and Big Picture shells        | Shared renderer, settings, library, profile, achievements, souvenirs, music, notifications and emulation routes                                              | Native Ubuntu/Xvfb renderer suite, synthetic data; see frontend inventory. Physical controller acceptance still needed.                                                                            |
| Catalogue and requirements            | BP Proton/Deck filters match Desktop; native Linux requirements selected, Windows fallback identified                                                        | Pure filters/requirements tests and Linux renderer API-payload checks.                                                                                                                             |
| Library discovery / file selection    | Native ELF/scripts, Steam/Flatpak roots, ROM roots, extensionless files, symlink metadata                                                                    | Real POSIX filesystem tests in Linux CI.                                                                                                                                                           |
| PC launching and process tracking     | Wine prefix retained through fallback; native path case preserved; exact process identity and directory checks                                               | Cross-platform tests plus real owned-process/window smoke. Native/Proton commercial game acceptance still needed.                                                                                  |
| Emulators                             | XDG/native/Flatpak data/config roots; eight retro systems use native RetroArch; user-scoped setup provisions matching cores                                  | Per-emulator unit matrix. Actual Flatpak/core installation and gameplay remain acceptance items.                                                                                                   |
| Emulator updates                      | Staging, protected save/config merge, binary backup and rollback                                                                                             | Preservation and injected-failure tests; no real user saves modified.                                                                                                                              |
| Cloud Saves V2                        | External Linux roots participate in stable rules; game-bound PSP folders, DSi per-title exports, raw SRAM aliases                                            | Regression suite and synthetic clean-restore/round-trip tests. Real Linux authenticated upload/download/hash/no-op-sync acceptance still needed.                                                   |
| Save/game folder actions              | Desktop/BP custom and emulator mappings; Linux applications-menu shortcuts with PNG icons and persistent AppImage paths                                      | Actual temporary `.desktop` creation and local resolution; OS file-manager launch is spied in UI QA.                                                                                               |
| Downloads and store helpers           | Shared HTTP/torrent/debrid suites; explicit OS/architecture pinned Legendary/GOG assets, checksums, executable modes and actual resource bundling            | Linux shared suites and real helper CLI checks. Account download flows require signed-in acceptance.                                                                                               |
| Overlay and achievement notifications | Exact X11 targets, compositing evidence, placement/focus, external achievement windows                                                                       | Real X11 helper-window smoke and renderer/notification tests. Native Wayland placement is not implemented.                                                                                         |
| Performance statistics                | Existing per-launch MangoHud CSV route retained; no PresentMon claim on Linux                                                                                | Parser/shared tests. Actual game FPS/MangoHud and multi-GPU acceptance pending.                                                                                                                    |
| Recording/replay/audio                | Probed FFmpeg X11 route, explicit Pulse output monitor, software fallback, discovered media tools, hardware probes                                           | Actual isolated MP4/audio/mixer smoke; real GPU/game acceptance pending. No microphone substitution.                                                                                               |
| Controllers                           | SDL2 native observation, standard mappings, Guide/D-pad/stick navigation; reactive diagrams shared                                                           | Mapping tests and renderer simulation. Physical hotplug/Steam Input/gamescope acceptance pending. Universal background-input isolation is a shared product limit.                                  |
| Spotify and account storage           | Shared PKCE, external-browser login, keyring checks, request cache and same music widget                                                                     | Shared unit/UI tests. Real Spotify account playback remains deferred by the user, not marked passed.                                                                                               |
| Shortcuts / autostart / protocols     | XDG applications/autostart, quoted argv, stable AppImage launch path, desktop identity and Electron 40 portal feature flag                                   | Filesystem/planning tests. GNOME/KDE consent, reboot/login and updater acceptance remain desktop checks.                                                                                           |
| Installers / releases                 | Polkit argv for distro packages; atomic user AppImage updates, foreign-file preservation, startup errors; runtime dependencies and required Linux UKMM build | Unit tests, Linux builds and package inspection. Real package install/upgrade requires a Linux desktop.                                                                                            |
| CI                                    | Fail-closed shared Windows/Linux suite, standalone Rust Linux linking, real X11/Pulse/native/UI checks                                                       | Initial Ubuntu baseline: native tests passed after link fix; 9/12 old shared suites passed, failures used to drive path/mapping fixes. Current run results must be recorded before release claims. |

## Boundaries, not hidden passes

- Native Wayland automatic capture requires a user-authorized portal lifecycle;
  overlay placement is a distinct compositor/gamescope integration problem.
- The Windows Steam offline-play helper is still a Windows PE/.NET tool. Native
  Linux ELF support and a safe, verified Wine tool/prefix/process-tree adapter
  are not implemented. It must not be silently enabled against real games.
- Shared NAND/memory-card data must never be restored as one game's save.
  Different emulator/core formats cannot be declared interchangeable by filename.
- No claim that all Windows games or anti-cheat systems work on Linux is made.
- The inherited AUR publisher belongs to Hydra's package; it is gated off in
  GameHub. Publishing a separate GameHub AUR package requires its own ownership
  and configuration, not a write to Hydra's package.
- Docker Desktop failed to start on the Windows development host. Native Linux
  test evidence is collected in isolated Ubuntu CI, not by relabelling Windows.

## Detailed evidence

- [Frontend inventory](linux-frontend-parity.md)
- [Native, audio and capture](linux-native-parity.md)
- [Platform boundaries](linux-platform-boundaries.md)
- [Emulation and save mapping](linux-emulation-save-parity.md)
- [RetroArch provisioning](linux-retroarch-provisioning.md)

No user's real save/profile was uploaded to CI. Native UI fixtures use synthetic
account/game/save data; the native/audio harness creates and controls only its
own processes, windows, and temporary Pulse sink.
