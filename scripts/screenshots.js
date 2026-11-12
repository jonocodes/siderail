// Regenerates the README screenshots (docs/) and the addons.mozilla.org
// listing's (release/screenshots/) from docs/screenshots.json: the real
// extension in headless Firefox, with one of the scene file's site lists
// added through its own "Add this site" editor. AMO's shots put the sidebar
// in a sketch of a 1280x800 Firefox window, with the page it's driving drawn
// as that site's icon and name.
//
// Firefox sends all its traffic through a local proxy, so a site's page is a
// stand-in served here and nothing reaches the real site. Each stand-in
// offers the scene's icon for that site, so the add-on picks it, squares it
// and decides on a light background exactly as it would for the real site.
// Icons come from the dashboard-icons project, pinned to a commit so they
// don't change.
//
//   node scripts/screenshots.js            all shots
//   node scripts/screenshots.js editor     shots whose file name contains "editor"
//   node scripts/screenshots.js amo        only the AMO shots
import fs from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { launch } from "../test/e2e/browser.js";

const SCENE = new URL("../docs/screenshots.json", import.meta.url);
const OUT = new URL("../docs/", import.meta.url);
const AMO_OUT = new URL("../release/screenshots/", import.meta.url);
// The sketch of Firefox around an AMO shot: toolbar, then the sidebar's header.
const TOOLBAR = 44;
const SIDEBAR_HEADER = 40;

const scene = JSON.parse(await fs.readFile(SCENE, "utf8"));
const only = process.argv[2];
const shots = [
  ...scene.shots.map((s) => ({ ...s, label: s.file, out: new URL(s.file, OUT) })),
  ...scene.amo.shots.map((s) => ({ ...s, label: `amo/${s.file}`, out: new URL(s.file, AMO_OUT), framed: true })),
].filter((s) => !only || s.label.includes(only));
if (!shots.length) throw new Error(`No shot matches "${only}"`);

// "plex" is a dashboard-icons name; anything with a scheme is used as is.
const iconUrl = (ref) => (/^https?:/.test(ref) ? ref : `${scene.icons}${ref}.png`);
const downloads = new Map();
function download(url) {
  if (!downloads.has(url))
    downloads.set(
      url,
      fetch(url).then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        return { type: res.headers.get("content-type"), body: Buffer.from(await res.arrayBuffer()) };
      }),
    );
  return downloads.get(url);
}
// Stand-in sites by host, for the shot being taken: a page whose manifest
// and links point at the scene's icons, the way the real site's would.
let standIns = new Map();
const standIn = (url, name, icons) => standIns.set(new URL(url).host, { name, icons });
const html = (title, head = "") => `<!doctype html><html><head><title>${title}</title>${head}</head><body></body></html>`;
async function respond(req, res) {
  const url = new URL(req.url);
  if (process.env.DEBUG) console.log("proxy", url.href);
  const send = (type, body, status = 200) => res.writeHead(status, { "content-type": type }).end(body);
  const site = standIns.get(url.host);
  if (site) {
    const { name, icons } = site;
    const icon = { "/icon.png": icons.manifestIcon, "/touch.png": icons.touchIcon, "/icon.svg": icons.svgIcon }[url.pathname];
    if (icon) {
      const { type, body } = await download(iconUrl(icon));
      return send(type, body);
    }
    if (url.pathname === "/manifest.json")
      return send(
        "application/manifest+json",
        JSON.stringify({ short_name: name, start_url: "/", icons: icons.manifestIcon ? [{ src: "/icon.png" }] : [] }),
      );
    if (/\.\w+$/.test(url.pathname)) return send("text/plain", "", 404);
    const links = [
      '<link rel="manifest" href="/manifest.json">',
      icons.touchIcon && '<link rel="apple-touch-icon" href="/touch.png">',
      icons.svgIcon && '<link rel="icon" type="image/svg+xml" href="/icon.svg">',
    ];
    return send("text/html", html(name, links.filter(Boolean).join("")));
  }
  send("text/html", html(url.host));
}

const proxy = http.createServer((req, res) =>
  respond(req, res).catch((e) => {
    console.error(e);
    res.writeHead(502).end();
  }),
);
// https is sent here too and refused, so nothing reaches a real site.
proxy.on("connect", (_req, socket) => socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"));
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));

// Pages are stand-ins served over http, so the scene's https addresses are
// visited as http and nothing upgrades them back.
const viaProxy = (url) => url.replace(/^https:/, "http:");

const { driver, siteTab, railTab } = await launch({
  prefs: {
    "network.proxy.type": 1,
    "network.proxy.http": "127.0.0.1",
    "network.proxy.http_port": proxy.address().port,
    "network.proxy.ssl": "127.0.0.1",
    "network.proxy.ssl_port": proxy.address().port,
    // Self-hosted sites in the scene live on localhost.
    "network.proxy.allow_hijacking_localhost": true,
    // Most of the scene's sites are on the HSTS preload list.
    "network.stricttransportsecurity.preloadlist": false,
    "dom.security.https_first": false,
    "dom.security.https_first_schemeless": false,
    // The default for extension pages adds upgrade-insecure-requests.
    "extensions.webextensions.default-content-security-policy.v3": "script-src 'self';",
  },
});
const $ = (css, ms = 5000) => driver.wait(until.elementLocated(By.css(css)), ms);

async function setTheme(theme) {
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript(
    "Services.prefs.setIntPref('layout.css.prefers-color-scheme.content-override', arguments[0]);",
    theme === "light" ? 1 : 0,
  );
  await driver.setContext(firefox.Context.CONTENT);
}

async function goTo(url) {
  await driver.switchTo().window(siteTab);
  await driver.get(viaProxy(url));
  await driver.switchTo().window(railTab);
}

// Opens the editor for the site at url and waits for it to find icons. A real
// click: Firefox only grants the add-on access to sites from user input.
async function openAdd(url, address) {
  await goTo(url);
  await (await $("#add")).click();
  await driver.wait(async () => (await (await $(".editor .hint")).getText()) !== "Looking for icons…", 10000);
  // The editor saw the stand-in's http:// address; put the real one back, as
  // if typed. Focus stays in Name, as when the editor opens.
  await driver.executeScript(
    "const el = document.querySelector('input[name=url]'); el.value = arguments[0]; el.dispatchEvent(new Event('input'));",
    address,
  );
}

// Bigger than any shot, so pinning the page's size below never scrolls or
// crops it. Firefox opens the add-on's real sidebar on install, which takes
// about 385px of the width.
await driver.manage().window().setRect({ width: 1800, height: 1400 });
await fs.mkdir(AMO_OUT, { recursive: true });

// An AMO shot: the sidebar's own shot (sidebarPng) inside a sketch of a
// Firefox window, with the page in the current tab drawn as its site's icon
// and name. Laid out as a local page and screenshotted in the site tab.
async function framed(shot, sites, sidebarPng) {
  const { width, height, sidebar } = scene.amo;
  const site = shot.add ?? sites.find((s) => new URL(s.url).host === new URL(shot.page).host);
  const { type, body } = await download(iconUrl(shot.add ? shot.add.manifestIcon : site.icon));
  const page = new URL(shot.page);
  const address = page.host.replace(/^www\./, "") + (page.pathname === "/" ? "" : page.pathname);
  const dark = (shot.theme ?? scene.theme) === "dark";
  const c = dark
    ? { chrome: "#1c1b22", field: "#2b2a33", side: "#2b2a33", text: "#fbfbfe", muted: "#9a99a6", line: "#3a3944", page: "#15141a" }
    : { chrome: "#f0f0f4", field: "#ffffff", side: "#f9f9fb", text: "#15141a", muted: "#5b5b66", line: "#d7d7db", page: "#ffffff" };
  const logo = await fs.readFile(new URL("../extension/icons/siderail.svg", import.meta.url));
  const file = join(await fs.mkdtemp(join(tmpdir(), "siderail-amo-")), "window.html");
  await fs.writeFile(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; margin: 0; }
      html { width: ${width}px; height: ${height}px; color-scheme: ${dark ? "dark" : "light"}; }
      body { height: 100%; display: grid; grid-template: ${TOOLBAR}px 1fr / ${sidebar}px 1fr;
        font: 14px system-ui, sans-serif; background: ${c.chrome}; color: ${c.text}; }
      .toolbar { grid-column: 1 / -1; display: flex; align-items: center; gap: 16px; padding: 0 14px; border-bottom: 1px solid ${c.line}; }
      .nav { color: ${c.muted}; font-size: 17px; word-spacing: 12px; }
      .address { flex: 1; max-width: 760px; height: 30px; display: flex; align-items: center; padding: 0 12px; border-radius: 6px; background: ${c.field}; }
      .sidebar { display: flex; flex-direction: column; background: ${c.side}; border-right: 1px solid ${c.line}; }
      .sidebar header { height: ${SIDEBAR_HEADER}px; display: flex; align-items: center; gap: 8px; padding: 0 12px; font-weight: 600; }
      .sidebar header img { width: 18px; height: 18px; }
      .sidebar > img { display: block; }
      .page { display: grid; place-content: center; justify-items: center; gap: 22px; background: ${c.page}; }
      .page img { width: 168px; height: 168px; object-fit: contain; }
      .page h1 { font-size: 34px; font-weight: 600; }
    </style></head><body>
      <div class="toolbar"><span class="nav">← → ↻</span><span class="address">${address}</span></div>
      <div class="sidebar">
        <header><img src="data:image/svg+xml;base64,${logo.toString("base64")}" alt="">Siderail</header>
        <img src="data:image/png;base64,${sidebarPng}" alt="">
      </div>
      <div class="page"><img src="data:${type};base64,${body.toString("base64")}" alt=""><h1>${site.name}</h1></div>
    </body></html>`,
  );
  await driver.switchTo().window(siteTab);
  await driver.get(pathToFileURL(file).href);
  await driver.executeAsyncScript("Promise.all([...document.images].map((i) => i.decode())).then(arguments[arguments.length - 1]);");
  const png = await (await $("html")).takeScreenshot();
  await driver.switchTo().window(railTab);
  await fs.rm(file);
  return png;
}

try {
  for (const shot of shots) {
    const sites = scene.lists[shot.sites];
    if (!sites) throw new Error(`${shot.file}: no list "${shot.sites}"`);
    standIns = new Map();
    for (const site of sites) standIn(site.url, site.name, { manifestIcon: site.icon });
    if (shot.add) standIn(shot.page, shot.add.name, shot.add);

    await setTheme(shot.theme ?? scene.theme);
    await driver.executeAsyncScript(
      "const done = arguments[arguments.length - 1]; browser.storage.local.clear().then(() => done());",
    );
    await driver.navigate().refresh();
    // The page fills the viewport; pin it to the shot's size instead of
    // resizing the window, which has a minimum width.
    const width = shot.framed ? scene.amo.sidebar : scene.width;
    const height = shot.framed ? scene.amo.height - TOOLBAR - SIDEBAR_HEADER : shot.height;
    const size = (h) =>
      driver.executeScript(
        "document.documentElement.style.cssText = `width: ${arguments[0]}px; height: ${arguments[1]}px`;",
        width,
        h,
      );
    await size(height === "fit" ? 1000 : height);

    for (const [i, site] of sites.entries()) {
      await openAdd(site.url, site.url);
      await (await $('button[type="submit"]')).click();
      await driver.wait(async () => (await driver.findElements(By.css(".tile"))).length === i + 1, 5000);
    }
    if (shot.add) {
      await openAdd(shot.page, shot.add.address);
    } else {
      await goTo(shot.page);
      await $(".tile.active");
    }
    // "fit": as tall as the content (the editor), with nothing below it.
    if (height === "fit")
      await size(await driver.executeScript("return Math.ceil(document.querySelector('main > *').getBoundingClientRect().bottom);"));
    // Keep the pointer from hovering anything, and the caret out of the shot.
    // Two moves: a click doesn't update where the actions API thinks the pointer is,
    // so a move to its last position would be skipped.
    await driver.actions().move({ x: 600, y: 900 }).move({ x: 601, y: 901 }).perform();
    await driver.executeScript("document.documentElement.style.caretColor = 'transparent';");
    const png = await (await $("html")).takeScreenshot();
    await fs.writeFile(shot.out, shot.framed ? await framed(shot, sites, png) : png, "base64");
    console.log(`wrote ${shot.framed ? "release/screenshots" : "docs"}/${shot.file}`);
  }
} finally {
  await driver.quit();
  proxy.close();
}
