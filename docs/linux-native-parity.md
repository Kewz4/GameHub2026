# Linux native, overlay, audio, and capture parity

This pass replaces Linux runtime stubs with working platform adapters. It does
**not** establish complete Linux parity or claim live Linux game/controller
verification from the Windows development machine.

## Implemented

| Area                       | Linux implementation                                                                                                                      | Boundary                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Game controller polling    | Optional SDL2 GameController runtime, standard face/Guide/shoulder/D-pad mappings, left-stick dead zone, multiple pads, hotplug reconnect | Requires `libSDL2-2.0.so.0` and normal device access. Does not grab controllers away from games.                                                    |
| Foreground and game bounds | Native X11/EWMH query through `x11rb`, mapped game-window selection, exact window ID and root coordinates                                 | Native Wayland windows are not globally enumerable. Missing target is not interpreted as the mouse's entire monitor.                                |
| Overlay placement/focus    | X11 window placement and `_NET_ACTIVE_WINDOW` requests; verifies actual foreground ownership                                              | Window manager may refuse activation. No compositor security bypass, injection, or exclusive-fullscreen guarantee.                                  |
| Game process controls      | Linux `/proc` identity, owned process-tree validation, `pidfd_open`/`pidfd_send_signal` stop/continue/terminate                           | Requires a pidfd-capable kernel (Linux 5.3+). Unsafe roots, another user's processes, changed identities, and trees containing GameHub are refused. |
| Pause lifecycle            | Paused PID is bound to its creation identity before resume/close/quit cleanup                                                             | Reused PIDs cannot silently redirect a deferred operation.                                                                                          |
| App volume mixer           | Asynchronous `pactl` JSON list + per-stream volume/mute, compatible with PulseAudio and PipeWire's Pulse server                           | Requires `pactl` and a reachable Pulse-compatible server. Does not invent sessions on ALSA-only systems.                                            |
| Mixer performance/safety   | Concurrent reads coalesced, 1-second cache, 2-second command timeout, no shell execution, fresh stream lookup before writes               | Failures clear stale stream mappings and writes report `false`.                                                                                     |
| Recording and replay       | Existing MediaRecorder pipeline enabled for X11, exact-window capture, foreground privacy checks                                          | Video only. Native Windows NVENC capture and system loopback audio are not Linux implementations.                                                   |
| Achievement souvenirs      | X11 foreground exact-window screenshot, wired to PC and RetroAchievements unlock capture                                                  | No desktop fallback. Native Wayland automatic capture is explicitly unavailable; stored souvenir browsing/sync is separate.                         |
| Capability reporting       | `GameRecorderState.desktopCaptureAvailable` and `systemAudioCaptureAvailable`                                                             | Frontend can distinguish unsupported sessions from a disabled preference.                                                                           |

## Validation

- Windows `cargo check --manifest-path native/hydra-native/Cargo.toml`: passed.
- Temporary cross-platform Rust harness compiled the actual X11 and SDL adapter
  source, with two parser/controller mapping tests passing. This is compilation
  and algorithm validation, **not** a Linux desktop interaction result.
- Targeted TypeScript native/mixer/capture/overlay tests: 20 passed initially;
  subsequent capability tests are included in `linux-native-parity.test.ts`.
- Main-process TypeScript check passed after the changes.
- The pre-existing Electron recorder integration test passed 6 of 7 cases; its
  real video encoding throughput case measured 1.18 FPS against the unchanged
  30-FPS threshold on this host and failed. No threshold was weakened.
- Linux CI initially exposed a pre-existing standalone Rust test linker problem:
  napi symbols require a Node host. A **dev-only** `napi/dyn-symbols` dependency
  now uses napi-rs's official dynamic resolver for Rust test executables. The
  production addon's Node-hosted linking behavior is unchanged.
- Full Linux cargo tests, native addon load, X11 interaction, physical controller
  behavior, real Pulse/PipeWire streams, and actual Linux gameplay capture must
  be validated on Linux; CI results are recorded by the integrating task.

## Still required for complete parity

1. A user-authorized Wayland ScreenCast portal session with restore-token and
   revoked-permission handling, plus compositor-specific overlay placement or
   a supported gamescope integration. XWayland availability alone does not grant
   control over native Wayland windows.
2. Linux system/game audio recording and hardware encoder selection (VA-API,
   NVIDIA, software fallback) with real encoder and saved-file verification.
3. Controller input isolation where a game continues reading background input.
   SDL observation is deliberately non-exclusive; no evdev grab, root requirement,
   game suspension, or controller remapping is silently imposed by opening UI.
4. Physical Guide/Shift+F3, multi-monitor/fractional-scale, and restart/reconnect
   tests across GNOME/KDE X11 and Wayland, Steam Deck/gamescope, native and Proton
   games. Electron GlobalShortcutsPortal setup alone is not proof of each desktop.
5. Custom external achievement notification parity on Linux. Existing in-app
   and OS notification fallbacks remain available; X11 screenshot support does
   not itself establish transparent external notification reliability.

## Primary references

- [SDL2 controller state](https://wiki.libsdl.org/SDL2/SDL_GameControllerGetButton)
- [SDL2 background controller events](https://wiki.libsdl.org/SDL2/SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS)
- [X11 Extended Window Manager Hints](https://specifications.freedesktop.org/wm-spec/latest/)
- [PulseAudio pactl commands](https://www.freedesktop.org/wiki/Software/PulseAudio/Documentation/User/CLI/)
- [napi-rs Cargo feature/linking model](https://napi.rs/docs/concepts/cargo-features)
