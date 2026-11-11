import { test } from "node:test";
import assert from "node:assert/strict";
import { indexFrom, search, guess, iconUrls, normalize } from "../../extension/lib/dashboard.js";

// A slice of dashboard-icons' metadata.json, trimmed to the fields we use.
const METADATA = {
  plex: { base: "svg", aliases: [], colors: { dark: "plex", light: "plex-light" } },
  "plex-alt": { base: "svg", aliases: [] },
  plexrequests: { base: "png", aliases: [] },
  jellyfin: { base: "svg", aliases: [] },
  jellyseerr: { base: "png", aliases: ["overseerr-jellyfin"] },
  "home-assistant": { base: "svg", aliases: ["hass", "homeassistant"] },
  gmail: { base: "svg", aliases: ["google-mail", "webmail-service"] },
  // Aliases are often categories rather than other names for the app.
  miro: { base: "svg", aliases: ["whiteboard", "app"] },
  "app-store": { base: "svg", aliases: [] },
  google: { base: "svg", aliases: [] },
  "nzb-get": { base: "png", aliases: [] },
};
const index = indexFrom(METADATA);
const names = (entries) => entries.map((e) => e.name);

test("normalize ignores case, spaces and punctuation", () => {
  assert.equal(normalize(" Home-Assistant "), "homeassistant");
  assert.equal(normalize("NZB Get"), "nzbget");
  assert.equal(normalize("home_assistant.io"), "homeassistantio");
});

test("indexFrom keeps the format, aliases and variants", () => {
  const plex = index.find((e) => e.name === "plex");
  assert.deepEqual(plex, { name: "plex", format: "svg", aliases: [], variants: ["plex", "plex-light"] });
  assert.deepEqual(index.find((e) => e.name === "jellyfin").variants, ["jellyfin"]);
  // Tolerates missing fields.
  assert.deepEqual(indexFrom({ x: {} }), [{ name: "x", format: "png", aliases: [], variants: ["x"] }]);
});

test("indexFrom skips variants missing from the metadata or repeated", () => {
  const [e] = indexFrom({ a: { base: "svg", colors: { dark: "a-dark", light: "a-dark", other: "" } } });
  assert.deepEqual(e.variants, ["a", "a-dark"]);
});

test("search ranks the exact name, then names starting with or containing it", () => {
  assert.deepEqual(names(search(index, "plex")), ["plex", "plex-alt", "plexrequests"]);
  assert.deepEqual(names(search(index, "jelly")), ["jellyfin", "jellyseerr"]);
  assert.deepEqual(names(search(index, "seerr")), ["jellyseerr"]);
});

test("search finds aliases too, after every name", () => {
  assert.deepEqual(names(search(index, "hass")), ["home-assistant"]);
  assert.deepEqual(names(search(index, "overseerr")), ["jellyseerr"]);
  assert.deepEqual(names(search(index, "app")), ["app-store", "miro"]);
});

test("search ignores case and punctuation", () => {
  for (const q of ["home assistant", "HomeAssistant", "home-assistant", "Home_Assistant"])
    assert.deepEqual(names(search(index, q)), ["home-assistant"], q);
  assert.deepEqual(names(search(index, "nzbget")), ["nzb-get"]);
});

test("search returns nothing for an empty query, and respects the limit", () => {
  assert.deepEqual(search(index, "  "), []);
  assert.deepEqual(search(index, "-"), []);
  assert.deepEqual(names(search(index, "p", 2)), ["plex", "plex-alt"]);
});

test("guess matches an icon's name exactly", () => {
  assert.equal(guess(index, { name: "Jellyfin", url: "http://192.168.1.5:8096/" })?.name, "jellyfin");
  assert.equal(guess(index, { name: "Home Assistant", url: "http://ha.lan:8123/" })?.name, "home-assistant");
});

test("guess falls back to the first label of the host", () => {
  assert.equal(guess(index, { name: "My media", url: "https://plex.example.com/web/" })?.name, "plex");
  assert.equal(guess(index, { name: "Inbox", url: "https://www.gmail.com/" })?.name, "gmail");
});

test("guess only returns confident matches", () => {
  // Prefixes and substrings aren't enough.
  assert.equal(guess(index, { name: "Jelly", url: "http://192.168.1.5/" }), null);
  // Only the first host label counts: "mail.google.com" isn't Google.
  assert.equal(guess(index, { name: "Mail", url: "https://mail.google.com/" }), null);
  // Nor are aliases.
  assert.equal(guess(index, { name: "Google Mail", url: "https://x.example/" }), null);
  assert.equal(guess(index, { name: "Inbox", url: "https://app.example.com/" }), null);
  assert.equal(guess(index, { name: "", url: "not a url" }), null);
  assert.equal(guess(index, {}), null);
});

test("iconUrls offers the icon's own format, then PNG", () => {
  const base = "https://cdn.example/icons/";
  const plex = index.find((e) => e.name === "plex");
  assert.deepEqual(iconUrls(base, plex), ["https://cdn.example/icons/svg/plex.svg", "https://cdn.example/icons/png/plex.png"]);
  assert.deepEqual(iconUrls(base, plex, "plex-light"), [
    "https://cdn.example/icons/svg/plex-light.svg",
    "https://cdn.example/icons/png/plex-light.png",
  ]);
  const nzb = index.find((e) => e.name === "nzb-get");
  assert.deepEqual(iconUrls(base, nzb), ["https://cdn.example/icons/png/nzb-get.png"]);
});
