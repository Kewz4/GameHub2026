# Synthetic WGI cached-polling QA fixture

This directory is an isolated Windows x64 acceptance fixture. It is not wired
to GameHub's launcher, overlay manager, input hook, packaging, or a production
feature switch. It never launches Electron or a game, and it does not enable
WGI interception for Spider-Man, Khazan, or any other real title.

## Exact proof boundary

The synthetic provider implements the Windows SDK ABI declarations for these
six classic `Windows.Gaming.Input` polling projections:

- `IGamepad::GetCurrentReading`;
- `IRawGameController::GetCurrentReading`;
- `IRacingWheel::GetCurrentReading`;
- `IFlightStick::GetCurrentReading`;
- `IArcadeStick::GetCurrentReading`;
- `IUINavigationController::GetCurrentReading`.

The contract pins the corresponding SDK vtable slots and asserts the x64
reading structure sizes and field offsets at compile time. The build uses the
installed Windows SDK headers and rejects warnings with `/W4 /WX`. This is ABI
evidence for those six fixture-owned call bodies, not proof that a future SDK
cannot add other interfaces or that every game uses this surface.

The synthetic Gamepad and Raw projections are two interfaces on one object and
must return the same controlling `IUnknown`. The other four projections have
distinct controlling identities. Every interface round-trips through
`QueryInterface`, every acquired reference is released, and the provider
reports exact, equal nonzero `AddRef`/`Release` totals, zero transient
references, and zero over-release attempts after each positive process. A
separate negative deliberately releases a base-owned object and proves the
over-release counter catches the imbalance without underflowing the static
object.

The Raw projection has a deliberately fixed fixture schema: ten buttons, one
eight-way D-pad switch, four centered stick axes, and two zero-based trigger
axes. Its physical and neutral values map exactly to this fixture's Gamepad
reading. It is not described as the universal Xbox or WGI Raw layout. Microsoft
documents that Raw counts come from each controller's capabilities and that Raw
axis values occupy `[0.0, 1.0]`:

- https://learn.microsoft.com/windows/uwp/gaming/raw-game-controller
- https://learn.microsoft.com/uwp/api/windows.gaming.input.rawgamecontroller.getcurrentreading
- https://learn.microsoft.com/windows/uwp/gaming/registry-data-for-game-controllers

## Cached-body and hot-path proof

The synthetic load graph is:

```text
provider <- cache dependency <- fixture executable
              ^
              +--------------- injected bootstrap
```

The cache resolves the provider's fixture-local `RoGetActivationFactory`
export, activates all six class names with `IInspectable`, validates every
object/vtable/controlling identity, caches all six polling body addresses, and
makes one non-neutral physical poll through each body before bootstrap attach.
The bootstrap compares the exact cached objects and bodies, then Detours the
activation body and all six polling bodies before process entry. The fixture
proves that the unchanged cached pointers enter the hooks while blocked, pass
through still-installed hooks after release, and return physical values after
explicit single-thread detach.

An uninjected process stays physical. A late-attach expected-negative records
six physical polls before loading the bootstrap, proving that a later hook
cannot hide calls that already escaped. Its report can never set
`proofPassed`.

The hook allowlist uses at most 64 entries in each of 64 statically allocated,
process-lifetime generations. A published generation is never reused or has its
identity fields rewritten, so a paused reader can only mark the generation it
actually observed. The control path initially publishes six entries and retains
retired plus current identities during a latched replacement. The 65th
generation is deterministically refused while the block remains latched.
Polling hooks only make bounded atomic reads, call the already-cached provider
trampoline for registered objects, and overwrite the six known output layouts;
they allocate no memory or acquire a lock in normal operation. An unregistered
object entering a hooked body while blocked is zeroed where bounded and rejected
with `E_ACCESSDENIED` without calling the provider. A topology change keeps the
block latch set, invalidates readiness, and requires
explicit validation of the exact generation, epoch, serials, objects, vtables,
Raw schema, controlling identities, and activation behavior before publication.

## Block and release semantics

While the latch is set, each registered polling body first consumes its real
provider reading and then returns the projection's neutral layout while
preserving its timestamp. The release fence requires:

- the exact validated generation and topology epoch;
- unchanged per-projection serials;
- one post-publication provider poll for every retained object identity plus
  every projection bit, recorded on the exact immutable generation and current
  block-drain epoch;
- provider-backed physical neutrality;
- two neutral observations spanning at least 50 milliseconds.

Non-neutral state and backwards time reset the dwell. Stale identity is ignored.
Topology mutation invalidates readiness without clearing the latch. A valid
same-vtable controller-object replacement retains both the old game-cached
identity and the new topology identity while latched; the fixed cap is checked
before publication and exhaustion rejects revalidation without clearing the
latch. Before revalidation, the replacement's unregistered but same-body object
is rejected without incrementing the provider poll counter; after revalidation,
both old and new identities must drain before release. Six injected fault modes
cover failed `QueryInterface`, a null vtable, a mismatched body, a
wrong Raw schema, activation failure, and an explicit non-neutral fault. Each
fails closed, stays latched, and can recover only after the provider is repaired
and the new epoch is explicitly revalidated. Unknown fault/mutation values,
class names, IIDs, projections, output sizes, and malformed Raw buffer counts
are rejected.

A deterministic race pauses an Arcade reader after it captures generation one,
publishes generations two and three, resumes the reader, and proves its late
drain cannot satisfy generation three. The active generation is then drained
normally. A separate eight-thread test performs 1,024 simultaneous six-
projection polling rounds while blocked and requires every returned reading to
stay neutral.

## Containment, provenance, and limitations

The launcher assigns the initially suspended fixture to a kill-on-close job by
`PROC_THREAD_ATTRIBUTE_JOB_LIST`, verifies the initial suspend count, and tests
both timeout and deliberate launcher-crash cleanup using PID plus process
creation `FILETIME` identity. Twenty fresh-process attach/block/release/detach
runs provide deterministic stress coverage.

The build verifies the allowlisted Microsoft Detours v4.0.1 commit, tree,
license, source list, and source hashes before compiling, and links with
`/OPT:NOICF`. Output is written only below the ignored
`native/overlay-fixtures/target/wgi-qa-x64` directory.

This fixture does not emulate real WGI static interfaces, controller
collections, added/removed events, `IGameController` metadata, users, headsets,
battery reporting, force feedback, haptics, system `combase.dll`, arbitrary Raw
schemas, an unhooked newly discovered vtable body, more than 64 retained object
identities, other SDK generations, ARM/x86, simultaneous input stacks,
arbitrary concurrent topology/poll schedules or concurrent detach,
anti-cheat behavior, hardware-in-the-loop physical neutrality, or a real game's
cached pointers. The activation hook observes and forwards the fixture factory;
it does not model or contain real static-interface enumeration. Attaching from
`DllMain` is bounded synthetic loader-order evidence, not a production
loader-lock safety claim. Those remain blockers to production enablement, and
the production WGI release fence must stay disabled.

Run the build and 38 acceptance cases with:

```powershell
node native/overlay-fixtures/wgi/build-and-test.cjs
```
