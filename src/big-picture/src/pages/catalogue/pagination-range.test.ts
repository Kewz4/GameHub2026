import { test } from "node:test";
import assert from "node:assert/strict";
import { getVisibleCataloguePageRange } from "./pagination-range";

test("a three-page catalogue never registers the final page twice", () => {
  const range = getVisibleCataloguePageRange(1, 3);
  assert.equal(range.end, 3);
  assert.equal(range.showTrailingJump, false);
});

test("all catalogue page windows keep unique, bounded focus targets", () => {
  for (let count = 2; count <= 30; count++)
    for (let page = 1; page <= count; page++) {
      const range = getVisibleCataloguePageRange(page, count);
      const pages = Array.from(
        { length: range.end - range.start + 1 },
        (_, i) => range.start + i
      );
      if (range.isLastThree && range.start > 1) pages.unshift(1);
      if (range.showTrailingJump) pages.push(count);
      assert.equal(new Set(pages).size, pages.length, `page ${page}/${count}`);
      assert.ok(pages.includes(page));
      assert.ok(pages.every((value) => value >= 1 && value <= count));
    }
});
