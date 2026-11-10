// Saving the list to a file and reading it back. Icons are data: URLs, so
// the file carries them and an import needs no network.
import { makeSite } from "./sites.js";

const FORMAT = "siderail";
export const BACKUP_VERSION = 1;

export function toBackup(sites) {
  return JSON.stringify({ format: FORMAT, version: BACKUP_VERSION, sites }, null, 2);
}

// The sites in a backup file's text. Throws an Error whose message can be
// shown as is when the file isn't a backup or a site in it is unusable.
// Anything the sidebar would draw is checked, since the file may have been
// edited by hand or come from someone else.
export function fromBackup(text) {
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // reported below
  }
  if (data?.format !== FORMAT || !Array.isArray(data.sites)) throw new Error("That file isn't a Siderail backup.");
  if (!(data.version <= BACKUP_VERSION)) throw new Error("That backup is from a newer Siderail. Update it, then import again.");
  return data.sites.map(checkSite);
}

const ICON = /^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;

function checkSite(site, i) {
  const bad = (what) => new Error(`Site ${i + 1} in that file has ${what}.`);
  if (typeof site?.name !== "string" || !site.name.trim()) throw bad("no name");
  let url = null;
  try {
    url = new URL(site.url);
  } catch {
    // reported below
  }
  if (!url || !/^https?:$/.test(url.protocol)) throw bad("an address that isn't a web address");
  if (site.icon != null && !ICON.test(site.icon)) throw bad("an icon that isn't a PNG or SVG image");
  return makeSite({
    id: typeof site.id === "string" && site.id ? site.id : undefined,
    name: site.name,
    url: url.href,
    icon: site.icon ?? null,
    plate: site.plate === true,
  });
}
