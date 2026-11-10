import { test } from "node:test";
import assert from "node:assert/strict";
import { toBackup, fromBackup, BACKUP_VERSION } from "../../extension/lib/backup.js";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const SVG = "data:image/svg+xml;base64,PHN2Zy8+";
const plex = { id: "plex", name: "Plex", url: "https://app.plex.tv/", icon: PNG, plate: false };
const immich = { id: "immich", name: "Immich", url: "http://nas.local:2283/", icon: SVG, plate: true };
const letter = { id: "news", name: "News", url: "https://news.example/", icon: null, plate: false };

const backup = (sites, extra = {}) => JSON.stringify({ format: "siderail", version: BACKUP_VERSION, sites, ...extra });

test("a backup reads back as the same sites, icons included", () => {
  const sites = [plex, immich, letter];
  assert.deepEqual(fromBackup(toBackup(sites)), sites);
});

test("missing ids get new ones; names are trimmed; plate must be true to count", () => {
  const [site] = fromBackup(backup([{ name: " Plex ", url: "https://app.plex.tv", plate: "yes" }]));
  assert.match(site.id, /^[0-9a-f-]{36}$/);
  assert.equal(site.name, "Plex");
  assert.equal(site.url, "https://app.plex.tv/");
  assert.equal(site.icon, null);
  assert.equal(site.plate, false);
});

test("files that aren't backups are refused", () => {
  for (const text of ["not json", "null", "[]", JSON.stringify({ sites: [] }), JSON.stringify({ format: "siderail" })]) {
    assert.throws(() => fromBackup(text), /isn't a Siderail backup/, text);
  }
});

test("backups from a newer version are refused", () => {
  assert.throws(() => fromBackup(backup([], { version: BACKUP_VERSION + 1 })), /newer Siderail/);
  assert.throws(() => fromBackup(backup([], { version: "2" })), /newer Siderail/);
});

test("sites that the sidebar couldn't safely show are refused, naming which", () => {
  const cases = [
    [{ ...plex, name: "  " }, /Site 2 .* no name/],
    [{ ...plex, url: "javascript:alert(1)" }, /Site 2 .* isn't a web address/],
    [{ ...plex, url: "nope" }, /isn't a web address/],
    [{ ...plex, icon: "data:text/html;base64,PGgxPg==" }, /isn't a PNG or SVG/],
    [{ ...plex, icon: "https://tracker.example/pixel.png" }, /isn't a PNG or SVG/],
    [{ ...plex, icon: 'data:image/svg+xml;utf8,<svg onload="x()"/>' }, /isn't a PNG or SVG/],
    [{ ...plex, icon: 42 }, /isn't a PNG or SVG/],
  ];
  for (const [site, message] of cases) assert.throws(() => fromBackup(backup([letter, site])), message);
});
