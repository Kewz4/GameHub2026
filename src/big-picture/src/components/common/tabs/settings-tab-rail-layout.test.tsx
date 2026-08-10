import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";

import { SettingsTabRailLayout } from "./settings-tab-rail-layout";

describe("Big Picture Settings tab rail structure", () => {
  it("keeps LB and RB outside the horizontal scroll viewport", () => {
    const markup = renderToStaticMarkup(
      <SettingsTabRailLayout
        beforeTabs={<span>LB</span>}
        afterTabs={<span>RB</span>}
      >
        <div data-tabs-scroll-viewport>
          <button type="button">Account and Privacy</button>
        </div>
      </SettingsTabRailLayout>
    );
    const document = new JSDOM(markup).window.document;
    const rail = document.querySelector("[data-tabs-settings-rail]");
    const viewport = document.querySelector("[data-tabs-scroll-viewport]");

    assert.ok(rail);
    assert.ok(viewport);
    assert.deepEqual(
      [...rail.children].map(
        (child) =>
          child.getAttribute("data-tabs-rail-control") ??
          (child.hasAttribute("data-tabs-scroll-viewport")
            ? "viewport"
            : "unknown")
      ),
      ["before", "viewport", "after"]
    );
    assert.equal(viewport.querySelector("[data-tabs-rail-control]"), null);
  });

  it("does not reserve empty control wrappers", () => {
    const markup = renderToStaticMarkup(
      <SettingsTabRailLayout>
        <div data-tabs-scroll-viewport />
      </SettingsTabRailLayout>
    );
    const document = new JSDOM(markup).window.document;

    assert.equal(
      document.querySelectorAll("[data-tabs-rail-control]").length,
      0
    );
  });
});
