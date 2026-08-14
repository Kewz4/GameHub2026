# Synthetic XInput cached-pointer QA fixture

This directory is an isolated Windows x64 acceptance fixture. It is not wired
to GameHub's launcher, overlay manager, input hook, packaging, or any
production feature switch. It never launches Electron or a game.

## Exact proof boundary

The positive fixture models only an input-bearing synthetic `xinput1_3.dll`
polling/control subset:

- named `XInputGetState`, `XInputGetKeystroke`, `XInputEnable`, and
  `XInputSetState` exports;
- ordinal 100 `NONAME` `XInputGetStateEx`;
- fixture-only instrumentation exports used to set and observe deterministic
  physical state.

The build rejects an accidentally named `XInputGetStateEx` export and verifies
the exact intended fixture name/ordinal allowlist with `dumpbin`. The four
input-bearing names use their real 1.3 ordinals (2, 3, 5, and 8), ordinal 100
is unnamed, and instrumentation is isolated at ordinals 1001-1003 so it cannot
impersonate the unmodeled 101-103 surface. It does **not** model or prove
the complete XInput 1.3 surface: capabilities, battery, audio device IDs, and
ordinals 101-103 are intentionally absent. It does not prove XInput 1.4,
XInput 9.1.0, XInput 1.1/1.2, simultaneous XInput DLLs, system DLL forwarding,
DirectInput, Raw Input, HID, WGI, Steam Input, concurrent calls/unhooking,
anti-cheat compatibility, or any real game. Those remain production blockers.

## Load and cached-pointer proof

The synthetic load graph is:

```text
xinput1_3 provider <- cache dependency <- injected bootstrap
                     ^                   (inline DetourAttach)
                     |
                     +-- fixture EXE
```

The cache dependency initializes before the bootstrap because it is a
bootstrap import. Its `DllMain` resolves ordinal 100 with
`GetProcAddress(..., MAKEINTRESOURCEA(100))`, caches all five callable body
addresses, and makes physical `GetState`/`GetStateEx` calls before any Detours
transaction. The
bootstrap records and compares those exact five addresses before attaching.
After process entry, the fixture verifies the unchanged cached addresses enter
the hooks while blocked, pass through the still-installed hooks after release,
and return original provider values again after explicit single-thread detach.

An uninjected control stays physical. A late-attach expected-negative records
one cached `GetState` physical call before loading/attaching the bootstrap,
proving that a hook installed after that cached pointer is first used cannot
hide the earlier call.
Its exit status is deliberately 31 and its report can never be `proofPassed`.

The bootstrap performs the bounded attach transaction from `DllMain` so the
pre-entry property is directly observable. This is synthetic loader-order
evidence, not a production loader-lock safety proof. Process detach performs no
Detours transaction; explicit detach is exercised only by the single-threaded
fixture.

## Block and release semantics

Before blocking, a connected controller returns non-neutral physical state and
vibration A reaches the provider. Beginning the block sends `Enable(FALSE)` to
stop current vibration. While blocked, the hooks:

- preserve connected `ERROR_SUCCESS` identity for user zero and preserve
  `ERROR_DEVICE_NOT_CONNECTED` for absent users;
- return one nonzero neutral-transition packet N that differs from the last
  physical packet P, then keep N stable across hidden physical changes for
  `GetState` and ordinal-100 `GetStateEx`;
- consume the provider's finite keystroke queue while returning `ERROR_EMPTY`
  and a zeroed keystroke, leaving no stale event after release;
- register the last `SetState` vibration without forwarding it;
- register blocked `XInputEnable` requests without forwarding them.

The isolated sequential release fence is fed from the provider's actual queue,
connection, and neutral controls—not caller-supplied readiness booleans. It
requires the exact generation/topology, zero queued events, two neutral samples,
and at least 50 ms. Tests cover timestamp 0/50, pending/non-neutral reset,
repeated-close idempotence, stale identity, backwards time, and fail-closed
topology invalidation during dwell. Invalidation enters an Invalidated phase,
retains the latch, and rejects both old-epoch and unvalidated new-epoch release
observations. A fixture-only revalidation must prove the exact new identity,
cached provider bodies, and connected provider before close/dwell can restart.
Out-of-order close requests cannot rewrite Invalidated or Fault into a
releasable phase.
Release replays the last vibration request and the
last requested enable state before clearing the block latch; restoration
failure enters Fault and retains the latch. This local state machine mirrors
the intended policy but is not wired to or a concurrency proof of
`native/gamehub-inputhook/src/release_fence.rs`.

## Containment and provenance

The standalone launcher atomically assigns the suspended fixture to a
kill-on-close job through `PROC_THREAD_ATTRIBUTE_JOB_LIST`, verifies the initial
suspend count, and proves both timeout and deliberate launcher-crash cleanup by
PID plus process-creation FILETIME identity.

The build validates the allowlisted Microsoft Detours v4.0.1 commit, tree,
license, and every vendored source hash before compiling with `/W4 /WX` and
`/OPT:NOICF`. That proves source provenance and a repeatable procedure on the
validated local MSVC toolchain; it does not claim cross-host bit-identical
binaries.

Run the build and 34 acceptance cases with:

```powershell
node native/overlay-fixtures/xinput/build-and-test.cjs
```
