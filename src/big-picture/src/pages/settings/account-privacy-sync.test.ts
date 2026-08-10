import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getSettingsBackupFeedback,
  getSettingsRestoreFeedback,
} from "./account-privacy-sync";

describe("Big Picture account settings sync feedback", () => {
  it("reports a successful R2 settings backup without subscription copy", () => {
    const feedback = getSettingsBackupFeedback({ ok: true });

    assert.equal(feedback.success, true);
    assert.match(`${feedback.title} ${feedback.message}`, /R2/);
    assert.doesNotMatch(
      `${feedback.title} ${feedback.message}`,
      /subscription|checkout|plan/i
    );
  });

  it("reports failed and rejected backups as failures", () => {
    assert.equal(getSettingsBackupFeedback({ ok: false }).success, false);
    assert.equal(getSettingsBackupFeedback(null).success, false);
  });

  it("distinguishes a restored backup from a missing backup", () => {
    const restored = getSettingsRestoreFeedback({
      restored: true,
      updatedAt: "2026-08-09T12:00:00.000Z",
    });
    const missing = getSettingsRestoreFeedback({ restored: false });

    assert.equal(restored.success, true);
    assert.match(restored.message, /restored and applied/i);
    assert.equal(missing.success, false);
    assert.match(missing.message, /no R2 settings backup/i);
  });
});
