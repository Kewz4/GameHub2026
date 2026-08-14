# GameHub overlay QA supervisor

This is an intentionally non-production Windows spike. It can launch exactly
one adjacent executable named `gamehub-overlay-preentry-fixture.exe`; it cannot
launch an arbitrary game. The requested executable and working directory are
accepted only on standard input and must resolve by file handle to the exact
adjacent fixture and supervisor directory. The DLL path is never accepted from
the caller.

The supervisor accepts newline-delimited JSON over a piped standard input and
writes newline-delimited JSON to standard output. Its only command-line
argument is the fixed protocol selector `--stdio-json-v1`; paths on the command
line and extra arguments are rejected.

Prepare request:

```json
{
  "version": 1,
  "type": "launch",
  "sessionId": "32-or-more-safe-characters",
  "executablePath": "C:\\absolute\\path\\gamehub-overlay-preentry-fixture.exe",
  "args": [
    "--result",
    "C:\\adjacent\\qa-results\\case.json",
    "--",
    "argument to echo"
  ],
  "workingDirectory": "C:\\absolute\\path",
  "decisionTimeoutMs": 20000
}
```

After emitting `type: "suspended"`, the fixture is still suspended. The only
valid second frame is a matching one-shot `commit` or `abort` carrying the
complete identity from that event:

```json
{
  "version": 1,
  "type": "commit",
  "sessionId": "same session",
  "pid": 1234,
  "creationTicks": "full FILETIME",
  "canonicalExecutablePath": "exact path from suspended event"
}
```

EOF, malformed input, identity mismatch, a second launch, or the commit deadline
terminates and waits for the never-started child. A successful commit performs
one `ResumeThread`, closes the thread handle, disarms the private kill job,
emits `resumed`, then closes the remaining private handles and exits.

`decisionTimeoutMs` is a protocol constant, not caller policy: the supervisor
accepts exactly 20,000 ms. This leaves margin around the coordinator's shorter
budgets while retaining a native hard stop. The coordinator's prepared budget
can be consumed twice; its current maximum is therefore 2 × 5,000 ms plus a
4,000 ms commit acknowledgement budget. That 14,000 ms total leaves a strict
6,000 ms margin inside the native deadline.

The marker fixture proves only Detours loader order: the marker DLL is attached
before the fixture EXE's custom entry point. It does not prove cached input
pointer interception, an entry-point `DetourAttach`, or inputhook readiness.

Build and run all synthetic tests on x64 Windows:

```powershell
node scripts/build-overlay-qa-supervisor.cjs
```

The QA build defines `GAMEHUB_OVERLAY_SUPERVISOR_ACCEPTANCE_FAULTS`; only that
acceptance binary recognizes the harness-only variable
`GAMEHUB_QA_CRASH_AFTER_CREATE=1`; this deliberately terminates the supervisor
immediately after target creation to verify that the pre-created armed job was
associated atomically through `PROC_THREAD_ATTRIBUTE_JOB_LIST`. Production
wiring must never define this macro or set this synthetic fault-injection
variable. The build script emits only QA artifacts and does not package them.
