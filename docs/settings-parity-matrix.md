# Desktop Settings ownership and parity

This matrix describes the current desktop Settings surface after the August
2026 audit. Defaults are the value used when the LevelDB preference is absent.
All preference writes use `updateUserPreferences`; the main-process mutation
queue serializes its read/merge/write cycle and broadcasts the resulting full
object to every window.

## Preference ownership

| Desktop category / group                            | Preference keys and defaults                                                                                                                                                                                                                                             | Runtime owner / immediate effect                                                                          | Big Picture parity                                                                                                                                | Audit result                                                                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General / App basics                                | `downloadsPath` = system Downloads; `language` = matched locale / `en`                                                                                                                                                                                                   | download-directory normalization; i18next and profile-language patch                                      | General has the fuller multi-directory picker and language modal                                                                                  | Working. The path is machine-local and excluded from account backup. Disk cards explicitly show loading/query-failed states instead of presenting unresolved capacity as `0 B`.                             |
| General / Startup behavior                          | `preferQuitInsteadOfHiding=false`; `hideToTrayOnGameStart=false`; `runAtStartup=false`; `startMinimized=false`; `launchToLibraryPage=false`; Linux `enableAutoInstall=false`                                                                                             | window lifecycle; packaged OS auto-launch registration; updater                                           | General / Behavior contains the same fields plus `launchInBigPicture`                                                                             | Working. Desktop's duplicate `launchInBigPicture` control was removed; Big Picture category is canonical on desktop.                                                                                        |
| General / Appearance                                | `themeMode=dark`; custom theme selected separately from LevelDB theme records                                                                                                                                                                                            | renderer `<html data-theme-mode>` and custom CSS service                                                  | No Big Picture theme editor                                                                                                                       | Working. Shell selection/focus uses neutral black/white branding; semantic success/danger colors remain.                                                                                                    |
| General / Library, Cloud Sync, Danger Zone, Updates | Action-only: metadata repair, dedupe, maintenance, cloud debugger, delete local/cloud library, updater check                                                                                                                                                             | dedicated preload events and services                                                                     | No Big Picture parity                                                                                                                             | Reachable, but General is overloaded. A future Library & Maintenance category would improve information architecture without changing ownership.                                                            |
| Downloads / Behavior                                | `maxDownloadSpeedBytesPerSecond=null`; `torrentNetworkInterface=null`; `seedAfterDownloadComplete=false`; `extractFilesByDefault=true`; `showDownloadSpeedInMegabytes=false`; `deleteArchiveFilesAfterExtractionByDefault=false`; Windows `createStartMenuShortcut=true` | DownloadManager applies speed/interface immediately; downloader/install defaults consume remaining fields | Behavior parity except desktop-only speed limit and network interface                                                                             | Working. Invalid numeric input now restores the persisted value instead of silently clearing the limit. Network interface is machine-local and excluded from backup.                                        |
| Downloads / Sources                                 | persisted source records, not `UserPreferences`                                                                                                                                                                                                                          | download-source IPC and matching services                                                                 | Full source-management parity                                                                                                                     | Working. A `?urls=` deep link selects Downloads.                                                                                                                                                            |
| Notifications / Library                             | downloads=false; repacks=false; friend requests=false; friend starts game=true                                                                                                                                                                                           | renderer/main notification producers                                                                      | Full parity                                                                                                                                       | Working.                                                                                                                                                                                                    |
| Notifications / Achievements                        | enabled=true; custom=true; position=`top-left`; volume=15%                                                                                                                                                                                                               | achievement window update and sound service                                                               | Big Picture lacks the volume slider                                                                                                               | Working. Slider commits on idle, pointer release, relevant keyboard release, blur, and unmount so the final value is not lost.                                                                              |
| Content & gameplay / Content                        | trailers=true; NSFW alert disabled=false; hide mature=false; reveal hidden descriptions=false                                                                                                                                                                            | catalogue/game-details filters                                                                            | Big Picture lacks `hideMatureGames`                                                                                                               | Working.                                                                                                                                                                                                    |
| Content & gameplay / Metadata                       | Steam achievements=false; new-download badges=true                                                                                                                                                                                                                       | achievement lookup and download-source badges                                                             | Big Picture lacks the badge toggle                                                                                                                | Working. The former help glyph was removed because its delegated click path did not open anything.                                                                                                          |
| Content & gameplay / Overlay                        | overlay=true; performance HUD=true; FPS/average/frame time/1% low rows=true                                                                                                                                                                                              | `OverlayManager.applyUserPreferences` immediately                                                         | No Big Picture settings counterpart                                                                                                               | Working. Desktop now exposes all four previously hidden performance-row preferences with dependency-aware disabled states.                                                                                  |
| Content & gameplay / Capture                        | recorder=false; 1080p; 60 FPS; quality preset; replay=false / 30s; system audio=true; output path=Videos/GameHub                                                                                                                                                         | `GameRecorderManager` via `OverlayManager`; recorder status/preference preload events                     | Full recorder preference, output-folder, live-status, and controller-focus parity in Big Picture Content settings                                 | Working. Output path is machine-local and excluded from backup; all other capture choices are portable. Desktop distinguishes machine NVENC capability, active selection, and segment-verified diagnostics. |
| Integrations / Music                                | GameHub Music by default; Spotify is opt-in and keeps auth outside settings backup                                                                                                                                                                                       | Spotify IPC/session service                                                                               | No Big Picture parity                                                                                                                             | Working.                                                                                                                                                                                                    |
| Integrations / Libraries                            | Steam, Epic, GOG, Battle.net, Xbox, Riot, Ubisoft, EA; exclusion list                                                                                                                                                                                                    | provider-specific preload events; credentials remain machine/session scoped                               | Big Picture covers platform imports but not Battle.net/Riot/exclusion management                                                                  | Working. Accordions expose trigger/panel relationships and stable selectors.                                                                                                                                |
| Integrations / Backups & imports                    | Ludusavi backup import; Playnite playtime import                                                                                                                                                                                                                         | import-specific IPC; not preferences                                                                      | No Big Picture parity                                                                                                                             | Working. These are actions, not Cloud Saves V2 preference owners. Imported saves ultimately enter the current save/cloud services.                                                                          |
| Integrations / Premium clients                      | Real-Debrid, Premiumize, AllDebrid, TorBox tokens                                                                                                                                                                                                                        | provider authentication and downloader selection                                                          | Full provider parity, subject to feature flags                                                                                                    | Working. Tokens are deliberately excluded from account settings backup.                                                                                                                                     |
| Achievements                                        | Exophase enable/profile/platform ownership/extra profiles                                                                                                                                                                                                                | Exophase session and achievement sync services                                                            | Big Picture has platform achievement import in Integrations, not full Exophase management                                                         | Working. Enable state, managed platforms and public extra profiles are portable; the authenticated-session username/cookies are deliberately not restored as a false login.                                 |
| Compatibility                                       | Linux Proton path, GameMode, MangoHud; Windows common redistributables                                                                                                                                                                                                   | compatibility discovery/install and launch options                                                        | Full platform-appropriate parity                                                                                                                  | Working. Proton paths are machine-local; portable booleans are backed up.                                                                                                                                   |
| Big Picture                                         | startup=false; sounds=true; virtual keyboard=true; diagnostics=false; position=`bottom-center`                                                                                                                                                                           | Big Picture launch, audio, input, diagnostics stores                                                      | Full parity                                                                                                                                       | Working. `?tab=big_picture` now resolves correctly.                                                                                                                                                         |
| Emulation                                           | manager/configs/ROM folders/controller mappings/memory cards/cloud saves; RetroAchievements credentials; Minerva catalogue action                                                                                                                                        | emulation IPC and Cloud Saves V2 services                                                                 | Big Picture provides controller-native emulator detail and cloud-save flows; desktop adds setup/Minerva tooling                                   | Working. Executables, ROM paths, credentials, mappings, and local save paths are machine-local and not settings-backup fields.                                                                              |
| Account & Privacy (signed in only)                  | profile visibility; account actions; R2 settings backup/restore; blocked users                                                                                                                                                                                           | Hydra API, authenticated R2 preferences object                                                            | Big Picture has visibility, subscription-free R2 cloud status and blocked users; desktop alone exposes email/password and settings backup/restore | Working. Unblock controls now have user-specific accessible names. Offline/read-only account data falls back to the cached display name, so the username row never renders blank.                           |

## Big Picture controller and layout guarantees

- LB/RB hints live outside the horizontally scrolling Settings category
  viewport. Selecting a late category reveals only the tab labels, never
  scrolls either bumper hint away, and keeps page-level horizontal scroll at
  zero.
- The sticky category rail reserves its measured height plus any sticky
  displacement and a safety gap. Nested emulator Manage views reset the shared
  Settings scroll surface before transferring focus to their Back action.
- Modal layers own a root focus region. Their Back and Close controls are
  controller-focusable, visibly ringed, and initial content focus still wins
  when a flow supplies an explicit target. Closing the layer restores its
  opener.
- Dropdown and modal layers block background bumper/category input until the
  active layer closes, then return focus to the trigger.

## Sync policy

The R2 settings backup contains portable, non-secret settings only. It includes
theme mode, Big Picture choices, mature-content behavior, every overlay HUD row,
recorder configuration except the output folder, the speed limit, notification
settings, and portable launcher/download behavior. It excludes credentials,
provider tokens, network-adapter names, executable/folder paths, pinned-app
paths, ROM paths, save paths, and profile-image paths.

Restore broadcasts the merged preference object and immediately reapplies
language, overlay/recorder state, the download speed limit, and packaged OS
auto-launch state. Source lists, custom theme records, provider sessions, and
other non-preference databases retain their own sync/ownership rules.
Automatic and manual R2 preference uploads are serialized so an older,
slower upload cannot finish after a newer settings snapshot and overwrite it.

## Known follow-up debt

- `settings-general.tsx` and `settings-behavior.tsx` are legacy, unreferenced
  implementations. They should be deleted in a dedicated cleanup after release
  rather than mixed into behavior changes.
- Desktop General's action-heavy Library / Cloud Sync / Danger Zone region is
  reachable but too large. Moving it to a dedicated category is an information
  architecture change, not a persistence fix.
- Big Picture intentionally has a smaller surface for controller usability. Its
  missing desktop-only fields are listed above and should only be added with
  focus-graph coverage.
- Several older integration/import dialogs still contain hard-coded English and
  inline layout declarations. Their controls work, but full locale extraction
  is separate from preference ownership.

## Stable visual-test selectors

Use an isolated user-data directory for any selector that changes a value.
Read-only screenshots may use a populated installation.

```text
.settings__container
.settings__sidebar[role="tablist"]
[data-settings-category="general"]
[data-settings-category="downloads"]
[data-settings-category="notifications"]
[data-settings-category="content_gameplay"]
[data-settings-category="integrations"]
[data-settings-category="achievements"]
[data-settings-category="compatibility"]
[data-settings-category="big_picture"]
[data-settings-category="emulation"]
[data-settings-category="account_privacy"]
#settings-category-panel[role="tabpanel"]
#settings-category-panel[data-settings-panel="content_gameplay"]
[data-settings-tab-rail]
[data-tabs-settings-rail]
[data-tabs-scroll-viewport]
#settings-language
#settings-theme-mode
#settings-max-download-speed
#achievement-volume[data-setting-key="achievementSoundVolume"]
#settings-overlay-enabled
#settings-overlay-performance-enabled
#settings-overlay-show-fps
#settings-overlay-show-average-fps
#settings-overlay-show-frame-time
#settings-overlay-show-one-percent-low
#settings-game-recorder-enabled
#settings-game-recorder-resolution
#settings-game-recorder-fps
#settings-game-recorder-quality
#settings-game-recorder-replay-duration
[data-settings-integration="spotify"] > button[aria-expanded]
[data-settings-integration="steam"] > button[aria-controls]
#settings-integration-panel-steam[role="region"]
#settings-big-picture-virtual-keyboard
#settings-profile-visibility
[data-settings-account] .settings-account__unblock-button[aria-label]
```

At viewport widths above 860 px the sidebar is vertical. At 860 px and below it
is a single horizontally scrollable row; at 520 px and below container/panel
padding is reduced. Keyboard assertions should cover wrapped Arrow keys plus
Home/End on the category tablist, native Space toggling checkboxes, native arrow
selection for `<select>`, and range changes followed by blur/category switch.
