// Two fake sites on one local server, told apart by host name:
//   127.0.0.1  "Alpha" - a manifest with a 512px icon, a 180px apple touch
//              icon, a tall SVG icon without a viewBox and a 16px favicon (the
//              512px one should win)
//   localhost  "Bravo" - only a 16px favicon (should fall back to a letter)
// plus a deep page on Bravo, and a page on localhost that sends the add-on's
// request (but not the browser's) to a sign-in page on 127.0.0.1.
//
// Two self-hosted apps that dashboard-icons knows: "Jellyfin" (localhost,
// no icons of its own) and "Sonarr" (127.0.0.1, a 180px touch icon). And a
// small copy of dashboard-icons itself, at `dashboardIcons`.
import http from "node:http";
import zlib from "node:zlib";

// A square PNG: a centred square `fill` of the way across in one colour,
// transparent around it.
export function png(size, [r, g, b], { fill = 1 } = {}) {
  const lo = Math.round((size * (1 - fill)) / 2);
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    if (y >= lo && y < size - lo) for (let x = lo; x < size - lo; x++) row.set([r, g, b, 255], 1 + x * 4);
    rows.push(row);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const html = (title, head) => `<!doctype html><html><head><title>${title}</title>${head}</head><body><h1>${title}</h1></body></html>`;

export const SVG_LOGO = '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="100"><ellipse cx="25" cy="50" rx="20" ry="45" fill="#3a7"/></svg>';

// Every icon in this copy of dashboard-icons is a coloured circle, with a
// class to tell them apart.
const circle = (name, fill) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle class="${name}" cx="5" cy="5" r="4" fill="${fill}"/></svg>`;
const DASHBOARD_ICONS = {
  "/dashboard-icons/metadata.json": [
    "application/json",
    JSON.stringify({
      jellyfin: { base: "svg", aliases: [] },
      sonarr: { base: "svg", aliases: [] },
      plex: { base: "svg", aliases: ["media-server"], colors: { dark: "plex", light: "plex-light" } },
      "nzb-get": { base: "png", aliases: ["usenet"] },
      // Listed as SVG, but only its PNG exists.
      kodi: { base: "svg", aliases: [] },
    }),
  ],
  "/dashboard-icons/svg/jellyfin.svg": ["image/svg+xml", circle("jellyfin", "#00a4dc")],
  "/dashboard-icons/svg/sonarr.svg": ["image/svg+xml", circle("sonarr", "#35c5f4")],
  "/dashboard-icons/svg/plex.svg": ["image/svg+xml", circle("plex", "#e5a00d")],
  "/dashboard-icons/svg/plex-light.svg": ["image/svg+xml", circle("plex-light", "#fff")],
  "/dashboard-icons/png/nzb-get.png": ["image/png", png(128, [40, 160, 40])],
  "/dashboard-icons/png/kodi.png": ["image/png", png(96, [20, 140, 220])],
};

const SITES = {
  "127.0.0.1": {
    "/": [
      "text/html",
      html(
        "Inbox (3) - someone@example.com - Alpha",
        '<link rel="manifest" href="/manifest.json"><link rel="apple-touch-icon" href="/touch.png"><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="icon" href="/fav.png" sizes="16x16">',
      ),
    ],
    "/manifest.json": [
      "application/manifest+json",
      JSON.stringify({ short_name: "Alpha", start_url: "/", icons: [{ src: "/icon512.png", sizes: "512x512", type: "image/png" }] }),
    ],
    "/icon512.png": ["image/png", png(512, [230, 60, 60])],
    "/touch.png": ["image/png", png(180, [60, 160, 230])],
    "/fav.png": ["image/png", png(16, [60, 200, 90])],
    "/logo.svg": ["image/svg+xml", SVG_LOGO],
    "/signin": ["text/html", html("Sign in - AuthApp", '<link rel="apple-touch-icon" href="/touch.png">')],
    "/sonarr/": ["text/html", html("Sonarr", '<link rel="apple-touch-icon" href="/touch.png">')],
    ...DASHBOARD_ICONS,
  },
  localhost: {
    "/": ["text/html", html("Bravo", '<link rel="icon" href="/fav.png">')],
    "/fav.png": ["image/png", png(16, [200, 200, 60])],
    "/deep/page": ["text/html", html("Deep page - Bravo", "")],
    "/bounced/": ["text/html", html("Charlie", "")],
    "/jellyfin/": ["text/html", html("Jellyfin", '<link rel="manifest" href="/jellyfin/manifest.json">')],
    "/jellyfin/manifest.json": ["application/manifest+json", JSON.stringify({ name: "Jellyfin", start_url: "/jellyfin/" })],
  },
};

export async function startFixtures() {
  const server = http.createServer((req, res) => {
    const host = req.headers.host.replace(/:\d+$/, "");
    const path = new URL(req.url, "http://x").pathname;
    // Like an app behind single sign-on: the browser's own visit (which asks
    // for HTML) gets the page, the add-on's fetch (which asks for */*) is
    // sent to sign in on the other host.
    if (host === "localhost" && path === "/bounced/" && !req.headers.accept?.includes("text/html")) {
      return res.writeHead(302, { location: `http://127.0.0.1:${server.address().port}/signin` }).end();
    }
    const hit = SITES[host]?.[path];
    if (!hit) return res.writeHead(404).end();
    // Like jsDelivr, which the add-on reads without permission to read sites.
    const cors = path.startsWith("/dashboard-icons/") ? { "access-control-allow-origin": "*" } : {};
    res.writeHead(200, { "content-type": hit[0], ...cors }).end(hit[1]);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    alpha: `http://127.0.0.1:${port}/`,
    bravo: `http://localhost:${port}/`,
    dashboardIcons: `http://127.0.0.1:${port}/dashboard-icons/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
