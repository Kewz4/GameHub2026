# GameHub overlay controller UX and brand contract

This document records the controller and keyboard contract implemented by the
in-game overlay. The overlay uses GameHub's runtime theme tokens, but deliberately
maps its general highlight/accent treatment to the app's black/white identity.
Spotify green is reserved for the explicitly branded Spotify surface; it is not
used by GameHub controls.

## Official guidance adopted

- [Xbox Accessibility Guideline 107: Input](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/107): every overlay action has a digital, single-press path. Pointer drag/resize has a D-pad alternative, and no destructive confirmation requires a hold or chord.
- [Xbox Accessibility Guideline 112: UI navigation](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/112): navigation follows a predictable visual order; A selects or engages; B disengages, goes back, or closes; and LB/RB changes tabs only while focus is inside the tabbed Music widget.
- [Xbox Accessibility Guideline 113: UI focus handling](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/113): focus is always visible, clipped/covered controls are excluded, popovers and dialogs trap focus, safe first focus is assigned, and closing a layer restores its trigger.
- [Xbox Accessibility Guideline 102: Contrast](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/102): focus uses a high-contrast light outline against the dark GameHub surface; primary light controls use dark icons/text.
- [Xbox Accessibility Guideline 115: Error messages and destructive actions](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/115): Close Game is a two-step alert dialog. Cancel receives first focus and B cancels.
- [Windows gamepad and remote interactions](https://learn.microsoft.com/en-au/windows/uwp/ui-input/gamepad-and-remote-interactions): A engages, B disengages, D-pad/left stick navigate, and sliders/long regions require an explicit engagement step.
- [Windows focus navigation](https://learn.microsoft.com/en-us/windows/apps/develop/input/focus-navigation): focus order is spatial and remains inside the current scope.
- [Windows visual feedback guidelines](https://learn.microsoft.com/en-us/windows/apps/develop/input/guidelines-for-visualfeedback): the focused element and owning widget receive a high-visibility border.
- [GameInput focus policy](https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/input/gameinput/enums/gameinputfocuspolicy?view=gdk-2604): controller actions are rejected unless the full overlay renderer is visible and focused. This is independent from the native input-blocking gate.

## Input contract

| Input              | Behavior                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guide              | Native XInput opens or closes the prepared overlay with one press. Chromium's Gamepad API does not expose Guide, so this remains native.                                                                                       |
| D-pad / left stick | Spatial navigation. At the vertical edge of a long engaged list, Up/Down advances in DOM order and scrolls the next item into view; Left/Right never jumps rows. In widget edit mode it moves or resizes in fixed pixel steps. |
| A                  | Activates a button, engages a slider/list, opens a select, starts widget move/resize, or opens the controller keyboard for text entry. A again exits range/widget edit.                                                        |
| B                  | Dismisses the topmost select, keyboard, dialog, popover, or expanded control; then exits an engaged list; then closes the overlay. Focus returns to the invoking control.                                                      |
| LB / RB            | Previous/next tab only when focus is in the GameHub or Spotify Music surface. It never changes music tabs while another widget owns focus.                                                                                     |
| Tab / Shift+Tab    | Cycles within the active modal/popover/list scope.                                                                                                                                                                             |
| Enter / Space      | Activates buttons natively and explicitly engages range/list regions. Arrow keys remain native inside hardware-keyboard text fields.                                                                                           |

Chromium `navigator.getGamepads()` and the native XInput watcher feed one action
path. A bounded 80 ms, same-action cross-source arbitration window prevents the
same physical edge from being processed twice. Different actions and same-source
repeat pass immediately; same-action failover passes once the duplicate window
ends. Both paths are ignored after blur, when hidden, or when the full overlay
DOM is detached. If native input protection cannot be confirmed, the full
overlay stays closed and a noninteractive branded error toast explains why.

## Widget behavior matrix

| Surface            | Controller behavior                                                                                                                                                                                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global chrome      | Close Overlay, lock/unlock layout, reset, Widgets, Pause/Resume, and Close Game are ordinary focusable controls. Widgets is a trapped scope. Close Game and Reset Layout are Cancel-first alert dialogs.                                                                                                                                      |
| Every widget frame | Move and Resize are real buttons. A enters the mode, D-pad/stick edits, A confirms, and B exits. Size-cycle, Hide, and frame focus remain available without a pointer. Locking the layout exits edit mode.                                                                                                                                    |
| Performance        | Pin HUD is a controller-reachable checkbox; metrics are readable content and do not create redundant focus stops.                                                                                                                                                                                                                             |
| Achievements       | All/Unlocked/Locked/Hidden/Missable filters are buttons. The results are one scroll-region stop; A browses, directions scroll/traverse, and B returns to the region.                                                                                                                                                                          |
| Capture            | Record, stop, save replay, and open folder are buttons. Replay length is an in-overlay listbox. A opens it, directions move options, A commits, and B restores the trigger. Buffer state exposes progressbar value/text semantics.                                                                                                            |
| GameHub Music      | Tabs support LB/RB and keyboard arrow/Home/End. Seek and volume require A engagement before left/right changes. Queue, search results, and playlists use engaged regions. Add-to-playlist and volume popovers dismiss before their parent region. Search and playlist naming open the controller keyboard. Playlist deletion is Cancel-first. |
| Spotify Music      | The same tab/range/popover rules apply. Browse shelves, grouped search results, and the full queue are engaged regions, including offscreen traversal. Spotify search opens the controller keyboard.                                                                                                                                          |
| Friends            | Friend activity is one readable scroll-region stop, leaving the widget header controls easy to reach.                                                                                                                                                                                                                                         |
| Volume mixer       | Each session exposes Mute and Adjust. Adjust reveals a collapsed slider; A engages it, left/right changes volume, and B exits then collapses.                                                                                                                                                                                                 |
| Quick launch       | Each app exposes separate Launch and Unpin buttons. Native executable icons are rendered when available; unpin is no longer right-click-only. Add app is controller reachable.                                                                                                                                                                |
| Notes              | A opens the controller keyboard. It includes letters, symbols, shift, space, cursor movement, delete, clear, line break, and Done; B closes and restores the textarea.                                                                                                                                                                        |

## Brand and visual rules

- General overlay surfaces use GameHub's canonical background, border, text,
  radius, and typography variables.
- The overlay maps primary/accent highlights to `--overlay-highlight`, derived
  from GameHub's bright text token. There is no teal/blue fallback.
- Light primary buttons always use a dark foreground. Icon-only actions have an
  accessible name and use SVG icon components; no emoji acts as UI chrome.
- Muted/faint overlay text uses the current theme's foreground RGB channel at
  accessible alpha. Automated contrast math enforces at least 4.5:1 for active
  metadata/tools and 3:1 for disabled tools in dark, light, and custom fixtures.
- Header identity and global actions are separate floating pills. No full-width
  top or bottom rectangle reserves workspace, so unlocked widgets can use the
  complete game client area.
- The controller hint pill is informational and never intercepts pointer or
  controller input. Reduced-motion preferences remove its transition.

## Automated acceptance contract

`npm run test:overlay` covers standard gamepad mapping, deliberate directional
repeat, shoulder non-repeat, spatial scoring, digital widget constraints,
foreground activation/input blocking, controller DOM contracts, destructive
confirmation, theme contrast math, and recorder presentation.

`scripts/shoot-overlay.mjs` is the Electron/Playwright acceptance harness. It
injects a standard `navigator.getGamepads()` device and validates browser and
native action paths, blur rejection, scoped bumpers, range/list engagement,
offscreen Spotify queue traversal, controller text entry, widget move/resize,
Unpin reachability, confirmation focus restoration, computed dark/light/custom
contrast, the input-protection error toast, and the no-flash open path. It writes
explicit controller screenshots at 1920×1080 and 1280×720. The harness is
intentionally not run until the integrated application source is stable.

## Known platform boundary

The browser Gamepad API standard mapping covers A/B, bumpers, D-pad, and left
stick. Guide remains native XInput because browsers intentionally do not expose
that system button. Text composition currently provides a Latin/symbol overlay
keyboard; IME and speech entry still require the operating system's text input.
