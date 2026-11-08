// The saved list is an array of { id, name, url, icon, plate }:
//   icon  - a PNG data: URL, or null to show a letter tile
//   plate - draw a light square behind the icon (for dark logos)
// These helpers never mutate; each returns a new array.

export function makeSite({ id, name, url, icon = null, plate = false }) {
  return { id: id ?? crypto.randomUUID(), name: name.trim(), url, icon, plate };
}

// Replace the site with the same id, or append it.
export function upsert(sites, site) {
  const i = sites.findIndex((s) => s.id === site.id);
  return i === -1 ? [...sites, site] : sites.with(i, site);
}

export function remove(sites, id) {
  return sites.filter((s) => s.id !== id);
}

// Move a site up (delta -1) or down (+1); out-of-range moves do nothing.
export function move(sites, id, delta) {
  const from = sites.findIndex((s) => s.id === id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= sites.length) return sites;
  const out = [...sites];
  [out[from], out[to]] = [out[to], out[from]];
  return out;
}

// Move a site to index `to`, shifting the others; out-of-range moves do nothing.
export function moveTo(sites, id, to) {
  const from = sites.findIndex((s) => s.id === id);
  if (from === -1 || to < 0 || to >= sites.length) return sites;
  return sites.toSpliced(from, 1).toSpliced(to, 0, sites[from]);
}
