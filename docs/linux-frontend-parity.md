# Linux frontend parity inventory

This inventory covers the Desktop renderer and Big Picture frontend. "Wired"
means the UI reaches the same IPC/backend path; it does not imply a physical
Linux game, GPU, controller, account, or distribution has been tested. Native
backend and packaging validation must be read alongside this document.

## Corrections made in this pass

- Desktop library scanning and library refresh are no longer hidden on Linux.
  Both launch the same dry-run/approval flow as Windows. Linux scan roots and
  native executable discovery are implemented in the backend pass.
- Desktop and Big Picture game settings resolve and expose the save-folder
  action for Linux, emulated games, and custom games with manual mappings.
  Results from a previously closed or switched game cannot replace the current
  selection. Unresolved paths remain disabled rather than opening an arbitrary
  directory.
- Linux game shortcuts expose Desktop and Applications menu destinations.
  `start_menu` remains the internal IPC value for backward compatibility; the
  visible Linux label is "Add to applications menu".
- Desktop tracking-executable selection accepts native binaries and launch
  scripts on Linux instead of requiring a Windows `.exe`, `.bat`, or `.cmd`.
- Big Picture's executable picker retains all-files support, allowing
  extensionless ELF programs. The generic file explorer honors combined
  all-files filters, case-insensitive file suffixes, and POSIX root/trailing
  slash navigation. ROM-only filters remain narrow.
- Big Picture now exposes controller-focusable Proton and Steam Deck rating
  filters, preserves them in URLs, validates them, sends them in catalogue
  searches, and excludes console results from PC-compatibility-filtered rows.
  Switching to Console clears those incompatible filters; Clear all resets
  them. No catalogue result is relabeled compatible without upstream data.
- Desktop and Big Picture display native Linux system requirements when
  provided. If absent, the Windows fallback is labeled as such (Proton), not
  presented as native Linux requirements. The Desktop hardware comparison uses
  the same selected requirement source.
- Linux's native RetroArch implementation is named consistently in Desktop,
  Big Picture, onboarding, emulator detection, and setup. The persisted binary
  identity remains `ralibretro`. Linux setup links to official RetroArch
  installation guidance and explains that cores/BIOS are separately required.
  Account copy distinguishes the Web API key from an emulator login token.
  Big Picture now offers the same password-to-login-token exchange as Desktop;
  native RetroArch receives that login token on its next GameHub launch. The
  password is not stored and manual sign-in remains available in RetroArch.
  Linux setup now offers explicit user-Flatpak installation plus native cores;
  details, prerequisites, trust model, and acceptance limits are documented in
  [Linux RetroArch provisioning](linux-retroarch-provisioning.md).
- Souvenir capture and recording audio controls consume explicit backend
  capability fields. X11 screenshots can be enabled when the running backend
  confirms support; native Wayland is not silently treated as supported. Linux
  recording offers system audio only when the backend confirms an output
  monitor and FFmpeg audio support; otherwise it is explicitly video-only.
- Unavailable capture status shows the service's explanation, without falsely
  promising a working fallback encoder. Big Picture no longer hides the
  souvenir option entirely. Existing local/cloud souvenirs remain browsable.
- A disabled Big Picture checkbox can no longer be toggled by clicking its
  enclosing row.

## Feature-by-feature inventory

| Surface / feature                           | Desktop and Big Picture Linux disposition                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell, title bar, sidebar, navigation       | Existing Linux title-bar controls, sidebar, BP entry/exit and route composition retained; no Windows-only BP route gate.                                                                   |
| Home, recommendations, classics             | Existing shared recommendation identity fixes and classic rows retained. Source metadata/artwork behavior is not OS-gated.                                                                 |
| Library, categories, console pills          | Existing nested console filters and controller bumper navigation retained; Desktop scan/refresh gate removed.                                                                              |
| Catalogue                                   | Steam and emulation searches already wired; BP Proton/Deck filters added in this pass.                                                                                                     |
| Game details                                | Existing metadata, artwork, reviews, HLTB, and console details retained; native Linux requirements fixed.                                                                                  |
| Launching                                   | UI supports native executables, Proton options, Steam shortcuts, emulator ROM launch, and per-game wrappers. Execution correctness belongs to backend acceptance.                          |
| Proton / Wine / GameMode / MangoHud         | Existing Linux compatibility panels in Desktop and BP remain available; Windows redistributable panels stay Windows-specific.                                                              |
| Game folders / save folders / relocation    | Same IPC actions; Linux save-folder visibility fixed. Path selection no longer requires Windows executable suffixes.                                                                       |
| Downloads and sources                       | Existing download sources, extraction preferences, queue, limits and shortcut preferences work through shared IPC. Linux Applications menu labels now match the backend.                   |
| Steam / Epic / GOG                          | Account and library UI have no Linux-only exclusion. Native helper discovery and package execution are backend concerns, not claimed by renderer checks.                                   |
| Cloud saves V2                              | Sidebar cloud screen, game-details provider, custom mapping/file tree, conflicts, automatic sync and BP cloud tab share the V2 IPC layer. Unix path identities remain case-sensitive.      |
| Emulation catalogue / ROM library           | Existing BP/desktop wiring retained for all configured systems. Picker preserves ROM filters; executable picker admits native Linux files.                                                 |
| Emulator installation and setup             | Names resolve to the Linux implementation. Backend-provided install methods determine install/link actions. Native RetroArch cores and BIOS are requirements, not bundled-game claims.     |
| Controller mapping / reactive SVGs          | Desktop and BP share layouts and mapped button state; Linux standard/non-standard gamepad layouts already exist. Native evdev/global input needs separate hardware acceptance.             |
| Achievements and account sync               | Lists, profile achievements tab, metadata settings and notifications are not Windows-only. Emulator/backend achievement discovery requires its own Linux tests.                            |
| Souvenirs                                   | Profile viewing, achievement icon/text presentation, local folder and cloud browsing remain accessible. Automatic capture is enabled only with backend screenshot capability.              |
| Overlay widgets                             | Existing Taste refinements and controller scopes retained; all widgets share IPC across OSes. Native foreground, mixer, process and controller capabilities are backend-tested separately. |
| Recording / replay                          | Settings remain visible; explicit backend support controls screenshots/audio. Missing output-monitor audio and native-Wayland capture limitations are not hidden.                          |
| GameHub Music                               | Sidebar and overlay use the existing shared playback host and status; Linux codec/device runtime acceptance is separate from source wiring.                                                |
| Spotify                                     | Existing system-browser PKCE, safe-storage status, Linux keyring-required messaging and shared controls retained. Real signed-in playback remains an account-dependent acceptance test.    |
| Friends / profile / reviews / notifications | Existing shared routes, APIs and persisted state; no newly introduced Linux exclusion.                                                                                                     |
| Themes / localization / accessibility       | Existing design tokens, focus rings and translations retained. Added copy uses fallback translation keys or the existing BP English-string translation layer.                              |
| Installer / updates / protocol handling     | Frontend actions use shared update/deep-link paths. Linux package formats, desktop integration and permissions are covered by the packaging/backend pass.                                  |

## Validation and limits

Targeted frontend tests cover compatibility filter validation/round trips,
requirements selection, extensionless executables/AppImages/ROM filtering,
POSIX navigation, capture capability rendering, Linux RetroArch names, and
recorder status. `yarn typecheck:web` also passes after these changes.

Impeccable's hardening guidance was used to preserve the app's existing visual
system, make unavailable capabilities explicit, keep disabled actions inert,
and retain controller focusability. This is a parity/hardening pass, not a new
visual identity. Linux runtime screenshots/controller testing must be reported
from the actual Linux job; Windows renderer simulations are not native proof.
The mechanical detector flagged an existing catalogue-card padding transition;
that layout-triggering animation was removed without changing the card layout.

Native Wayland capture, Linux recording/audio hardware acceptance, physical controller behavior,
GPU/desktop-compositor combinations, and live authenticated third-party media
playback remain separate acceptance dimensions. Do not label this inventory
"complete Linux parity" unless those dimensions have been implemented and
verified.

Official Linux emulator setup references:
[RetroArch platforms](https://www.retroarch.com/?page=platforms) and
[Libretro GNU/Linux installation](https://docs.libretro.com/guides/install-gnu/).
