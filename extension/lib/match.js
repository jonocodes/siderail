// Which saved site an address belongs to: the same host (ignoring a leading
// "www.") and port, under the site's path. The longest path wins, so a site
// saved as example.com/docs/ beats one saved as example.com/. When no site's
// path matches but exactly one site is on that host, it's that one: a site
// saved as youtube.com/feed/subscriptions still lights up while watching a
// video.
export function matchSite(sites, url) {
  const u = parse(url);
  if (!u) return null;
  let best = null;
  let bestLen = -1;
  const onHost = [];
  for (const site of sites) {
    const s = parse(site.url);
    if (!s || hostKey(s) !== hostKey(u)) continue;
    onHost.push(site.id);
    const prefix = withSlash(s.pathname);
    if (!withSlash(u.pathname).startsWith(prefix)) continue;
    if (prefix.length > bestLen) {
      best = site.id;
      bestLen = prefix.length;
    }
  }
  return best ?? (onHost.length === 1 ? onHost[0] : null);
}

// Whether two addresses are on the same host and port, ignoring "www.".
export function sameHost(a, b) {
  const [u, v] = [parse(a), parse(b)];
  return !!u && !!v && hostKey(u) === hostKey(v);
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
