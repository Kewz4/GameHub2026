# Remaining platform boundaries after the Linux native pass

## Controller isolation: shared limitation, not missing Linux UI

The current Windows and Linux overlays both observe controller input and claim
foreground focus for their own window. Neither production path injects a game
DLL, filters another process's controller reads, grabs an input device, or
silently pauses a game. The historical gate code remains QA-only; production
does not import `overlay-input-isolation.ts`.

Windows focus handling is useful, but not a universal input lock. Microsoft's
XInput documentation describes focus-based behavior on modern Windows; it does
not establish isolation for every other controller API a game might use.
[XInputEnable](https://learn.microsoft.com/en-us/windows/win32/api/xinput/nf-xinput-xinputenable)

Windows also explicitly permits registered Raw Input consumers to receive
background input. That alone disproves a platform-wide assumption that winning
foreground silences every input path in a game.
[RAWINPUTDEVICE](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-rawinputdevice)

SDL exposes an application-specific option for receiving controller input in the
background. GameHub enables it in its own Linux observer to detect Guide while
a game is foreground. This does not change another application's SDL policy.
[SDL background controller hint](https://wiki.libsdl.org/SDL2/SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS)

Therefore, classify universal controller isolation as a shared compatibility
constraint. Test whether each game honors focus or has background input enabled;
do not label the Windows baseline universally isolated or Linux universally
broken. Normal overlay navigation and Guide detection are separate features.
The explicit user-selected Pause action is also separate; opening the overlay
never calls it. The runtime-policy test guards against implicit pause/grab paths.

## Linux recording acceleration: implemented selection, pending GPU acceptance

Linux recording preserves the X11 exact-window FFmpeg route and an optional
explicit Pulse output monitor. A bounded selector now tries NVENC, accessible
VA-API render nodes, and software x264, in that order. Each candidate must run a
three-frame synthetic encode with its actual pixel conversion/upload path.
Render nodes are validated character devices accessed with normal permissions;
there is no chmod, group change, root request, or global device configuration.

NVIDIA supports FFmpeg acceleration on Linux with compatible hardware, an
appropriate FFmpeg build, and matching drivers. Availability must be proven by
running an encode, not merely finding an encoder name in a list.
[NVIDIA FFmpeg guidance](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/ffmpeg-with-nvidia-gpu/index.html)

Probe failures/timeouts move to the next backend; runtime hardware failure
tries a separately probed software encoder before video-only compatibility
capture. Encoder changes retain the existing contiguous-compatible-segment
guard rather than concatenating incompatible bitstreams. Unit tests cover
planning, failed driver/permission probes, software fallback, and exact-window
and audio-selection invariants. No graphics injection is involved.

Real NVIDIA and Intel/AMD Linux GPUs are still required to validate completed
game files, timestamps, throughput, GPU reset, and encoder-loss recovery. A
successful initialization probe is not full game/performance acceptance.

## Wayland: capture permission and overlay placement are different problems

Wayland screen capture has a supported portal route: create a session, select
sources, ask the user to start sharing, then consume the permitted PipeWire
stream. Sessions can close or lose authorization. Persistent restore tokens are
single-use and must be replaced; unavailable or revoked sources may require
another prompt. This needs a visible user-authorized flow and session ownership,
not a background achievement-triggered prompt.
[ScreenCast portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html)

GameHub pins Electron 40.9.3. Its checked-in installed type documentation marks
`setDisplayMediaRequestHandler({ useSystemPicker: true })` as macOS-specific;
flipping that option is not a Linux portal implementation. The existing recorder
also binds native PIDs/window IDs and pauses on foreground changes. A portal
integration must explicitly bind the user's selected game stream to that
session, handle denial/revocation/end-of-stream, and stop recording when that
binding can no longer be established.

Receiving a screen stream does not grant global coordinates, arbitrary focus
control, or permission to stack an Electron window above another native Wayland
application. Consequently recording can be implemented separately from an
interactive overlay; a gamescope/compositor-specific overlay integration needs
its own supported contract and tests.

The InputCapture portal is not a controller-isolation shortcut: its documented
capabilities are keyboard, pointer, and touchscreen, and activation is controlled
by the compositor rather than immediate application demand.
[InputCapture portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.InputCapture.html)

No Wayland permission bypass, global grab, root requirement, or game DLL was added.
Real GNOME/KDE Wayland sessions are required to validate a portal implementation;
the current Xvfb/Openbox CI smoke cannot establish that coverage.
