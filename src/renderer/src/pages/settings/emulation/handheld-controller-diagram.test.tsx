import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import {
  HandheldControllerDiagram,
  type HandheldDiagramKind,
} from "./handheld-controller-diagram";
import { layoutFor } from "./controller-layouts";

test("every new controller model renders its own mapped, reactive controls", () => {
  for (const kind of [
    "wiiu-gamepad",
    "wiiu-pro",
    "classic",
    "3ds",
    "ds",
    "psp",
  ] as HandheldDiagramKind[]) {
    const markup = renderToStaticMarkup(
      createElement(HandheldControllerDiagram, {
        kind,
        active: { a: true },
        stickDeflection: [0.5, -0.5, 0, 0],
      })
    );
    const document = new JSDOM(markup).window.document;
    const a = document.querySelector('[data-controller-control="a"]');
    assert.equal(a?.getAttribute("aria-pressed"), "true", kind);
    assert.equal(
      a?.querySelector("text")?.textContent,
      kind === "psp" ? "×" : "A",
      kind
    );
    assert.notEqual(
      a?.querySelector("circle")?.getAttribute("fill"),
      document
        .querySelector('[data-controller-control="b"] circle')
        ?.getAttribute("fill")
    );
    assert.ok(document.querySelector('[data-controller-control="up"]'));
    assert.equal(
      document.querySelectorAll('[data-controller-control="a"]').length,
      1
    );
  }
});

test("emulator selection does not silently substitute a Switch controller", () => {
  assert.equal(layoutFor("azahar", null).diagram, "3ds");
  assert.equal(layoutFor("ppsspp", null).diagram, "psp");
  assert.equal(layoutFor("cemu", null).diagram, "wiiu-gamepad");
  assert.equal(layoutFor("cemu", "wiiu_classic").diagram, "classic");
  assert.equal(layoutFor("raproject64", null).diagram, "n64");
  assert.equal(layoutFor("ravba", null).diagram, "gba");
  assert.equal(layoutFor("dolphin", null).diagram, "gamecube");
  assert.ok(
    !layoutFor("ppsspp", null).controls.some(
      ({ control }) => control.startsWith("rstick") || control === "r3"
    )
  );
});
