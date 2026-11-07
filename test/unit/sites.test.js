import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSite, upsert, remove, move } from "../../extension/lib/sites.js";

const a = { id: "a", name: "A", url: "https://a.test/" };
const b = { id: "b", name: "B", url: "https://b.test/" };
const c = { id: "c", name: "C", url: "https://c.test/" };

test("makeSite trims the name and fills defaults", () => {
  const s = makeSite({ name: "  Plex ", url: "https://app.plex.tv/" });
  assert.equal(s.name, "Plex");
  assert.equal(s.icon, null);
  assert.equal(s.plate, false);
  assert.match(s.id, /^[0-9a-f-]{36}$/);
});

test("upsert appends new sites and replaces existing ones in place", () => {
  assert.deepEqual(upsert([a, b], c), [a, b, c]);
  const renamed = { ...a, name: "AA" };
  assert.deepEqual(upsert([a, b], renamed), [renamed, b]);
});

test("remove drops by id", () => {
  assert.deepEqual(remove([a, b, c], "b"), [a, c]);
});

test("move swaps with a neighbour and ignores moves off the ends", () => {
  assert.deepEqual(move([a, b, c], "a", 1), [b, a, c]);
  assert.deepEqual(move([a, b, c], "c", -1), [a, c, b]);
  assert.deepEqual(move([a, b, c], "a", -1), [a, b, c]);
  assert.deepEqual(move([a, b, c], "c", 1), [a, b, c]);
});

test("helpers never mutate their input", () => {
  const list = [a, b, c];
  move(list, "a", 1);
  remove(list, "a");
  upsert(list, { ...a, name: "x" });
  assert.deepEqual(list, [a, b, c]);
});
