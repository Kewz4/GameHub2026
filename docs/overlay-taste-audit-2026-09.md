# Overlay Taste audit and refinement

September 12, 2026. Follow-up to GameHub 1.1.48, release target 1.1.49.

## Direction and scope

Controller-first, in-game utility using GameHub's existing Noto Sans type,
theme tokens, monochrome controls and movable widgets. Taste's
`redesign-existing-projects` checklist and Impeccable's audit/polish/craft
guidance were applied to the full overlay, including its Spotify surface.
Taste's marketing-page presets were not used for this product interface.

This is a focused overlay audit, not an app-wide redesign or a certification
of accessibility compliance.

## Findings and implementation

| Priority | Finding                                                                                                              | Change                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Repeated edit controls truncated narrow widget titles and added navigation stops.                                    | One labelled options button per widget; Move, Resize, Cycle size and Hide remain controller-accessible. Mouse users can drag the title and resize at the corner. |
| P1       | A delayed focus return could steal focus from a newly opened options menu.                                           | Dismissal returns focus synchronously. Widget edit mode remembers its originating control.                                                                       |
| P1       | Spotify's generic button rule overrode Play's foreground, producing a pale glyph on a pale button.                   | Lower-specificity default and a computed-contrast regression check for Play.                                                                                     |
| P1       | Spotify player height crowded controls and tabs at compact sizes.                                                    | Compact transport/progress layout, removed repeated device labels and now-playing eyebrow, readable secondary text.                                              |
| P2       | Boxed icons, nested quick-launch tiles, pill filters, gradients and border-plus-shadow layers competed with content. | Plain glyphs, flat lists/tabs, transparent internal surfaces and one restrained widget elevation.                                                                |
| P2       | Spotify controls and internal surfaces ignored the launcher theme.                                                   | Theme-derived controls, errors, text and surfaces. The official Spotify logo retains its attribution color.                                                      |
| P2       | The empty music panel had no direct next action.                                                                     | Search music opens the actual search tab and focuses its input.                                                                                                  |
| P2       | Eight widget blur effects and a width-animated replay indicator added rendering work.                                | Removed widget blur and changed replay progress to a transform with a reduced-motion alternative. No FPS improvement is claimed without benchmarking.            |

Preserved: all eight widgets, saved custom layout geometry, achievements,
game process actions, list engagement, text entry, right-edge notification,
and borderless/windowed-only overlay policy. No DLL injection was added.

## Verification

- Overlay regression suite: **101 passed**, zero failures.
- Full Electron renderer fixture suite passed: drag/resize, controller and
  analog actions, nested lists, dropdowns, text entry, modal dismissal,
  widget visibility, repeated opens, compact layouts and toast sizes.
- Computed contrast: **18 samples across dark, light and custom themes**.
  Play exceeded 15:1 in all three. The lowest sampled enabled control was
  5.17:1; disabled-control samples exceeded the suite's 3:1 target.
- Populated profile clone: **145 games**, actual Hades II metadata and
  achievement artwork. All eight menus opened, retained controller scope
  and restored focus at **1920x1080, 1280x720 and 900x640**. No clipped widget
  titles; one header options button each; no widget border or backdrop blur.
  Empty music search also passed.
- TypeScript, scoped ESLint, formatting and 46 main-bundle syntax checks passed.
- Impeccable's source detector identified a width transition; it was fixed.
  The source scan is not a substitute for the rendered checks above.

Focused audit health: **15/20, Good** (accessibility, performance, theming,
responsive behavior and implementation integrity: 3/4 each). These are manual
scope-limited assessments, not a claim that every combination of content and
assistive technology was tested.

Evidence:

- `artifacts/overlay/taste-release-verification.log`
- `artifacts/overlay/taste-regression-final.log`
- `artifacts/maintenance-202609/1789244616794-overlay-ui/report.json`
- `artifacts/maintenance-202609/1789244616794-overlay-ui/overlay-taste-1920x1080.png`
- `artifacts/overlay/gamehub-overlay-controller-1280x720.png`

The populated test uses the real renderer and IPC with simulated controller
actions. Background windows are transparent/non-focusable so testing does not
take over the desktop. Spotify content/playback in the separate renderer suite
is a fixture; real account playback remains deferred by the user. No new
physical shortcut, controller-hardware or in-game FPS claim is made here.
