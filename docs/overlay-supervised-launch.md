# Supervised Windows overlay launch

## Status

This is an experimental, fixture-first architecture for interactive overlay
input isolation on manually managed Windows games. Both production gates remain
disabled: `OVERLAY_LIVE_INPUT_ISOLATION_ENABLED = false` and
`OVERLAY_SUPERVISED_LAUNCH_PRODUCTION_ENABLED = false`. The supervised service
has no production helper adapter or launch-path integration. Only isolated
synthetic fixtures and contract tests are release-gated.

The existing attach-after-launch injector is not an authorization mechanism.
It can patch imports it finds, but it cannot revoke a function pointer that a
game cached before the first overlay shortcut. A matching PID and a positive
shared-memory record are therefore insufficient to show an interactive
overlay.

## Why the two target games need supervision

Static observations from local target executables and adjacent modules used to
design these fixtures indicated several possible input paths. Presence or a
binary string/import is not runtime coverage or compatibility proof:

- Marvel's Spider-Man 2 uses Windows.Gaming.Input Gamepad and
  RawGameController, Raw Input, dynamically resolved XInput 1.4/9.1.0,
  HID/SetupAPI, `SteamInput006`, `SteamController008` and libScePad/controller
  middleware paths. Its local AppCompat entry also requests `RUNASADMIN`.
- The First Berserker: Khazan starts through
  `steamclient_loader_x64.exe`, then creates `BBQ-Win64-Shipping.exe`. The
  renderer uses XInput 1.3, Raw Input/HID, DirectInput, `SteamInput006`,
  `SteamController008` and bundled libScePad paths.

Focus alone cannot isolate either title. DirectInput explicitly permits
`DISCL_BACKGROUND`, meaning a device may be acquired while the game is not the
active window. The input hook must be present before the game or its launcher
can cache polling entry points, and it must propagate only to an exact,
configured render child.

## Target production sequence — not currently wired

```text
GameHub (asInvoker)
  validate local catalog/custom game + exact executable
  create random one-shot session
          |
          v
one-shot supervisor (same integrity first)
  CreateProcessW(CREATE_SUSPENDED)
  canonical image + FILETIME + mitigation checks
  DetourUpdateProcessWithDll (before application entry)
  publish authenticated identity
          |
          v
instrumentation DLL
  minimal DllMain / DetourRestoreAfterWith
  initialize at detoured executable entry point
  install process-wide input + child-creation detours
  publish generation-scoped capability handshake
          |
          v
supervisor resumes once
  post-resume module/topology stabilization
  interactive overlay may be authorized
```

The session identity is the tuple:

```text
random session ID
+ PID
+ 64-bit creation FILETIME
+ canonical executable path
+ pinned executable volume serial + 128-bit file ID
+ live process and executable file handles held by the supervisor
+ bootstrap generation/capability handshake
```

PID-only state is never accepted because Windows may reuse process IDs after a
process object is released.

The QA fixture supervisor now opens the exact executable without write/delete
sharing, holds that handle across `CreateProcessW` and the commit decision,
and emits its fixed-width volume serial and 128-bit file ID in every identity
event. The TypeScript coordinator independently retains the verifier proof and
requires an exact match before authorizing the suspended process; commit and
abort echo the same identity. Generic game wiring remains blocked because the
native helper still accepts only the adjacent synthetic fixture and there is
no production trusted-root/file verifier or signed helper adapter yet. A
caller-echoed path alone is never sufficient.

## Pre-entry mechanism

Microsoft Detours v4.0.1 is the selected prototype dependency. It is pinned to
official tag commit `e4bfd6b03e50de46b47abfbd1e46b384f0c5f833` and its MIT
license must be retained. Detours can update a newly created suspended process
with an instrumentation DLL before normal application code. Its inline
detours modify the target function body, so calls through pointers cached by
any resolution mechanism still reach the replacement.

Do not use `CreateRemoteThread(LoadLibraryW)` while the primary thread remains
suspended. Windows serializes process startup, DLL initialization and remote
thread creation; the remote loader thread may not run until initialization
finishes, producing a deadlock/timeout.

The instrumentation DLL must:

- call `DetourIsHelperProcess` and `DetourRestoreAfterWith`;
- export `DetourFinishHelperProcess` as ordinal 1 when mixed-bitness support is
  introduced;
- do only loader-safe work in `DllMain`;
- detour the executable entry point and perform initialization there, before
  application code;
- fail closed if any required transaction, mitigation, capability or identity
  check fails.

## Child propagation for Khazan-like launchers

The bootstrap detours public `CreateProcessW/A` paths. For a configured render
child it adds `CREATE_SUSPENDED`, then verifies the returned process handle,
canonical image and creation time before applying the instrumentation DLL. It
resumes the child only after the child handshake succeeds, while preserving
the caller's original suspended semantics.

Only exact configured `trackingExecutablePaths` are eligible. For Khazan this
means the configured `BBQ-Win64-Shipping.exe`; it never means “any executable
under the install directory.” A child created through an uncovered mechanism
is allowed to run uninstrumented, but the overlay remains unavailable for that
session. There is no late-injection fallback.

## Elevation for Spider-Man-like games

GameHub stays `asInvoker`. If suspended creation returns
`ERROR_ELEVATION_REQUIRED`, a later phase may start the same one-shot
supervisor using `ShellExecuteExW` with the `runas` verb. This must not mutate
AppCompat, create a scheduled task, or expose a persistent privileged service.

A future elevated helper would have to accept exactly one opaque session and
exit with it. Both pipe endpoints would have to verify peer PID, creation time,
installed canonical path and Authenticode signer. No production elevation
adapter is currently implemented. Production enablement additionally requires
signed and timestamped supervisor and input-hook binaries, with CI verification.

## Input capability contract

Readiness is presence-scoped and all required paths must be covered:

- XInput variants: GetState, GetStateEx, GetKeystroke, Enable and SetState;
- Win32 keyboard state APIs;
- Raw Input data and buffer APIs;
- late resolution/module loading;
- DirectInput 8 factory, root and device paths, including GetDeviceState,
  GetDeviceData, Poll, Acquire and release restoration;
- every Windows.Gaming.Input polling projection the process can activate;
- GameInput current/history reads and callbacks when observed;
- exact SteamInput/SteamController interface revisions when observed;
- the exact child-creation APIs positively detoured for launcher sessions
  (`CreateProcessW/A` in the current synthetic fixture); other creation APIs
  remain separate unsupported capabilities.

`overlay-input-capability-contract.ts` defines an isolated, release-tested QA
evaluator for this report. It has no production caller and does not advance
the launch coordinator. It accepts `unknown`, never throws for malformed native
data, and requires every known backend exactly once, an exact
session/PID/creation-time/generation/topology/native-commit identity, pre-entry
inline detours, an absence-monitor epoch independently retained by the caller,
and a release fence. Required child-creation routes are an exact canonical,
duplicate-free set retained on both sides; every listed route must be covered.
DirectInput legacy/8, individual WGI projections, controller middleware and
child-creation routes are separate entries. Missing, unknown and
unsupported/faulted fields
fail closed. It currently has no authenticated native publisher or non-test
integration with the supervisor, launch path or input gate, so it cannot prove
that a reported behavior occurred. A future authorization path would also need
file/signature/mitigation, game-root and anti-cheat policy.

The existing fixed nine-word `Local\GameHubOverlayInputBlock` mapping is not
an authenticated publisher: a same-session process can pre-create it or forge
its readiness words. Production supervision therefore requires a
cryptographically random one-shot channel, collision rejection, an inherited
secret unavailable through the public namespace, exact slot-level coverage
and an atomic authenticated commit binding the full identity/generation tuple.
The legacy mapping and aggregate `covered > 0` accounting may never be used to
enable the production switch.

This channel can authenticate against stale, blind or map-only publishers; it
is not a security boundary against a hostile process running as the same
Windows object owner. That owner can generally obtain `WRITE_DAC` and re-ACL
peer process objects. Defending that stronger threat requires a separate
integrity/AppContainer or service boundary, not a stronger claim about a
same-token shared mapping.

Direct HID reads and any other observed path remain a hard refusal until
separately instrumented and proven. General asynchronous HID isolation needs
shadow buffers/OVERLAPPED completion fencing; robust device-wide support may
ultimately require physical-device hiding plus a virtual controller. A module
name is not evidence of complete coverage; runtime capability telemetry and
deterministic fixtures are required.

`overlay-controller-middleware-capability-contract.ts` supplies another
isolated, release-tested QA evaluator for those remaining stacks. It is not a
native authorization or hook implementation. It binds a complete observed
module/interface inventory to exact HID endpoint and handle generations;
requires each synchronous, overlapped, APC, event and IOCP route; namespaces
report schemas by operation, control semantic, transfer direction and report
ID; and requires neutralization for device-to-host transfers plus transfer-
specific hold/replay for host-to-device transfers. `SteamInput006` and
`SteamController008` remain separate exact revisions, unknown revisions fail
closed, and observed libScePad remains `abi-unverified`. This validator is not
a native HID/Steam/libScePad implementation, is not yet composed with the
coarse input-capability evaluator, and has no native collector supplying its
report. It does not make either real title compatible by itself.

While blocked, XInput must preserve connected identity and return a neutral
successful reading with stable packet semantics, rather than pretending the
controller disconnected. Keystrokes return `ERROR_EMPTY`. `XInputEnable(FALSE)`
semantics are the compatibility baseline: rumble is stopped, `SetState` updates
the registered request without sending it to the device, and release/re-enable
forwards the last registered vibration request. The fixture must model each real
DLL export surface separately—9.1.0 does not expose `XInputEnable` or
`XInputGetKeystroke`, and ordinal-only exports cannot be inferred from another
variant—and must cover multiple variants loaded in one process.
Raw Input extraction still calls the real API so queued records and sizing
contracts are drained, then neutralizes relevant payloads. DirectInput POV
neutral is `-1`; relative axes are zero and absolute axes require a proven
released baseline/range midpoint. Unknown RawGameController axes are never
guessed.

DirectInput buffered reads must preserve the documented `GetDeviceData`
contract. While blocked, the backend flushes real queued events by calling the
real method with a null output and `INFINITE` count (never by trusting or
overwriting an arbitrary caller buffer), reports zero consumable events to the
game, and retains `DI_BUFFEROVERFLOW`/acquisition failures where required.
Immediate reads use only a positively captured `DIDATAFORMAT`; standard
keyboard, mouse and joystick layouts have distinct neutral semantics. `Poll`
still advances the real provider so buffered state cannot accumulate behind
the overlay.

Overlay close uses a release fence: input remains blocked while buffered
events drain and every control is observed released for at least two samples
(approximately 50 ms). Only then are packet/edge baselines reset and physical
input returned to the game.

## Security and compatibility boundaries

Never instrument:

- platform-synced/protocol-launched games;
- an executable outside the configured game roots;
- protected/PPL processes;
- a process whose dynamic-code or signature mitigation blocks the payload;
- an anti-cheat/service tree;
- an ambiguous launcher child;
- an already-running game that missed pre-entry bootstrap.

No debugger flags or `SeDebugPrivilege` are used. DRM, self-integrity and
anti-cheat behavior is not bypassed. Refusal launches the game normally only
when doing so cannot corrupt cloud-launch state; it never advertises the
interactive overlay as ready.

After a commit frame is sent, loss of the resume acknowledgement is an
explicit `launch-outcome-unknown` terminal state. It must never trigger a
normal-launch fallback: the supervised process may already be running. A
future process/cloud coordinator must retain that uncertain identity in a
separate durable outcome token even though overlay authorization is revoked.

## Fixture gates

1. A DLL caches an XInput pointer before the fixture entry point. Late attach
   must fail the proof; supervised pre-entry launch must gate the cached call.
2. A loader creates a named renderer child. The child must handshake before
   its first instruction; the loader must never become the overlay target.
3. DirectInput exercises background/exclusive acquisition, buffered and
   immediate reads, polling, close/open transitions and exact restoration.
4. Windows.Gaming.Input exercises Gamepad, RawGameController, hotplug and
   capability revocation; hardware-in-loop follows deterministic COM tests.
5. PID reuse, stale FILETIME, replayed session and torn capability publication
   all fail closed.
6. EOF, timeout, supervisor crash and GameHub crash leave no suspended process
   and restore physical input promptly.
7. Dynamic-code/signature/PPL and anti-cheat fixtures make zero
   instrumentation attempts.
8. Spaces, quotes, long paths, non-ASCII paths and x86/x64 payload selection
   pass.
9. An isolated VM proves UAC cancellation and `RUNASADMIN` without changing
   the registry.

Only after these gates pass may the guarded populated-launcher harness run
Spider-Man 2 and Khazan. Both sessions require controller isolation held for
at least 60 seconds, visible overlay screenshots, focus evidence, child/session
telemetry, exact cleanup and an unchanged original database hash.

### Current accepted QA evidence

The repository currently release-gates the fixture-only supervisor, generic
cached-body detour, exact `CreateProcessW/A` child propagation, synthetic
XInput 1.3 subset, synthetic six-projection WGI, synthetic DirectInput 8, and
authenticated one-shot channel harnesses, plus a synthetic x64 WARP D3D11
render fixture. Their clean acceptance suites cover loader order, cached
function bodies, exact process/file identity, bounded crash cleanup, immutable
WGI publication generations, DirectInput buffered and immediate state
restoration across repeated generations, authenticated atomic readiness/release
records, and the render fixture's declared getter-visible base-D3D11.0 state and
lifetime boundary. These binaries are excluded from packaged runtime output.

This evidence is deliberately narrower than game compatibility. The child
fixture does not cover every Windows process-creation API, XInput does not yet
cover every system DLL variant, WGI is a synthetic SDK-ABI provider rather
than real controller hardware, and the channel is not a security boundary
against a hostile process running as the same Windows object owner. Direct
HID, exact Steam/controller middleware revisions, elevation, anti-cheat and
real-title render/input integration remain required before either target game
can be advertised as interactive-overlay compatible.

## Primary sources

- Microsoft Detours: <https://github.com/microsoft/detours>
- Using Detours: <https://github.com/microsoft/detours/wiki/Using-Detours>
- CreateProcessW: <https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw>
- PROC_THREAD_ATTRIBUTE_JOB_LIST: <https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute>
- CreateRemoteThread serialization: <https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-createremotethread>
- DLL best practices: <https://learn.microsoft.com/windows/win32/dlls/dynamic-link-library-best-practices>
- Process mitigation policy: <https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocessmitigationpolicy>
- DirectInput cooperative levels: <https://learn.microsoft.com/previous-versions/windows/desktop/ee417921(v=vs.85)>
- DirectInput immediate state/data formats: <https://learn.microsoft.com/previous-versions/windows/desktop/ee417897(v=vs.85)>
- DirectInput buffered data and flush semantics: <https://learn.microsoft.com/previous-versions/windows/desktop/ee417894(v=vs.85)>
- DirectInput polling: <https://learn.microsoft.com/previous-versions/windows/desktop/ee417913(v=vs.85)>
- XInput versions: <https://learn.microsoft.com/windows/win32/xinput/xinput-versions>
- XInputEnable compatibility semantics: <https://learn.microsoft.com/windows/win32/api/xinput/nf-xinput-xinputenable>
- XInputGetKeystroke empty-queue semantics: <https://learn.microsoft.com/windows/win32/api/xinput/nf-xinput-xinputgetkeystroke>
- Raw Input overview: <https://learn.microsoft.com/windows/win32/inputdev/about-raw-input>
- User-mode HID report acquisition: <https://learn.microsoft.com/windows-hardware/drivers/hid/obtaining-hid-reports>
- RawGameController: <https://learn.microsoft.com/windows/uwp/gaming/raw-game-controller>
- Steam Input API: <https://partner.steamgames.com/doc/api/isteaminput>
- UAC architecture: <https://learn.microsoft.com/windows/security/application-security/application-control/user-account-control/architecture>
- Running with administrator privileges: <https://learn.microsoft.com/windows/win32/secbp/running-with-administrator-privileges>
