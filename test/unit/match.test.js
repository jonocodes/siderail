import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSite, sameHost } from "../../extension/lib/match.js";

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

test("the only site on a host matches pages outside its path", () => {
  const yt = [{ id: "yt", url: "https://www.youtube.com/feed/subscriptions" }];
  assert.equal(matchSite(yt, "https://www.youtube.com/watch?v=x"), "yt");
});

test("with several sites on a host and none on the path, nothing matches", () => {
  const two = [
    { id: "docs", url: "https://example.com/docs/" },
    { id: "blog", url: "https://example.com/blog/" },
  ];
  assert.equal(matchSite(two, "https://example.com/shop"), null);
});

test("sameHost ignores www., the scheme and the path, but not the port", () => {
  assert.equal(sameHost("https://www.netflix.com/browse", "http://netflix.com/"), true);
  assert.equal(sameHost("http://localhost:2283/", "http://localhost:8080/"), false);
  assert.equal(sameHost("https://jf.example/", "https://auth.example/login"), false);
  assert.equal(sameHost("about:blank", "about:blank"), false);
});
