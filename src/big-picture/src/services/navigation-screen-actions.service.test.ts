import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NAVIGATION_SCREEN_ACTION_PRIORITY,
  NavigationScreenActionsService,
} from "./navigation-screen-actions.service";

describe("Big Picture screen action priority", () => {
  it("keeps an active overlay ahead of a parent page registered later", () => {
    const service = new NavigationScreenActionsService();
    const calls: string[] = [];

    service.createRegistration(
      { press: { b: () => calls.push("overlay") } },
      { priority: NAVIGATION_SCREEN_ACTION_PRIORITY.modal }
    );
    service.createRegistration(
      { press: { b: () => calls.push("page") } },
      { priority: NAVIGATION_SCREEN_ACTION_PRIORITY.page }
    );

    assert.equal(service.triggerAction("press", "b"), true);
    assert.deepEqual(calls, ["overlay"]);
  });

  it("keeps most-recent registration semantics within one priority", () => {
    const service = new NavigationScreenActionsService();
    const calls: string[] = [];

    service.createRegistration({ press: { b: () => calls.push("first") } });
    service.createRegistration({ press: { b: () => calls.push("second") } });

    service.triggerAction("press", "b");
    assert.deepEqual(calls, ["second"]);
  });
});
