# DXGI/D3D11 render-hook QA fixture

This directory contains a clean-room, isolated Windows x64 acceptance fixture.
It is not linked to GameHub production code, packaging, or feature switches.

The injected bootstrap performs no D3D/DXGI work from `DllMain`. Its loader-lock
work is limited to `DetourRestoreAfterWith`, atomics, and a Detours transaction
on the fixture's exported application-entry body. The detoured entry then runs
after loader lock, creates a hidden-window WARP D3D11 probe swap chain, discovers
the exact COM method bodies available on the host, applies presence-scoped body
hooks, destroys the probe, and only then calls the real fixture entry. No
application swap chain exists before those body hooks.

The fixture then caches the primary application's exact `Present` body pointer
and invokes that cached pointer directly. The injected case reaches the body
hook; the uninjected and deliberately late-loaded bootstrap cases do not. This
is a synthetic pre-application-chain ordering proof. It is not a generic claim
that an arbitrary already-running process can be attached without an escaped
cached call.

The fixture registers one exact swap-chain/device/immediate-context identity and
refuses overlay handling for a competing chain while always forwarding the real
DXGI call. Registration rejects a deferred context, a different COM identity,
a different device, and a live swap-chain implementation whose hooked vtable
bodies differ from the WARP probe bodies actually attached by Detours.
The Release body is checked separately for every stored controlling-`IUnknown`,
base-chain, and chain1/2/3 interface token; registration fails if any non-null
token can bypass the attached Release body.

`Present` and `Present1` use an interlocked draw gate and a try-only shared
resource lock: contention skips one overlay frame instead of waiting on either
fixture render lock. The overlay shaders and render target are created outside
the Present callback. The callback uses fixed-size stack storage to capture and
restore the tested D3D11.0 getter-visible subset around a real three-vertex
draw:

- IA layout, vertex/index bindings, strides, offsets, format, and topology;
- VS/HS/DS/GS/PS/CS shaders, class-instance arrays, base constant-buffer
  bindings, SRVs, and samplers;
- rasterizer state, viewports, and scissors;
- one fixed OM RTV plus DSV, blend, depth/stencil, and OM UAV slots 1 through 7;
- CS UAV slots 0 through 7, stream-output buffer bindings, and predication.

The seeded host state is non-null in each reported category: all six shader
stages have a shader/constant buffer/SRV/sampler, the pixel shader has a real
dynamic-linkage class instance, OM has RT/DS/blend/depth and a UAV at slot 1,
CS has a separate UAV, and SO/predication are active. Arbitrary OM layouts are
refused rather than restored under an inferred UAV start slot. The hook compares
the first getter-visible capture against a second capture immediately after
restoration and before forwarding to DXGI. The required internal difference
mask is zero. After the real flip-model `Present`, the fixture separately
expects only the OM-target bit (`256`) because DXGI unbinds the presented flip
backbuffer. The legacy multisample/discard control expects zero. This separates
overlay mutation from real-Present semantics.

D3D11 exposes neither the numeric stream-output cursor nor UAV hidden counter
through its state getters. Restoration therefore uses the documented
`D3D11_APPEND_ALIGNED_ELEMENT` and `D3D11_KEEP_UNORDERED_ACCESS_VIEWS`
sentinels. The fixture proves the visible bindings and exercises those preserve
paths; it does not independently prove that the hidden numeric values remained
byte-exact. Likewise, D3D11 getters return the requested RTV slot array but not
the original trailing-null `NumViews`; the fixture proves the visible RTV
objects, not that hidden count. It also does not capture D3D11.1
constant-buffer first/count ranges or UAV slots beyond the D3D11.0 eight-slot
surface. The `0x0000ffff` report value is a fixture category bit mask, not a
claim of complete D3D11 pipeline coverage.

Resize callbacks serialize selected resize calls, publish the overlay as not
ready while no backbuffer view exists, forward without holding the resource
lock, and rebuild or invalidate under exclusive resource ownership. A
fixture-observed reentrant WARP `Release` forwards directly through the original
body while inheriting its outer callback admission; only a top-level exact-chain
final release performs destruction invalidation. The destruction case releases
the base chain non-finally and then proves invalidation on the controlling
`IUnknown` final release. The matrix covers a
deliberately failed resize with an external backbuffer reference, a successful
resize, successful and rejected `SetSourceSize` calls, and presence-scoped
`ResizeBuffers1`. The latter is expected to return `DXGI_ERROR_INVALID_CALL` on
both test calls because its D3D11 evidence is interception/forwarding only.

Detach first closes a writer-pending callback-admission gate, waits for admitted
readers, keeps the exclusive lifecycle gate across the Detours detach commit and
resource release, then wakes late entrants. The detach case proves both a reader
already inside Present and a later Present blocked before shared admission; the
late call forwards through the post-commit original pointer. All process threads
that remain openable are enlisted in attach/detach transactions. Threads that
vanish during enumeration are tolerated, while other enlistment failures remain
fatal.

The matrix also covers a safe `SetFullscreenState(FALSE)` transition, a
multisample legacy backbuffer, swap-chain-destruction invalidation, a
terminal-Present-result classification seam, a late-attach negative, an
uninjected negative, and 24 fresh-process runs. The terminal-result seam proves
that the same helper used by the real Present hooks invalidates on
DEVICE_REMOVED/RESET/HUNG and rejects `S_OK`; public D3D11 has no deterministic
API to remove the WARP device, so this is not a real device-removal test. The
launcher assigns the target at creation time to a kill-on-close job, and a
launcher self-termination case verifies that the exact suspended child identity
dies with the job.

The normal Present path performs no explicit fixture heap allocation, and it
does not wait on the fixture's draw or resource locks. This is not a global
allocation-free or nonblocking claim: COM getter/reference operations and the
D3D11/DXGI runtime or driver may allocate or block, and lifecycle detach is
allowed to wait for callback quiescence.

Run:

```powershell
node native/overlay-fixtures/dxgi-d3d11/build-and-test.cjs
```

The build verifies the repository's pinned Microsoft Detours commit and source
hash manifest, compiles x64 with `/W4 /WX`, links with `/OPT:NOICF`, checks PE
machine types, asserts successful `DetourRestoreAfterWith` launch-payload
restoration, and executes the acceptance matrix.
The current matrix contains 32 fresh-process cases.

This fixture proves only synthetic hidden-window WARP DXGI/D3D11 behavior on the
machine running it. It does not prove D3D12, Vulkan, OpenGL, exclusive-fullscreen
transitions, anti-cheat safety, third-party injection, or compatibility with any
real game. It also does not prove arbitrary deferred-context ownership, unknown
swap-chain implementations, arbitrary OM layouts, D3D11.1 hidden state, or
concurrent production resize/registration policy. No source from hudhook, OBS,
MangoHud, or Universal Dear ImGui Hook is copied here; those projects informed
the acceptance questions only.
