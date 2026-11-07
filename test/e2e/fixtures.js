// Two fake sites on one local server, told apart by host name:
//   127.0.0.1  "Alpha" - a manifest with a 512px icon, a 180px apple touch
//              icon and a 16px favicon (the 512px one should win)
//   localhost  "Bravo" - only a 16px favicon (should fall back to a letter)
import http from "node:http";
import zlib from "node:zlib";

// A solid-colour square PNG.
export function png(size, [r, g, b]) {
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) row.set([r, g, b, 255], 1 + x * 4);
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
    chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(size).fill(row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const html = (title, head) => `<!doctype html><html><head><title>${title}</title>${head}</head><body><h1>${title}</h1></body></html>`;

const SITES = {
  "127.0.0.1": {
    "/": [
      "text/html",
      html(
        "Inbox (3) - someone@example.com - Alpha",
        '<link rel="manifest" href="/manifest.json"><link rel="apple-touch-icon" href="/touch.png"><link rel="icon" href="/fav.png" sizes="16x16">',
      ),
    ],
    "/manifest.json": [
      "application/manifest+json",
      JSON.stringify({ short_name: "Alpha", start_url: "/", icons: [{ src: "/icon512.png", sizes: "512x512", type: "image/png" }] }),
    ],
    "/icon512.png": ["image/png", png(512, [230, 60, 60])],
    "/touch.png": ["image/png", png(180, [60, 160, 230])],
    "/fav.png": ["image/png", png(16, [60, 200, 90])],
  },
  localhost: {
    "/": ["text/html", html("Bravo", '<link rel="icon" href="/fav.png">')],
    "/fav.png": ["image/png", png(16, [200, 200, 60])],
  },
};

export async function startFixtures() {
  const server = http.createServer((req, res) => {
    const host = req.headers.host.replace(/:\d+$/, "");
    const hit = SITES[host]?.[new URL(req.url, "http://x").pathname];
    if (!hit) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": hit[0] }).end(hit[1]);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    alpha: `http://127.0.0.1:${port}/`,
    bravo: `http://localhost:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
