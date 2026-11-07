import { test } from "node:test";
import assert from "node:assert/strict";
import { letterFor, colorFor } from "../../extension/lib/letter.js";
import { suggestPlate } from "../../extension/lib/plate.js";

test("letterFor takes the first letter or digit", () => {
  assert.equal(letterFor("netflix"), "N");
  assert.equal(letterFor("  (2) things"), "2");
  assert.equal(letterFor("Ñandú"), "Ñ");
  assert.equal(letterFor("!!!"), "?");
});

test("colorFor is stable per name", () => {
  assert.equal(colorFor("Plex"), colorFor("Plex"));
  assert.notEqual(colorFor("Plex"), colorFor("Netflix"));
});

// A 10x10 icon: `fill` of the pixels opaque in the given colour, rest transparent.
function icon(fill, [r, g, b]) {
  const px = new Uint8ClampedArray(100 * 4);
  for (let i = 0; i < Math.round(fill * 100); i++) px.set([r, g, b, 255], i * 4);
  return px;
}

test("suggestPlate flags dark logos on transparency", () => {
  assert.equal(suggestPlate(icon(0.4, [10, 10, 10])), true);
});

test("suggestPlate leaves bright logos and full-square icons alone", () => {
  assert.equal(suggestPlate(icon(0.4, [230, 30, 30])), false);
  assert.equal(suggestPlate(icon(1, [10, 10, 10])), false);
  assert.equal(suggestPlate(icon(0, [0, 0, 0])), false);
});

test("suggestPlate treats saturated colours as visible, not dark", () => {
  assert.equal(suggestPlate(icon(0.4, [255, 0, 0])), false);
  assert.equal(suggestPlate(icon(0.4, [0, 0, 200])), false);
});

test("suggestPlate treats rounded-square icons as having their own background", () => {
  assert.equal(suggestPlate(icon(0.86, [10, 10, 10])), false);
});
