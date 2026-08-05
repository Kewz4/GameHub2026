import assert from "node:assert/strict";
import test from "node:test";

import { createSingleRunFinalizer } from "../../src/main/services/emulators/single-run-finalizer.ts";

test("emulator terminal events share exactly one finalization", async () => {
  let runs = 0;
  const finalize = createSingleRunFinalizer(async () => {
    runs += 1;
    await Promise.resolve();
    return "finished";
  });

  const [fromError, fromExit, fromImmediateState] = await Promise.all([
    finalize(),
    finalize(),
    finalize(),
  ]);

  assert.equal(runs, 1);
  assert.equal(fromError, "finished");
  assert.equal(fromExit, "finished");
  assert.equal(fromImmediateState, "finished");
});
