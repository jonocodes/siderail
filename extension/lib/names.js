// Suggesting a button name and home address for a site.

const MAX_NAME = 24;

// The best short name from what the site says about itself.
export function pickName({ manifest, appName, siteName, docTitle, tabTitle, url }) {
  for (const name of [manifest?.short_name, manifest?.name, appName, siteName]) {
    const n = name?.trim();
    if (n && n.length <= MAX_NAME) return n;
  }
  for (const title of [docTitle, tabTitle]) {
    const n = fromTitle(title, url);
    if (n) return n;
  }
  return hostLabel(url);
}

// Page titles often look like "Inbox (3) - someone@example.com - Gmail":
// the site's name is usually the last part. Firefox titles untitled pages
// with their address, which is no use as a name.
export function fromTitle(title, url = "") {
  const t = title?.trim();
  if (!t || looksLikeAddress(t, url)) return null;
  const parts = t.split(/\s+[|·•–—-]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const last = parts.at(-1);
    if (last.length <= MAX_NAME) return last;
    if (parts[0].length <= MAX_NAME) return parts[0];
  }
  return t.length <= MAX_NAME ? t : null;
}

function looksLikeAddress(title, url) {
  if (title.includes("://")) return true;
  const bare = url.replace(/^[a-z]+:\/\//i, "");
  return !/\s/.test(title) && bare.startsWith(title.replace(/\/$/, ""));
}

// "https://www.example.co.uk/x" -> "Example"
export function hostLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const label = host.split(".")[0];
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return "Site";
  }
}

// Where the button should go: the manifest's start_url when it's on the same
// site, otherwise the site's front page. start_url query strings are mostly
// install-tracking tags (?utm_source=pwa_install), so they're dropped.
export function homeUrl({ manifest, manifestUrl, url }) {
  const origin = new URL(url).origin;
  if (manifest?.start_url && manifestUrl) {
    try {
      const start = new URL(manifest.start_url, manifestUrl);
      start.search = "";
      if (start.origin === origin) return start.href;
    } catch {
      // fall through to the front page
    }
  }
  return origin + "/";
}
