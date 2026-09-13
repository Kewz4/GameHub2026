# Cached-pointer Detours QA fixture

This is an isolated x64 Windows acceptance fixture. It is not wired to the
GameHub launcher, overlay manager, input hook, packaging, or any production
feature switch.

The synthetic load graph is:

```text
target DLL <- cache dependency DLL <- injected bootstrap DLL
             ^                         (real DetourAttach)
             |
             +-- custom-entry fixture EXE
```

The cache dependency's `DllMain` stores the target function's real code address
and calls it once. Because the injected bootstrap imports the cache dependency,
that initialization necessarily completes before the bootstrap's `DllMain`
can start its Detours transaction. The bootstrap records the pointer identity
and original probe result, applies a real inline `DetourAttach`, and remains
loaded before the fixture EXE's custom entry point.

The fixture calls the already-cached address after entry and requires the hook
counter and transformed value to change. It then calls `DetourDetach` and calls
the exact same address again, requiring the original value and an unchanged
hook counter. An uninjected control proves the transformed value is not a
property of the target itself. A 25-process attach/detach stress follows the two
named injected acceptance cases.

The bootstrap deliberately performs its Detours transaction from `DllMain` to
make the pre-entry ordering property directly observable in this bounded QA
fixture. That means the transaction runs while the Windows loader lock is held.
This is test-only evidence, not a recommendation or proof that complex
production initialization is loader-lock safe. A production bootstrap must use
a separately reviewed initialization design and concurrency/lifecycle proof.

Run the standalone build and all 28 acceptance cases with:

```powershell
node native/overlay-fixtures/cached-pointer/build-and-test.cjs
```

This proves only that pre-entry inline Detours patching can intercept an
ordinary x64 function body address cached before the hook transaction, and that
this synthetic hook can be cleanly restored in a single-threaded fixture. It is
not the XInput cached-pointer or late-attach acceptance gate.

It does **not** prove XInput, DirectInput, Raw Input, HID, Windows.Gaming.Input,
Steam Input, child-process propagation, anti-cheat compatibility, concurrent
unhook safety, or compatibility with Spider-Man, Khazan, or any real game.
