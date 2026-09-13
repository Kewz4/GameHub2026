import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";

import { GAME_HERO_DESCRIPTION_TOGGLE_ID } from "../navigation";
import {
  createHeroDescriptionState,
  getHeroActionUpFocusId,
  getHeroDescriptionPresentation,
  recordHeroDescriptionOverflow,
  resetHeroDescriptionState,
  sanitizeHeroDescriptionText,
  toggleHeroDescription,
} from "./hero-description-state";

describe("Big Picture hero description presentation", () => {
  it("starts collapsed and only exposes a toggle after measured overflow", () => {
    const initial = createHeroDescriptionState();
    assert.deepEqual(initial, { canExpand: false, isExpanded: false });

    const measured = recordHeroDescriptionOverflow(initial, true);
    assert.deepEqual(getHeroDescriptionPresentation(measured), {
      canExpand: true,
      isExpanded: false,
      toggleLabel: "Read more",
      toggleFocusId: GAME_HERO_DESCRIPTION_TOGGLE_ID,
    });
  });

  it("expands and collapses while returning controller focus to one stable id", () => {
    const collapsed = recordHeroDescriptionOverflow(
      createHeroDescriptionState(),
      true
    );
    const expanded = toggleHeroDescription(collapsed);

    assert.equal(expanded.state.isExpanded, true);
    assert.equal(expanded.restoreFocusId, GAME_HERO_DESCRIPTION_TOGGLE_ID);
    assert.equal(
      getHeroDescriptionPresentation(expanded.state).toggleLabel,
      "Show less"
    );

    const collapsedAgain = toggleHeroDescription(expanded.state);
    assert.equal(collapsedAgain.state.isExpanded, false);
    assert.equal(
      collapsedAgain.restoreFocusId,
      GAME_HERO_DESCRIPTION_TOGGLE_ID
    );
  });

  it("resets expansion for a newly loaded game and gates action-row focus", () => {
    assert.deepEqual(resetHeroDescriptionState(), {
      canExpand: false,
      isExpanded: false,
    });
    assert.equal(getHeroActionUpFocusId(false), null);
    assert.equal(getHeroActionUpFocusId(true), GAME_HERO_DESCRIPTION_TOGGLE_ID);
  });

  it("converts sanitized markup to inert plain text for the hero", () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const previousDocument = globalThis.document;
    const previousNodeFilter = globalThis.NodeFilter;
    Object.assign(globalThis, {
      document: dom.window.document,
      NodeFilter: dom.window.NodeFilter,
    });

    try {
      const result = sanitizeHeroDescriptionText(
        '<p>Safe <strong>story</strong></p><script>alert("x")</script><img src="x" onerror="alert(1)">'
      );

      assert.equal(result, "Safe story");
      assert.doesNotMatch(result, /<|alert|onerror/i);
    } finally {
      Object.assign(globalThis, {
        document: previousDocument,
        NodeFilter: previousNodeFilter,
      });
      dom.window.close();
    }
  });
});
