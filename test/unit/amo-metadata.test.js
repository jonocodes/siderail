// The listing text sent to addons.mozilla.org with every version. AMO only
// rejects mistakes here when a release is submitted, so catch them first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const metadata = JSON.parse(await readFile(new URL("../../release/amo-metadata.json", import.meta.url), "utf8"));

// From https://mozilla.github.io/addons-server/topics/api/categories.html and licenses.html.
const CATEGORIES = ["alerts-updates", "appearance", "bookmarks", "download-management", "feeds-news-blogging", "games-entertainment", "language-support", "photos-music-videos", "privacy-security", "search-tools", "shopping", "social-communication", "tabs", "web-development", "other"];
const LICENSES = ["all-rights-reserved", "MPL-2.0", "Apache-2.0", "GPL-2.0-only", "GPL-3.0-only", "LGPL-2.1-only", "LGPL-3.0-only", "AGPL-3.0-only", "MIT", "ISC", "BSD-2-Clause", "Unlicense"];

test("the AMO listing has what a first listed submission requires", () => {
  const summary = metadata.summary["en-US"];
  assert.ok(summary && summary.length <= 250, `summary is ${summary?.length} characters; AMO allows 250`);
  assert.ok(metadata.categories.length > 0 && metadata.categories.every((c) => CATEGORIES.includes(c)), metadata.categories.join());
  assert.ok(LICENSES.includes(metadata.version.license), metadata.version.license);
});

test("release notes are added per release, not kept in the file", () => {
  assert.equal(metadata.version.release_notes, undefined);
});
