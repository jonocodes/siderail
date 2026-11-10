// The saved list in storage.local, shared by the sidebar and the options
// page. The list's format is described in lib/sites.js.

// Saved alongside the list so a later change to its format can tell old
// lists apart and migrate them.
const STORAGE_VERSION = 1;

export async function loadSites() {
  return (await browser.storage.local.get({ sites: [] })).sites;
}

export function saveSites(sites) {
  return browser.storage.local.set({ version: STORAGE_VERSION, sites });
}
