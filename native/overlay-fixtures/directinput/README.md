# Synthetic DirectInput 8 cached-body QA fixture

This directory is an isolated Windows x64 acceptance fixture. It is not wired
to GameHub's launcher, input hook, overlay manager, packaging, or a production
feature switch. It never starts Electron or a game. Passing it must not enable
the production DirectInput capability.

## Exact proof boundary

The fixture models a deterministic `dinput8.dll` subset:

- `DirectInput8Create` at ordinal 1;
- A/W `IDirectInput8` roots and A/W `IDirectInputDevice8` devices;
- controlling-`IUnknown`, A/W `QueryInterface`, `AddRef`, and `Release` for the
  synthetic objects;
- root `CreateDevice`;
- `SetDataFormat`, `DIPROP_RANGE`, cooperative level, acquire/unacquire,
  `GetDeviceState`, buffered `GetDeviceData`, and `Poll`;
- fixture-only instrumentation at ordinals 1001-1005.

The provider exports canonical-shaped keyboard, mouse, mouse2, joystick, and
joystick2 data tables at ordinals 2-6. They provide deterministic object
layouts for this fixture; this is not a claim that their flags and optional
objects are byte-for-byte copies of every Windows DirectInput runtime. The
fixture also exercises a caller-owned custom format with padding. The hook
copies the caller's exact object offsets and types, preserves padding, returns
buttons as zero, POVs as `-1`, relative axes as zero, and absolute axes at the
midpoint of their tracked `DIPROP_RANGE`. A malformed overlapping format is
rejected without replacing the active format. A structurally valid object with
`GUID_Unknown` permanently faults readiness rather than inventing neutral
semantics.

This proof deliberately excludes:

- legacy `dinput.dll`, DirectInput versions before 8, arbitrary providers,
  system-DLL forwarding, multiple simultaneous DirectInput providers, and
  post-load provider replacement;
- simultaneous caller-driven COM lifetime, data-format, or topology mutation;
  thread creation or destruction during the bounded detach transaction; and
  more than 256 already-existing process threads at detach;
- `SetActionMap`, action mapping, and event-notification mode. Seeing either
  surface permanently fails readiness even when the synthetic provider returns
  a normal HRESULT;
- force feedback, effects, semantic enumeration, and all other unmodeled
  DirectInput methods;
- Raw Input, HID, GameInput, Windows.Gaming.Input, XInput, Steam Input,
  anti-cheat, and injected third-party overlays;
- compatibility with Khazan, Spider-Man, or any other real game.

Those are production blockers, not follow-up assertions implied by a green
synthetic run. The fixed-capacity registry and all hooked calls are synchronized
in this proof. Four caller threads continuously exercise `GetDeviceState` and
`Poll` across a second block/release cycle and a detach transaction. A
fixture-only pause makes the in-flight detach race deterministic. The
production DirectInput gate remains fail closed until all loaded input stacks
are proven together.

## Pre-entry cached-body proof

The synthetic load graph is:

```text
dinput8 provider <- cache dependency <- injected bootstrap
                   ^                   (inline DetourAttach)
                   |
                   +-- fixture EXE
```

The cache DLL initializes before the bootstrap because it is a bootstrap
dependency. In `DllMain`, it resolves `DirectInput8Create`, creates A/W roots
and keyboard/joystick devices, stores the factory and 30 distinct COM method
body addresses, configures an asymmetric `[-3000, 1000]` X-axis range, acquires
both devices, then makes physical `GetDeviceState` calls before any Detours
transaction.

Before attaching, the bootstrap proves the factory export and all 31 cached
body addresses belong to the exact loaded synthetic provider module, are
distinct, and still equal every corresponding live factory/root/device slot.
The same exhaustive comparison is repeated by every topology validation; a
single synthetic `Poll`-slot substitution permanently faults readiness. It then
attaches the factory, both root `CreateDevice` bodies, and the fourteen A/W
device-body pairs. The fixture calls the original cached addresses and vtable
entries after process entry, showing that inline body patching intercepts
pointers captured and executed before bootstrap initialization.

An uninjected control stays physical. A late-load expected negative performs a
physical cached call, loads and attaches the bootstrap afterward, and proves
only subsequent calls can be neutralized. That report always has
`proofPassed: false`.

## COM, format, block, and release semantics

The positive cases verify that A/W queries share one controlling `IUnknown`,
successful queries and explicit `AddRef` calls are balanced by exactly one
`Release`, and the provider ends with zero live objects and references. The
hook does not perform hidden `QueryInterface` or reference-count operations.
New devices returned through a detoured root body enter a synchronized,
fixed-capacity registry and cannot make readiness true until their format is
known. A ten-device A/W case proves that registry exhaustion faults readiness,
that both `Acquire` hooks roll back the provider acquisition, and that both
`Acquire` and `Unacquire` return a safe failure instead of dereferencing a
missing record. It then releases every overflow-test interface, proves the
registry returned to the two cached devices with balanced references, detaches,
requires `GameHubDiQaReleaseAll` to succeed, and verifies zero provider objects
or references remain.

At pre-entry attach, the bootstrap retrieves and validates `DIPROP_RANGE` for
every absolute axis; any missing or malformed range fails closed. Beginning a
block requires the exact generation and topology, the exact cached bodies, a
valid format for every live tracked device, and no unmodeled surface.
It latches before draining every acquired device with the documented
`GetDeviceData(..., nullptr, &INFINITE, 0)` form. While latched:

- successful `GetDeviceState` calls preserve their HRESULT and overwrite only
  described input objects with format-correct neutral values;
- `GetDeviceData` drains the provider, returns a zero count, and never copies a
  physical event to the caller;
- `Poll` preserves the provider result while all readable state remains behind
  the neutralizing hooks;
- an unknown interface/format or failed drain enters a permanent fault and
  retains the latch.

The isolated release fence requires an exact close identity, an empty buffered
queue, two physical-neutral samples, and at least 50 ms. It handles stale
identity, backwards time, non-neutral resets, and fail-closed topology
invalidation. Revalidation requires the same generation, a strictly newer
epoch, the exact provider/body topology, and a fully valid registry. A final
drain occurs before the latch is cleared. A released cycle can only be re-armed
with the exact completed identity, a fixture authentication constant, and the
exact next generation/epoch; bad authorization and stale generations are
rejected. Skipped generations, skipped epochs, and a replay of the already
applied re-arm command are explicit negatives. Tests complete two cycles, show
no buffered event remains, and prove cached pointers return physical state
after each release.

Detach first blocks new hook entries, drains a counted in-flight set, enlists
all existing process threads in the Detours transaction, restores all 31
bodies, and only then releases waiting callers. The concurrent case proves
physical calls continue through the restored cached pointers and that no hook
call remains in flight after thread join.

## Containment and provenance

The launcher atomically assigns the suspended fixture to a kill-on-close job
through `PROC_THREAD_ATTRIBUTE_JOB_LIST`, verifies the initial suspend count,
and checks timeout and deliberate launcher-crash cleanup using PID plus process
creation time.

The build verifies the allowlisted Microsoft Detours v4.0.1 commit, tree, MIT
license, exact source manifest, and every source hash before compiling a fresh
x64 graph with `/W4 /WX` and `/OPT:NOICF`. `dumpbin` checks the exact provider,
cache, and bootstrap export names/ordinals and x64 machine type. Every binary's
normalized module-and-symbol import graph is pinned by an exact hash; dependency
module sets and private-DLL symbol/ordinal sets are also explicit allowlists, so
additional imports fail the build.
This proves a repeatable procedure on the tested MSVC host, not cross-host
bit-identical binaries.

Run the clean build and 34 acceptance cases with:

```powershell
node native/overlay-fixtures/directinput/build-and-test.cjs
```

The optional `GAMEHUB_DI_QA_REUSE_DETOURS=1` environment variable skips only
the expensive Detours rebuild during local iteration. Acceptance evidence must
come from an unset, fresh run.
