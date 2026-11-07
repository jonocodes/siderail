import { test } from "node:test";
import assert from "node:assert/strict";
import { pickName, fromTitle, hostLabel, homeUrl } from "../../extension/lib/names.js";

test("pickName prefers the site's own short names", () => {
  assert.equal(pickName({ manifest: { short_name: "Immich", name: "Immich Photos" }, url: "http://x/" }), "Immich");
  assert.equal(pickName({ appName: "Plex", docTitle: "Home - Plex Web", url: "http://x/" }), "Plex");
  assert.equal(pickName({ siteName: "Wikipedia", url: "http://x/" }), "Wikipedia");
});

test("pickName falls back to the title, then the host", () => {
  assert.equal(pickName({ tabTitle: "Inbox (3) - me@example.com - Gmail", url: "https://mail.google.com/" }), "Gmail");
  assert.equal(pickName({ url: "https://www.netflix.com/browse" }), "Netflix");
});

test("fromTitle takes the last short part, else the first", () => {
  assert.equal(fromTitle("Netflix"), "Netflix");
  assert.equal(fromTitle("Some video | YouTube"), "YouTube");
  assert.equal(fromTitle("Jellyfin — a very long trailing description here"), "Jellyfin");
  assert.equal(fromTitle("A title that is far too long to be a button name"), null);
  assert.equal(fromTitle("  "), null);
});

test("hostLabel capitalises the first host label", () => {
  assert.equal(hostLabel("https://www.example.co.uk/x"), "Example");
  assert.equal(hostLabel("nope"), "Site");
});

test("homeUrl uses a same-site start_url, else the front page", () => {
  const url = "https://app.example.com/deep/page?x=1";
  assert.equal(homeUrl({ url }), "https://app.example.com/");
  assert.equal(
    homeUrl({ url, manifest: { start_url: "/web/?pwa" }, manifestUrl: "https://app.example.com/manifest.json" }),
    "https://app.example.com/web/",
  );
  assert.equal(
    homeUrl({ url, manifest: { start_url: "https://other.example/" }, manifestUrl: "https://app.example.com/m.json" }),
    "https://app.example.com/",
  );
});

test("titles that are just the address are ignored", () => {
  assert.equal(pickName({ tabTitle: "localhost:2283/", url: "http://localhost:2283/" }), "Localhost");
  assert.equal(fromTitle("example.com/page", "https://example.com/page"), null);
  assert.equal(fromTitle("https://example.com/", "https://example.com/"), null);
});

test("homeUrl drops tracking-style query strings from start_url", () => {
  const manifestUrl = "https://open.spotify.com/manifest.json";
  assert.equal(
    homeUrl({ url: "https://open.spotify.com/", manifest: { start_url: "/?utm_source=pwa_install" }, manifestUrl }),
    "https://open.spotify.com/",
  );
  assert.equal(
    homeUrl({ url: "https://jf.example/", manifest: { start_url: "web/index.html#/home" }, manifestUrl: "https://jf.example/web/manifest.json" }),
    "https://jf.example/web/web/index.html#/home",
  );
});
