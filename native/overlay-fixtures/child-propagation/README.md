# Child-propagation Detours QA fixture

This directory is an isolated x64 Windows acceptance fixture for a synthetic
launcher-to-renderer chain. It is not wired to GameHub, the production overlay,
the input hook, packaging, any feature switch, or any real game. In particular,
it does **not** establish compatibility with Khazan.

The synthetic parent imports a dependency DLL whose `DllMain` caches the real
body addresses of `CreateProcessW` and `CreateProcessA`. The injected parent
bootstrap verifies those addresses before applying real inline Detours hooks.
An exact adjacent renderer executable is pinned by canonical handle path and
volume/file ID before the hook is active. After creation, the bootstrap verifies
the returned process handle, PID, creation `FILETIME`, canonical image path, and
file identity before applying an exact adjacent child marker while the child is
suspended.

The child marker publishes a PID + creation-time-bound handshake from its loader
phase and waits for either parent release or the identity-verified parent process
to die. The parent observes the handshake before application entry. For a caller
that requested `CREATE_SUSPENDED`, it re-suspends the marker-blocked primary
thread before release so the returned handle retains exactly one caller-owned
suspend count; otherwise it resumes exactly once. Unknown and ambiguous targets
run uninstrumented and latch the overlay capability unavailable. A failed or
timed-out exact handshake terminates and waits for only the exact never-started
child before returning failure with cleared handles.

The fixture proves that the hook forwards the same argument pointers, handle
inheritance value, and flags it received, except for OR-ing the internal
`CREATE_SUSPENDED` bit. The renderer independently observes its Unicode/ANSI
argument token, environment token, and current directory. This is not a complete
semantic proof for security descriptors, inherited handles, mitigation policy,
or every extended startup attribute; those remain a later synthetic gate.

The predictable local object names and default DACL are acceptable only in this
single-user synthetic fixture. A production protocol needs a cryptographically
random authenticated session identifier plus an explicit user-only ACL. The
test-only loader-lock handshake is deliberately minimal and is not a production
initialization design.

Run the pinned-vendor verification, `/W4 /WX` build, import checks, controls,
failure cases, parent-death cleanup, and 25-process stress with:

```powershell
node native/overlay-fixtures/child-propagation/build-and-test.cjs
```

This proves only bounded `CreateProcessW`/`CreateProcessA` pre-entry child
propagation and suspension accounting for these synthetic x64 fixtures. It does
not prove other child-creation APIs, XInput, DirectInput, Raw
Input, HID, Windows.Gaming.Input, Steam Input, anti-cheat compatibility, arbitrary
process trees, cross-bitness, elevation boundaries, concurrent detachment, or
compatibility with Spider-Man, Khazan, or any other real game.

A cleanup wait that times out is a fatal/unknown state. It is never treated as
a safe normal-launch fallback, because the fixture cannot prove the child has
remained before entry once cleanup identity or liveness is uncertain.

This fixture does not yet place the exact child in a private kill-on-close job.
The bounded abort path verifies termination by waiting for the process handle;
if that wait is not signaled the gate fails fatally and closes no production
claim. Job containment remains mandatory before adapting this pattern beyond QA.
