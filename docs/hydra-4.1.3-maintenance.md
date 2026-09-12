# GameHub maintenance — Hydra 4.1.3

Work requested September 12, 2026. Release target: GameHub 1.1.48.

## Scope

- [x] Adapt applicable Hydra 4.1.3 changes, retaining GameHub Cloud V2 and emulator integrations.
- [x] PR 2756: Big Picture deep links and `--big-picture`; cold and second-instance window ownership verified.
- [x] Overlay controller widget cycling, directional focus, menu dismissal and permission diagnostics.
- [x] Reactive diagrams for Wii U GamePad/Pro/Classic, 3DS, DS and PSP, wired into both interfaces; correct existing diagrams selected for legacy emulator binaries.
- [x] Spotify PKCE/browser authorization and request sharing; sidebar handle and GameHub music widget wiring.
- [x] Branded web installer, verified downloads, retry and accurate installer handoff.
- [x] Cloud V2 regression suite and actual Hades II upload/download/hash verification.
- [x] Big Picture settings spacing and controller acceptance; emulation catalogue and nested console filters.
- [x] Populated profile screenshots and separately identified event fixtures.
- [ ] Live Spotify account playback — explicitly deferred by the user.
- [ ] Physical Shift+F3 verification and changing Hades II's forced administrator setting — pending user choice; no persistent Windows compatibility setting changed.

## Environment and baseline

- Branch: `codex/cloud-saves-v2`, initial commit `91b465e27` (GameHub 1.1.47).
- Initial unrelated untracked files: `.codex/`, `.github/hooks/`; preserved.
- Latest upstream stable verified from GitHub: **4.1.3**, September 4, 2026.
- Local review refs: `refs/remotes/hydra/v4.1.1`, `refs/remotes/hydra/v4.1.3`, `refs/remotes/hydra/pr-2756`.
- Requested `npx skills add Leonxlnx/taste-skill`: all 13 skills installed globally for Codex. App refinement uses `redesign-existing-projects` with Impeccable's audit/craft floor and existing GameHub tokens.
- Attached `Downloads/hydra-installer.exe` was absent. The public `hydralauncher/hydra-installer` source provides the reference: prominent identity, clear download action, progress, then installer handoff.
- Live populated data located at `Downloads/Archives/GameHub-1.1.0-win/data`; database modified September 12.
- Baseline `yarn test:cloud-save-v2`: **379 passed, 4 skipped, 0 failed** (383 cases). Skipped cases still require inspection and live verification.
- Baseline `yarn test:spotify`: **7 passed**. This verifies parsers/rate-limit helpers, not account playback.

## Findings being addressed

- Settings rail reserved its own height twice: normal flex layout plus content padding.
- Cemu, Azahar, PPSSPP and legacy helper binaries fell back to the generic Switch Pro diagram; Desktop and Big Picture each selected diagrams separately.
- Catalogue filters still fetched retired static JSON resources. Upstream 4.1.3 uses `/catalogue/steam/{genres,tags,developers,publishers}`.
- Spotify used an embedded authentication window that blocked non-Spotify redirects (including social sign-in). Loopback PKCE is already implemented.
- The music handle arranged its icon and vertical label side by side inside 38px. The GameHub player was hidden while its queue was empty.

## Live-test findings and recovery

The first real Hades II sync exposed a serious pre-existing defect: when the
cloud head was absent but an old local anchor remained, the legacy deletion
branch erased seven unchanged local save files. No remote snapshot was created.
Before the test all 30 files had been copied to
`artifacts/maintenance-202609/1789233125923-sync-hades/hades-before-sync-0`.
All seven removed files were restored immediately; SHA-256 comparison verified
all 30 original files unchanged. The backup is retained.

The fix removes the inferred whole-game deletion flow and uses an anchor only
for a present snapshot with the same ID and a compatible version. Missing cloud
state is first-sync state. Explicit remote tombstones keep their separate,
confirmed conflict flow. Regression tests exercise Hades and emulator files with
an orphaned anchor. Cloud suite after that change: 381 passed, 4 Unix-only tests
skipped on Windows, zero failures.

The real re-test passed: seven Hades II files uploaded to the account's R2 Cloud
V2 snapshot, all seven downloaded into a separate readback directory with exact
SHA-256 matches, and a second sync returned `action: none`, `finalState: synced`.
The integrity check found no changed or missing original save files.
Evidence: `artifacts/maintenance-202609/1789233931875-sync-hades/report.json`.

Spotify live playback is deferred at the user's request. The populated account
has a client ID but no authorization; PKCE, API compatibility, UI and error
handling are in scope without claiming a live playback pass.

## Upstream parity decisions

| Upstream change                                     | GameHub disposition                                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR 2756 Big Picture deep link                       | Adapted with shared argv parsing, coalesced main-window creation and repeat-open handling.                                                            |
| Catalogue metadata endpoints                        | Desktop and Big Picture use `/catalogue/steam/*`, with validated payloads, locale fallback and a shared short-lived cache.                            |
| Achievement metadata export                         | Adapted for manually managed Steam games. Bounded scan, cancellable download, preserves existing files and skips platform-synced installations.       |
| Japanese/Slovenian locales                          | Enabled existing translations.                                                                                                                        |
| Linux download shortcuts                            | Honor the saved preference and expose the control in both settings interfaces.                                                                        |
| Review discoverability and banners                  | Author backgrounds, copyable text, pending/denied review gating, and stale request protection.                                                        |
| Native `time` dependency update                     | Updated to 0.3.47 and rebuilt the Windows addon.                                                                                                      |
| PPSSPP/Dolphin, emulator saves                      | Existing GameHub integrations and Cloud V2 adapters retained; settings acceptance covers these systems.                                               |
| Souvenir grouping/collection limits and cloud gifts | Hydra subscription/collection endpoints are not used by GameHub's account-scoped R2 souvenir storage. No subscription purchase/gifting UI introduced. |

## Acceptance evidence

- Full populated UI suite: 198/202 passed initially; the four library cases were
  waiting only for fallback text despite loaded logo artwork. After correcting
  the assertion, the targeted re-run passed 4/4. All 202 cases therefore passed
  across those runs, including four viewport sizes and 15 emulator systems.
  Reports: `artifacts/qa-big-picture-settings/20260912183549708/report.json` and
  `artifacts/qa-big-picture-settings/20260912185120152/report.json`.
- Overlay renderer: simulated controller actions delivered through actual
  overlay IPC visited all eight widgets; directional focus and two popup
  dismissals passed. Foreground state is explicitly simulated in background QA,
  so this is not a physical controller/keyboard hardware claim.
  `artifacts/maintenance-202609/1789239344534-overlay-ui/report.json`.
- Actual music search returned ten results. `Coral Crown` decoded and played;
  pause/resume and playback after closing the widget passed. This machine used
  the labelled 30-second Deezer fallback after the YouTube stream failed to
  decode. Full-length YouTube playback is not claimed as verified.
  `artifacts/maintenance-202609/1789239080748-music/report.json`.
- Installer: real GitHub release discovery and bundled artwork/font loading;
  keyboard choice navigation, progress/error/retry event fixtures; five download
  integrity tests. `artifacts/maintenance-202609/installer-1789232675417/report.json`.
- Cold/warm Big Picture links: one BP window, one hidden desktop/audio host,
  repeated links do not create duplicates. Settings rail measured at 72px below
  the 56px header, with no duplicate header/rail spacing.
  `artifacts/maintenance-202609/1789234071389-cold-big-picture/report.json`.
- Regression suites: Cloud V2 381 passed/4 Unix-only skips; features 208 passed;
  overlay, upstream parity, downloads, Steam emulator and Spotify helpers passed;
  maintenance suite adds 18 passing cases. Main bundle syntax checks passed.

## Focused design and performance audit

Taste's existing-project review and Impeccable's craft checks guided the actual
GameHub logo, monochrome installer, clear primary action, consistent music
handles, focus indicators, compact settings spacing and explicit failure states.
The Impeccable detector returned no regex findings in the selected surfaces but
reported missing HTML parser dependencies; that degraded scan is not a complete
computed-contrast audit. Rendered and controller acceptance checks provide the
visual/interaction evidence instead.

Big Picture routes are loaded on demand. The main renderer entry fell from
12.74 MB to about 4.81 MB uncompressed; shared chunks still load as needed, so
this is an entry-file measurement, not an equivalent startup-time claim.
Hidden Big Picture polling stops; metadata and Spotify reads are coalesced.

Hades II's compatibility registry entry is `RUNASADMIN`. Normal-permission
GameHub input cannot reliably control that elevated window. The app now reports
the mismatch and directs users to Guide/normal-permission launch. A normal-
permission test launch was confirmed, but desktop testing was interrupted before
the physical keypress could be verified. The experimental low-level keyboard
hook was removed; no graphics/input DLL injection was reintroduced.

## References

- https://github.com/hydralauncher/hydra/releases/tag/v4.1.3
- https://github.com/hydralauncher/hydra/pull/2756
- https://github.com/hydralauncher/hydra-installer
- https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
- https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- https://www.nintendo.com/eu/media/downloads/support_1/wii_u_3/WiiU_OperationsManual_EN.pdf
- https://csassets.nintendo.com/noaext/image/private/t_KA_PDF/New3DSXL_OperationsManual_ENG_final
- https://manuals.playstation.net/document/en/psp/current/manualindex.html
