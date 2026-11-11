// Searching dashboard-icons (github.com/homarr-labs/dashboard-icons), a
// collection of icons for self-hosted and popular apps, by name.
//
// Its metadata.json lists every icon by name, with the format it was drawn
// in, other names it goes by and its light and dark variants. The whole list
// is downloaded once and searched here, so what's typed isn't sent anywhere.

// Lowercase letters and digits only: "Home Assistant", "home-assistant" and
// "homeassistant" are the same.
export const normalize = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// metadata.json -> [{ name, format, aliases, variants }]. variants are the
// file names to offer, the icon itself first.
export function indexFrom(metadata) {
  return Object.entries(metadata).map(([name, m]) => ({
    name,
    format: m.base === "svg" ? "svg" : "png",
    aliases: m.aliases ?? [],
    variants: [...new Set([name, ...Object.values(m.colors ?? {}).filter(Boolean)])],
  }));
}

// Best first: the exact name, then names that start with the query, then ones
// that contain it, then the same for aliases. Aliases come last because many
// are categories ("NAS", "app") rather than other names for the app. Shorter
// names first within each.
export function search(index, query, limit = 24) {
  const q = normalize(query);
  if (!q) return [];
  const rank = (e) => {
    const name = normalize(e.name);
    const aliases = e.aliases.map(normalize);
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (name.includes(q)) return 2;
    if (aliases.includes(q)) return 3;
    if (aliases.some((a) => a.startsWith(q))) return 4;
    if (aliases.some((a) => a.includes(q))) return 5;
    return -1;
  };
  return index
    .map((e) => ({ e, r: rank(e) }))
    .filter(({ r }) => r >= 0)
    .sort((a, b) => a.r - b.r || a.e.name.length - b.e.name.length || a.e.name.localeCompare(b.e.name))
    .slice(0, limit)
    .map(({ e }) => e);
}

// The icon for a site, when its name or the first part of its host is
// exactly an icon's name. Anything looser, aliases included, guesses wrong
// too often: "Inbox" on app.example.com isn't Miro (alias "app").
export function guess(index, { name, url }) {
  let label = "";
  try {
    label = new URL(url).hostname.replace(/^www\./, "").split(".")[0];
  } catch {
    // no host to go by
  }
  for (const q of [normalize(name), normalize(label)]) {
    const hit = q && index.find((e) => normalize(e.name) === q);
    if (hit) return hit;
  }
  return null;
}

// Where to download an icon (or one of its variants), in order to try. Every
// icon has a PNG, even the SVG ones.
export function iconUrls(base, entry, variant = entry.name) {
  const png = `${base}png/${variant}.png`;
  return entry.format === "svg" ? [`${base}svg/${variant}.svg`, png] : [png];
}
