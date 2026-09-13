# DXGI/D3D12 render-hook QA fixture

This directory is a clean-room, isolated Windows x64 acceptance fixture. It is
not linked to GameHub production code, packaging, either production feature
gate, or a real-game overlay compositor.

The launcher creates the fixture suspended, assigns it at creation time to a
kill-on-close job, and injects the bootstrap with Microsoft Detours. `DllMain`
does no D3D12 or DXGI work. It restores the Detours launch payload and detours
only the fixture's exported application-entry body. After loader lock, that
entry hook creates a hidden-window WARP D3D12 probe, discovers the host's exact
DXGI method bodies, attaches those bodies, destroys the probe, and enters the
fixture. No swap chain created by this fixture exists before method attachment;
this is not a claim about arbitrary work another startup thread could perform.

The fixture caches the application's raw `Present` body pointer and invokes it
directly. The pre-entry injected run reaches the detour through that unchanged
pointer. An uninjected run is a negative, and a deliberately late-loaded
bootstrap cannot claim method coverage. This is bounded evidence for one
synthetic process; it does not make already-escaped cached pointers in an
arbitrary process safe.

## Command-queue identity

The bootstrap also detours the discovered
`IDXGIFactory2::CreateSwapChainForHwnd` body. It retains a fixed-capacity record
of each D3D12 swap chain's controlling `IUnknown` identity and the exact
`ID3D12CommandQueue` supplied at creation. Registration verifies all of the
following:

- the swap chain and supplied queue resolve to the supplied D3D12 device;
- the queue is a direct queue;
- the supplied queue is the exact creation-record identity, not merely a
  different direct queue on the same device;
- the live `Present`, `Present1`, `ResizeBuffers`, and
  `SetFullscreenState` bodies equal the bodies attached before application
  entry.

The matrix first rejects an unassociated direct queue from the same device,
then accepts the exact primary queue. A second swap chain and its different
queue exercise selection refusal.

## Render and lifecycle evidence

Registration creates all fixture-owned render resources outside `Present`: a
fixed RTV heap, one allocator per back buffer, an isolated graphics command
list, and a fence. The selected callback uses the swap chain's
current buffer index, refuses an allocator whose prior fence is incomplete,
records a PRESENT-to-RENDER_TARGET transition, clears the back buffer, records
the transition back to PRESENT, executes the isolated list on the exact queue,
and signals without waiting. It skips one overlay submission on fixture lock or
GPU contention and always forwards the real DXGI call.

If `ExecuteCommandLists` succeeds but the following queue `Signal` fails, the
work is untracked. The bootstrap permanently retires that allocator slot,
disables overlay submissions for the registration, and refuses to release or
reuse its resources. Only a later, independently signaled exact queue fence can
prove all earlier queue work idle, clear the retirement, and permit rebuild.
The `signal-fault` case suppresses one post-execute signal, proves another
Present cannot reuse the command list or allocator, and then proves recovery
through that independent fence.

The test invokes both `Present` and `Present1`, including the raw cached body,
and accepts `DXGI_STATUS_OCCLUDED` for its hidden windows. The clear is only a
deterministic pixel-writing command-list probe. It is not an ImGui renderer,
notification renderer, alpha compositor, or D3D12 production overlay.

`ResizeBuffers` coverage holds an external back-buffer reference for one
expected `DXGI_ERROR_INVALID_CALL`, then releases it and proves a successful
resize and resource rebuild. Before releasing its own back buffers, the hook
signals and observes a resource-idle fence outside the Present path. Each wait
uses a fresh auto-reset event and re-reads the exact requested fence value after
every wake. A signal or event-registration failure, device-removed completion,
or bounded timeout permanently poisons that registration and prevents release.
An event with an outstanding registration is retained until process exit so a
late signal can never target a recycled handle. The `idle-stale-timeout` case
registers an unreachable future value, injects a stale wake, proves the exact
value is incomplete, continues to the real bounded wait timeout, and proves
resize and teardown retain the unsafe resources instead of authorizing release.
Teardown uses the same fence rule.

The window lifecycle creates two real top-level windows, changes the primary
window extent, verifies a windowed `SetFullscreenState(FALSE)` and
`GetFullscreenState`, and proves both windows are destroyed. It does not enter
DXGI exclusive fullscreen.

## Hot-path and teardown boundary

The acceptance harness statically rejects explicit allocation and wait APIs in
the fixture's `SubmitOverlay` body. It does not present a tautological runtime
allocation counter as evidence. The callback uses fixed arrays and pre-created
COM objects, and a guarded counter proves the resource-idle wait helper is not
entered from the render body. This is deliberately narrower than the production
contract's global `allocationFreePresentPath` and `nonblockingPresentPath`
claims:

- D3D12, DXGI, the WARP driver, Detours trampolines, and the forwarded real
  `Present` may allocate or block internally;
- callback admission intentionally waits while teardown owns the writer gate;
- resize and teardown are lifecycle paths and may perform a bounded fence wait;
- the QA-only pause used by the reader-fence race intentionally spins.

Consequently, this fixture alone must not publish a production render
capability report with those broad fields set to true.

Detach closes callback admission, waits for an already admitted Present reader,
keeps the exclusive reader fence across the Detours commit and resource-idle
release, and then wakes a late entrant. The race case proves that the late call
was blocked before admission and forwarded through the restored body after the
commit. The initial application-entry attach runs during suspended process
initialization and updates only the current loader thread. The later method
attach and explicit detach run outside loader lock and enlist every other
process thread that remains openable. A launcher self-termination case
separately proves that the kill-on-close job terminates the exact suspended
child; an unreadable survivor creation time is treated as an unresolved live
process, never as successful cleanup.

## Deliberate remaining gaps

This slice does not cover swap-chain final-release invalidation,
`ResizeBuffers1`, `SetSourceSize`, real device removal, device reset/hang,
late-loaded graphics-module monitoring, cross-adapter or multi-node queues,
multiple concurrent production registrations, HDR/color-space state, arbitrary
host resource-state tracking, or an application's command-list/queue
synchronization policy. Public D3D12 exposes no deterministic API that removes
the WARP device, so no device-removal claim or synthetic terminal-result seam is
made here. Those render-capability surfaces remain uncovered.

It also does not prove D3D11, Vulkan, OpenGL, x86, anti-cheat compatibility,
third-party process injection, Spider-Man, Khazan, or any other real game. No
source from hudhook, Universal Dear ImGui Hook, MangoHud, or OBS's graphics hook
was copied into this fixture; those projects informed only the questions this
acceptance slice asks.

## Run

```powershell
node native/overlay-fixtures/dxgi-d3d12/build-and-test.cjs
```

The build verifies the repository's pinned Detours commit and complete source
hash manifest. It compiles x64 with `/W4 /WX /sdl /guard:cf`, links each fixture
binary with ASLR, NX, high-entropy VA, and Control Flow Guard, and verifies those
PE properties with `dumpbin`. The current matrix contains 21 fresh-process
cases: two setup-result classification cases, uninjected and late-attach
negatives, normal, post-execute-signal-fault, stale-wake/timeout, and
reader-fence injected runs, launcher crash containment, and 12 additional
injected stress runs.

Every setup failure report includes its exact stage and HRESULT. Only a narrow
allowlist at DXGI factory, WARP-adapter enumeration, or D3D12-device creation is
classified as environment unsupported and exits with code 77. Queue,
swap-chain, window, out-of-memory, and all other failures are hard failures;
they cannot silently turn the matrix into a skip.
