// Finding a large icon for a site. Small favicons look blurry on a big button,
// so only icons at least MIN_ICON pixels across (or SVGs) are offered.

export const MIN_ICON = 64;

// Largest dimension in a sizes attribute ("16x16 180x180" -> 180).
// "any" (scalable) -> Infinity; missing or unparseable -> 0.
export function parseSizes(sizes) {
  if (!sizes) return 0;
  let best = 0;
  for (const token of sizes.toLowerCase().split(/\s+/)) {
    if (token === "any") return Infinity;
    const m = token.match(/^(\d+)x(\d+)$/);
    if (m) best = Math.max(best, Math.min(+m[1], +m[2]));
  }
  return best;
}

const isSvg = (url, type) => type === "image/svg+xml" || /\.svg(\?|#|$)/i.test(url);

function resolve(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

// From <link> tags: [{ rel, href, sizes, type }] as read off the page.
export function candidatesFromLinks(links, baseUrl) {
  const out = [];
  for (const link of links) {
    const rels = (link.rel ?? "").toLowerCase().split(/\s+/);
    const apple = rels.includes("apple-touch-icon") || rels.includes("apple-touch-icon-precomposed");
    if (!apple && !rels.includes("icon")) continue;
    const url = resolve(link.href, baseUrl);
    if (!url) continue;
    out.push({
      url,
      source: apple ? "apple" : "icon",
      // Apple touch icons are 180px unless they say otherwise.
      declared: parseSizes(link.sizes) || (apple ? 180 : 0),
      svg: isSvg(url, link.type),
    });
  }
  return out;
}

// From a web app manifest's icons list. Monochrome icons are single-colour
// silhouettes meant for system UI, so they're skipped.
export function candidatesFromManifest(manifest, manifestUrl) {
  if (!manifest || !Array.isArray(manifest.icons)) return [];
  const out = [];
  for (const icon of manifest.icons) {
    const purposes = (icon.purpose ?? "any").toLowerCase().split(/\s+/);
    if (!purposes.includes("any") && !purposes.includes("maskable")) continue;
    const url = icon.src && resolve(icon.src, manifestUrl);
    if (!url) continue;
    out.push({
      url,
      source: "manifest",
      declared: parseSizes(icon.sizes),
      svg: isSvg(url, icon.type),
      // Maskable icons have wide padding for cropping; prefer plain ones.
      maskable: !purposes.includes("any"),
    });
  }
  return out;
}

// Many sites serve /apple-touch-icon.png without linking it.
export function conventionalCandidates(pageUrl) {
  const url = resolve("/apple-touch-icon.png", pageUrl);
  return url ? [{ url, source: "apple", declared: 180, svg: false }] : [];
}

export function dedupe(candidates) {
  const seen = new Set();
  return candidates.filter((c) => !seen.has(c.url) && seen.add(c.url));
}

const SOURCE_ORDER = { manifest: 0, apple: 1, icon: 2 };

// Measured candidates ({ ...candidate, width, height }) that are big enough,
// best first: biggest, then plain over maskable, then manifest > apple > icon.
export function rankCandidates(measured) {
  const size = (c) => (c.svg ? 512 : Math.min(c.width, c.height));
  return measured
    .filter((c) => c.svg || Math.min(c.width, c.height) >= MIN_ICON)
    .sort(
      (a, b) =>
        size(b) - size(a) ||
        (a.maskable ? 1 : 0) - (b.maskable ? 1 : 0) ||
        SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source],
    );
}
