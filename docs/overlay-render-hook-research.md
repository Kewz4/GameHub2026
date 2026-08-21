# Overlay render-hook research

## Status and scope

Reviewed on 2026-08-20 at these exact upstream revisions:

- hudhook `8134c519a0cd413efecd80ab2a17a0577fc4ddee` (MIT)
- Universal Dear ImGui Hook `a3427acf47a469027da3ccf01f27f782170f82ec`
  (MIT)
- MangoHud `251beb14657255ab5f8136c607eb6abee3b4aec7` (MIT)
- OBS Studio `0043697fc59d791b95b3495dfa1fe180b395966f`
  (GPL-2.0)

This research covers the render/compositing half of an overlay. It does not
authorize injection and it does not solve input isolation. GameHub's live
interactive-input switch remains disabled until the supervised-launch, input,
child, elevation and anti-cheat gates in `overlay-supervised-launch.md` pass.
The current external transparent `BrowserWindow` remains the production render
path.

No upstream source is copied. In particular, OBS code is GPL-2.0 and is used
only as an architectural reference.

The Windows DXGI QA evidence schema is implemented in
`src/main/services/overlay-render-capability-contract.ts`. It is an isolated,
release-tested evaluator with no production caller; it does not authorize
injection or advance the supervised-launch state machine. The evaluator
requires the full pinned process identity, the already-authorized input
generation, exact native commit/topology generations, an architecture-matched
payload, a complete backend/surface report, pre-entry cached-pointer detours,
a nonblocking/allocation-free Present path and a hook-reader teardown fence.
Malformed or self-reported unsupported/fault evidence fails closed. Report
authenticity, monotonic native publication and coordinator wiring remain
mandatory native work. Vulkan/OpenGL are deliberately not accepted by this
Windows schema; the MangoHud-derived Linux lifecycle needs its own
backend-specific contract and fixtures.

The schema is coarse self-attestation: a `covered` state or hot-path Boolean is
not measured native proof. It does not encode D3D11.1 constant-buffer ranges,
extended UAV slots, hidden SO/UAV counters or trailing-null RTV topology, and
it cannot distinguish a terminal-error test seam from real device removal.

The release-gated native render evidence is limited to the isolated synthetic
x64 WARP D3D11 fixture in `native/overlay-fixtures/dxgi-d3d11`. It proves its
declared getter-visible base-D3D11.0 subset, exact cached method bodies,
swap-chain/device/immediate-context identity, resize/destruction handling and a
late-reader detach barrier. It does not prove D3D11.1 hidden state, D3D12,
Vulkan, OpenGL, hardware-driver behavior, production wiring or a real game.

## What is worth adopting

### hudhook

hudhook resolves shared DXGI method bodies from a dummy swap chain, installs
inline hooks for `Present`/`ResizeBuffers`, uses a hook-ejection barrier, and
keeps the Present path nonblocking with `try_lock`. Its D3D11 backend attempts
pipeline-state save/restore around its own render target, but the current
implementation does not preserve the complete OM render-target/depth-stencil
set or every shader stage/resource binding. Its `Present1`/`ResizeBuffers1`
coverage is in the D3D12 hook, not the D3D11 hook. The D3D12 backend also
tracks command-queue identity, fences and device removal.

GameHub should adopt these concepts in a synthetic compositor fixture:

- process-wide body detours installed before game entry, rather than vtable
  mutation or late IAT-only patching;
- an allocation-free/nonblocking Present callback that skips an overlay frame
  instead of stalling the game;
- a complete GameHub-owned backend-specific state backup/restore around every
  draw (hudhook is a useful starting checklist, not proof of completeness);
- explicit coverage for required `Present`/`ResizeBuffers` plus every observed
  optional `Present1`, `ResizeBuffers1`, source-size and device-loss lifecycle
  surface;
- an in-flight hook-reader barrier before detach or DLL unload.

References:

- [D3D11 hook](https://github.com/veeenu/hudhook/blob/8134c519a0cd413efecd80ab2a17a0577fc4ddee/src/hooks/dx11.rs)
- [D3D11 renderer](https://github.com/veeenu/hudhook/blob/8134c519a0cd413efecd80ab2a17a0577fc4ddee/src/renderer/backend/dx11.rs)
- [D3D12 hook](https://github.com/veeenu/hudhook/blob/8134c519a0cd413efecd80ab2a17a0577fc4ddee/src/hooks/dx12.rs)
- [Hook ejection barrier](https://github.com/veeenu/hudhook/blob/8134c519a0cd413efecd80ab2a17a0577fc4ddee/src/util.rs)

### OBS Studio graphics hook

OBS identifies the real API from the observed DXGI swap chain, tracks the
selected chain, reacts to DXGI destruction notification, clears API resources
before `ResizeBuffers`, and avoids using the first invalidated backbuffer after
resize. Its D3D11 capture path distinguishes multisampled resolve from direct
copy and has explicit shared-texture/staging-resource teardown. That capture
path copies pixels without drawing into or mutating the host render pipeline,
so it is not evidence for pipeline-state restoration around an overlay draw.
OBS also builds separate injection helpers/payloads for target architecture.

GameHub should adopt the lifecycle and telemetry patterns:

- bind rendering to an observed swap-chain + device identity, not merely the
  first `Present` call;
- detect competing swap chains and invalidate/reselect after a bounded mismatch
  sequence;
- destroy every API object before resize and recreate only after the real
  resize succeeds;
- handle swap-chain destruction and device removal as synchronous capability
  invalidation;
- publish target architecture and require an exact x86/x64 payload match.

GameHub must not adopt OBS's late remote injector, `SeDebugPrivilege`,
`PROCESS_ALL_ACCESS`, or pixel-capture transport as overlay authorization.
Capturing pixels does not prove safe game-memory mutation, compositing, input
isolation or teardown.

References:

- <https://github.com/obsproject/obs-studio/blob/0043697fc59d791b95b3495dfa1fe180b395966f/plugins/win-capture/graphics-hook/dxgi-capture.cpp>
- <https://github.com/obsproject/obs-studio/blob/0043697fc59d791b95b3495dfa1fe180b395966f/plugins/win-capture/graphics-hook/d3d11-capture.cpp>
- <https://github.com/obsproject/obs-studio/blob/0043697fc59d791b95b3495dfa1fe180b395966f/plugins/win-capture/graphics-hook/d3d12-capture.cpp>
- <https://github.com/obsproject/obs-studio/blob/0043697fc59d791b95b3495dfa1fe180b395966f/plugins/win-capture/inject-helper/inject-helper.c>

### MangoHud

MangoHud's useful mature pattern is the Vulkan implicit-layer model: maintain
explicit instance/device/queue/command-buffer/swap-chain maps, create resources
per swap-chain image, and destroy them with the corresponding Vulkan object.
Its 32-bit and 64-bit layer manifests are separate artifacts. The OpenGL path
uses preload/symbol interposition. Its current `src/win` D3D11/D3D12 kiero
hooks are an early Present-only telemetry path: they do not yet provide the
rendering, resize/device-loss, state-restore and teardown evidence GameHub
requires.

That is a Linux roadmap, not a Windows injection solution. A future GameHub
Linux compositor should prefer an explicit Vulkan layer and separately built
32/64-bit manifests over process-memory injection. It must still integrate the
same generation, input and release-fence authorization used on Windows.

References:

- [Vulkan layer](https://github.com/flightlessmango/MangoHud/blob/251beb14657255ab5f8136c607eb6abee3b4aec7/src/vulkan.cpp)
- [GLX interposition](https://github.com/flightlessmango/MangoHud/blob/251beb14657255ab5f8136c607eb6abee3b4aec7/src/gl/inject_glx.cpp)
- [Windows entry](https://github.com/flightlessmango/MangoHud/blob/251beb14657255ab5f8136c607eb6abee3b4aec7/src/win/main.cpp)
- [Windows D3D shared path](https://github.com/flightlessmango/MangoHud/blob/251beb14657255ab5f8136c607eb6abee3b4aec7/src/win/d3d_shared.cpp)

## What is not a production foundation

Universal Dear ImGui Hook is useful as a broad API checklist, but its current
D3D11 example polls global key state inside the render hook and directly binds
its render target without even hudhook's partial host-state backup. Its D3D12
path can wait up to seconds on the Present thread. These are not acceptable
latency, input ownership or state-preservation guarantees for GameHub.

References:

- [D3D11 path](https://github.com/Sh0ckFR/Universal-Dear-ImGui-Hook/blob/a3427acf47a469027da3ccf01f27f782170f82ec/d3d11hook.cpp)
- [D3D12 path](https://github.com/Sh0ckFR/Universal-Dear-ImGui-Hook/blob/a3427acf47a469027da3ccf01f27f782170f82ec/d3d12hook.cpp)
- [Vulkan path](https://github.com/Sh0ckFR/Universal-Dear-ImGui-Hook/blob/a3427acf47a469027da3ccf01f27f782170f82ec/vulkanhook.cpp)
- [Lifecycle/teardown](https://github.com/Sh0ckFR/Universal-Dear-ImGui-Hook/blob/a3427acf47a469027da3ccf01f27f782170f82ec/dllmain.cpp)

## GameHub implementation boundary

An in-process compositor may be evaluated only as a QA backend behind the
supervised pre-entry path. It must not replace the external overlay until all
of the following are proven in deterministic fixtures:

1. The exact pinned process identity and input-capability generation authorize
   the render generation; either side invalidating hides the overlay first.
2. The target's real swap-chain/device/queue identity is stable and every
   observed render API is classified.
3. Every D3D11 state category the overlay mutates is captured and restored,
   with independent getter-visible evidence. Hidden D3D11.1 ranges, counters
   or topology that cannot be observed and preserved remain unsupported.
4. D3D12/Vulkan resource transitions, command queues, fences and per-frame
   allocators never reuse an in-flight host resource.
5. Resize, fullscreen transition, device removal, swap-chain destruction,
   competing swap chains and DLL detach cannot leave a stale pointer or block
   the Present thread.
6. The callback performs no filesystem/network work, unbounded wait, blocking
   mutex acquisition, process-wide key polling, or per-frame heap allocation.
7. x86 and x64 payloads are independently built, signed, hash-pinned and chosen
   from the trusted native process architecture—not caller input.
8. Anti-cheat/protected/unknown render stacks remain a hard refusal; there is
   no late-injection fallback.

Rendering remains an independent blocker for Spider-Man 2 and Khazan; no
synthetic fixture or policy evaluator is real-title compatibility evidence.
Their sessions also require complete HID/controller-middleware coverage,
DirectInput/WGI proof as applicable, exact child propagation, foreground and
elevation handling before any interactive in-game overlay can be claimed.
