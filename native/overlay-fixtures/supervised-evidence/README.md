# Same-target supervised evidence fixture

This Windows-only QA fixture exercises the native seam that the production
overlay does not have yet. The host launches one adjacent target suspended and
atomically places it in a kill-on-close job. An unnamed mapping, three unnamed
events, an owner process handle, and the read end of a one-shot anonymous pipe
are the only handles inherited through `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`.

After `CreateProcessW` returns, the host obtains the exact child identity
(PID, creation `FILETIME`, volume serial, 128-bit file ID, and canonical-path
digest). While the child is still suspended, the host writes a locked bootstrap
containing that identity, random secret/nonce, input and render generations,
topology/absence epochs, required routes/surfaces, and one native commit
sequence. It closes the pipe before the single `ResumeThread` call.

The same target consumes the one-shot bootstrap after resume, independently
matches its own identity, and HMAC-publishes synthetic input/render evidence.
The host accepts it only when identity, generations, topology, commit, timing,
backend, surfaces, and evidence flags match the retained bootstrap. A second
authenticated publication acknowledges release. The host signals a separate
unnamed acceptance event only after authenticating that publication; simulated
game entry is not marked until the target receives that acceptance.

Run:

```powershell
node native/overlay-fixtures/supervised-evidence/build-and-test.cjs
```

The acceptance set covers valid publication plus forged MAC, wrong nonce,
wrong identity, stale generation/topology, wrong commit, pre-resume timing,
late publication, replayed release, refused release, and late release. Every
failure is terminated through the pre-attached job and checked by exact
PID/creation identity.

## Deliberate scope boundary

This proves an executable transport and binding seam, not production overlay
capability. The input/render flags are synthetic; no game API is hooked and no
frame is composited. The current `gamehub-overlay-supervisor` protocol cannot
pass these handles or bootstrap into its Detours-launched fixture, and the
TypeScript evidence source has no native adapter. An injected publisher also
must avoid doing blocking channel work under loader lock. Those three pieces
remain required before this seam can be connected to a real game. This fixture
does not change either production gate.
