import assert from "node:assert/strict";
import test from "node:test";
import {
  isExophaseAuthPageUrl,
  resolveExophaseProbeState,
} from "./exophase-auth-state";

test("distinguishes explicit sign-in redirects from transient account pages", () => {
  assert.equal(
    isExophaseAuthPageUrl("https://www.exophase.com/login?next=/account"),
    true
  );
  assert.equal(
    isExophaseAuthPageUrl("https://www.exophase.com/account"),
    false
  );
  assert.equal(
    isExophaseAuthPageUrl(
      "https://www.exophase.com/cdn-cgi/challenge-platform/h/g/orchestrate"
    ),
    false
  );
});

test("keeps a saved Exophase account when a probe is inconclusive", () => {
  assert.deepEqual(
    resolveExophaseProbeState({
      cachedUsername: "SavedUser",
      detectedUsername: null,
      definitivelySignedOut: false,
    }),
    {
      authenticated: true,
      username: "SavedUser",
      verification: "cached",
    }
  );
});

test("uses a freshly verified username", () => {
  assert.deepEqual(
    resolveExophaseProbeState({
      cachedUsername: "OldUser",
      detectedUsername: "VerifiedUser",
      definitivelySignedOut: false,
    }),
    {
      authenticated: true,
      username: "VerifiedUser",
      verification: "verified",
    }
  );
});

test("reports signed out only after authoritative evidence", () => {
  assert.deepEqual(
    resolveExophaseProbeState({
      cachedUsername: "SavedUser",
      detectedUsername: null,
      definitivelySignedOut: true,
    }),
    {
      authenticated: false,
      username: null,
      verification: "signed-out",
    }
  );
});
