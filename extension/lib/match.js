// Which saved site an address belongs to: the same host (ignoring a leading
// "www.") and port, under the site's path. The longest path wins, so a site
// saved as example.com/docs/ beats one saved as example.com/.
export function matchSite(sites, url) {
  const u = parse(url);
  if (!u) return null;
  let best = null;
  let bestLen = -1;
  for (const site of sites) {
    const s = parse(site.url);
    if (!s || hostKey(s) !== hostKey(u)) continue;
    const prefix = withSlash(s.pathname);
    if (!withSlash(u.pathname).startsWith(prefix)) continue;
    if (prefix.length > bestLen) {
      best = site.id;
      bestLen = prefix.length;
    }
  }
  return best;
}

function parse(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

const hostKey = (u) => `${u.hostname.replace(/^www\./, "")}:${u.port}`;
const withSlash = (p) => (p.endsWith("/") ? p : p + "/");
