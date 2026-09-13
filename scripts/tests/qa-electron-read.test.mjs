import assert from "node:assert/strict";
import { test } from "node:test";
import { readElectronMainWithRetry } from "../qa-electron-read.mjs";

test("a GC-lost inspector read retries without substituting runtime data", async () => {
  let calls = 0;
  const retries = [];
  const result = await readElectronMainWithRetry(
    async () => {
      if (++calls === 1)
        throw new Error(
          "electronApplication.evaluate: Resulting promise was garbage collected."
        );
      return { platform: "linux", actual: true };
    },
    (attempt) => retries.push(attempt)
  );
  assert.deepEqual(result, { platform: "linux", actual: true });
  assert.deepEqual(retries, [1]);
});

test("the inspector workaround is bounded and never retries an unrelated error", async () => {
  let calls = 0;
  await assert.rejects(
    readElectronMainWithRetry(async () => {
      calls++;
      throw new Error("Resulting promise was garbage collected.");
    }),
    /garbage collected/
  );
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(
    readElectronMainWithRetry(async () => {
      calls++;
      throw new Error("Application crashed");
    }),
    /Application crashed/
  );
  assert.equal(calls, 1);
});
