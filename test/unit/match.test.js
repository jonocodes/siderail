import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSite } from "../../extension/lib/match.js";

const sites = [
  { id: "plex", url: "https://app.plex.tv/" },
  { id: "docs", url: "https://example.com/docs/" },
  { id: "root", url: "https://example.com/" },
  { id: "local", url: "http://localhost:2283/" },
];

test("matches a page deep inside a site", () => {
  assert.equal(matchSite(sites, "https://app.plex.tv/desktop/#!/media/1"), "plex");
});

test("the longest matching path wins", () => {
  assert.equal(matchSite(sites, "https://example.com/docs/intro"), "docs");
  assert.equal(matchSite(sites, "https://example.com/blog"), "root");
});

test("a path prefix must end on a segment boundary", () => {
  assert.equal(matchSite(sites, "https://example.com/docsearch"), "root");
});

test("ignores www. and the scheme, but not the port", () => {
  assert.equal(matchSite(sites, "http://www.example.com/docs"), "docs");
  assert.equal(matchSite(sites, "http://localhost:2283/photos"), "local");
  assert.equal(matchSite(sites, "http://localhost:8080/"), null);
});

test("no match for other sites or non-web pages", () => {
  assert.equal(matchSite(sites, "https://netflix.com/"), null);
  assert.equal(matchSite(sites, "about:newtab"), null);
  assert.equal(matchSite(sites, "not a url"), null);
});
