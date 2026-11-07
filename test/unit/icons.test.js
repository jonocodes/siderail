import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSizes,
  candidatesFromLinks,
  candidatesFromManifest,
  conventionalCandidates,
  dedupe,
  rankCandidates,
} from "../../extension/lib/icons.js";

test("parseSizes takes the largest size, 'any' as scalable", () => {
  assert.equal(parseSizes("16x16 32x32 180x180"), 180);
  assert.equal(parseSizes("any"), Infinity);
  assert.equal(parseSizes(null), 0);
  assert.equal(parseSizes("big"), 0);
});

test("candidatesFromLinks reads icon and apple-touch-icon links", () => {
  const links = [
    { rel: "shortcut icon", href: "/favicon.ico" },
    { rel: "apple-touch-icon", href: "touch.png" },
    { rel: "icon", href: "/logo.svg", type: "image/svg+xml" },
    { rel: "mask-icon", href: "/mask.svg" },
    { rel: "stylesheet", href: "/x.css" },
  ];
  const got = candidatesFromLinks(links, "https://example.com/app/page");
  assert.deepEqual(got, [
    { url: "https://example.com/favicon.ico", source: "icon", declared: 0, svg: false },
    { url: "https://example.com/app/touch.png", source: "apple", declared: 180, svg: false },
    { url: "https://example.com/logo.svg", source: "icon", declared: 0, svg: true },
  ]);
});

test("candidatesFromManifest resolves against the manifest and skips monochrome", () => {
  const manifest = {
    icons: [
      { src: "icons/512.png", sizes: "512x512", type: "image/png" },
      { src: "icons/mask.png", sizes: "512x512", purpose: "maskable" },
      { src: "icons/mono.png", sizes: "512x512", purpose: "monochrome" },
    ],
  };
  const got = candidatesFromManifest(manifest, "https://example.com/static/manifest.json");
  assert.deepEqual(
    got.map((c) => [c.url, c.declared, c.maskable]),
    [
      ["https://example.com/static/icons/512.png", 512, false],
      ["https://example.com/static/icons/mask.png", 512, true],
    ],
  );
  assert.deepEqual(candidatesFromManifest(null, null), []);
});

test("conventionalCandidates probes /apple-touch-icon.png on the origin", () => {
  assert.equal(conventionalCandidates("https://example.com/a/b")[0].url, "https://example.com/apple-touch-icon.png");
});

test("dedupe keeps the first of each url", () => {
  const got = dedupe([{ url: "x", source: "manifest" }, { url: "x", source: "icon" }, { url: "y" }]);
  assert.deepEqual(got.map((c) => c.source ?? c.url), ["manifest", "y"]);
});

test("rankCandidates drops small icons and orders by size, then kind", () => {
  const measured = [
    { url: "fav", source: "icon", width: 32, height: 32 },
    { url: "touch", source: "apple", width: 180, height: 180 },
    { url: "mask", source: "manifest", width: 512, height: 512, maskable: true },
    { url: "plain", source: "manifest", width: 512, height: 512 },
    { url: "svg", source: "icon", svg: true, width: 0, height: 0 },
    { url: "same-size-icon", source: "icon", width: 180, height: 180 },
  ];
  assert.deepEqual(
    rankCandidates(measured).map((c) => c.url),
    ["plain", "svg", "mask", "touch", "same-size-icon"],
  );
});
