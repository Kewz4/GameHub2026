import assert from "node:assert/strict";
import { it } from "node:test";

import {
  createCloudSavePendingPostExit,
  resolveCloudSavePendingPostExit,
} from "./pending-post-exit-state.js";

it("persists the exact V2 session CAS context before finalization", () => {
  const value = createCloudSavePendingPostExit(
    {
      token: "session-token",
      objectId: "2651280",
      shop: "steam",
      mode: "v2",
      phase: "running",
      environmentId: "windows:game-dir",
      baseRemoteHash: "remote-before-launch",
      uploadAllowed: true,
      createdAt: "2026-08-13T00:00:00.000Z",
    },
    "2026-08-13T00:10:00.000Z"
  );

  assert.deepEqual(resolveCloudSavePendingPostExit(value), value);
  assert.deepEqual(value.session, {
    token: "session-token",
    environmentId: "windows:game-dir",
    baseRemoteHash: "remote-before-launch",
    uploadAllowed: true,
    createdAt: "2026-08-13T00:00:00.000Z",
  });
});
