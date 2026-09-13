/** Native Linux renderer acceptance against an isolated synthetic profile.
 * Does not contain or read user account data, real games, ROMs, or save files. */
if (process.platform !== "linux") {
  throw new Error(
    "Run Linux UI smoke on Linux (for example, xvfb-run -a node scripts/qa-linux-ui-smoke.mjs)."
  );
}
process.env.GAMEHUB_QA_SYNTHETIC_PROFILE = "true";
process.env.GAMEHUB_QA_LINUX_PARITY = "true";
process.env.GAMEHUB_QA_CAPTURE_ALL_VIEWPORTS = "true";
process.env.GAMEHUB_QA_CASE_FILTER =
  "^(linux-parity-|renderer-page-errors|read-only-hydra-fixture-boundary)";
// Explicitly prevent a configured developer endpoint/profile leaking into CI.
delete process.env.GAMEHUB_LIVE_DATA;
process.env.GAMEHUB_API_URL = "http://127.0.0.1:9/api-disabled";
process.env.GAMEHUB_R2_CREDENTIALS_URL = "http://127.0.0.1:9/r2-disabled";
await import("./qa-big-picture-settings-acceptance.mjs");
