import { matchSite, sameHost } from "../lib/match.js";
import { makeSite, upsert, remove, move, moveTo } from "../lib/sites.js";
import {
  candidatesFromLinks,
  candidatesFromManifest,
  conventionalCandidates,
  dedupe,
  rankCandidates,
} from "../lib/icons.js";
import { pickName, homeUrl } from "../lib/names.js";
import { letterFor, colorFor } from "../lib/letter.js";
import { suggestPlate } from "../lib/plate.js";
import { indexFrom, search, guess, iconUrls } from "../lib/dashboard.js";
import { loadSites, saveSites } from "../storage.js";

// Icons are stored as square PNGs this many pixels across, except SVGs,
// which stay SVG so they're sharp at any size, unless they're over
// MAX_SVG_BYTES (some embed a big photo).
const ICON_PX = 192;
const MAX_SVG_BYTES = 100_000;
// How many found icons to offer in the editor.
const MAX_CHOICES = 8;
const FETCH_TIMEOUT_MS = 8000;
// dashboard-icons, as jsDelivr serves its GitHub repo. The main branch, so
// new apps turn up without a new Siderail. The e2e tests point
// "dashboardIconsBase" in storage at a local copy.
const DASHBOARD_ICONS = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/";
// Its list of icons is about 1.3 MB (110 kB compressed).
const INDEX_TIMEOUT_MS = 20000;
const MAX_RESULTS = 24;

const main = document.getElementById("main");
const footer = document.getElementById("footer");
const statusLine = document.getElementById("status");
const addButton = document.getElementById("add");

let sites = [];
// The current tab's address and the saved site it belongs to.
let activeUrl = null;
let activeId = null;
// The site being added or edited, while the editor is open.
let draft = null;
// Editor elements that change after it opens.
let ui = null;
let menu = null;

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (key === "value" || key === "checked") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

function setStatus(...content) {
  statusLine.replaceChildren(...content.filter(Boolean));
}

// ---- Storage

async function save(next) {
  sites = next;
  setStatus("");
  await saveSites(sites);
  render();
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.sites) {
    sites = changes.sites.newValue ?? [];
    render();
    refreshActive();
  }
});

// ---- Tabs

// The tab a button loads into. In the sidebar that's this window's active
// tab. When this page is open as a tab itself, it's the tab used most
// recently before it.
async function targetTab() {
  const self = await browser.tabs.getCurrent();
  if (!self) {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab;
  }
  const tabs = await browser.tabs.query({ windowId: self.windowId });
  return tabs.filter((t) => t.id !== self.id).sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
}

async function openSite(site, newTab) {
  const tab = await targetTab();
  if (newTab || !tab) await browser.tabs.create({ url: site.url, windowId: tab?.windowId });
  else await browser.tabs.update(tab.id, { url: site.url, active: true });
}

// Moves the highlight without rebuilding the list, which would lose keyboard
// focus every time any tab changes address.
async function refreshActive() {
  const tab = await targetTab();
  activeUrl = tab?.url ?? null;
  activeId = activeUrl ? matchSite(sites, activeUrl) : null;
  for (const el of main.querySelectorAll(".tiles .tile")) el.classList.toggle("active", el.dataset.id === activeId);
}

browser.tabs.onActivated.addListener(refreshActive);
browser.tabs.onUpdated.addListener(refreshActive, { properties: ["url"] });

// ---- The list

function render() {
  if (!draft) renderList();
}

function renderList() {
  ui = null;
  closeMenu();
  footer.classList.remove("hidden");
  if (!sites.length) {
    main.replaceChildren(
      h(
        "div",
        { class: "empty" },
        h("p", {}, "No sites yet."),
        h("p", {}, "Open a website, then press “Add this site”."),
        h("p", {}, h("button", { type: "button", class: "link", onclick: () => browser.runtime.openOptionsPage() }, "Import a backup")),
      ),
    );
    return;
  }
  main.replaceChildren(h("nav", { class: "tiles", "aria-label": "Sites" }, sites.map(tile)));
}

function tile(site) {
  return h(
    "a",
    {
      class: site.id === activeId ? "tile active" : "tile",
      href: site.url,
      title: site.url,
      "data-id": site.id,
      onclick: (e) => {
        e.preventDefault();
        openSite(site, e.ctrlKey || e.metaKey || e.shiftKey);
      },
      onauxclick: (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        openSite(site, true);
      },
      oncontextmenu: (e) => showMenu(e, site),
    },
    h("span", { class: "in" }, iconFor(site), h("span", { class: "name" }, site.name)),
  );
}

function iconFor({ name, icon, plate }) {
  if (icon) return h("span", { class: plate ? "icon plate" : "icon" }, h("img", { src: icon, alt: "" }));
  const letter = h("span", { class: "icon" }, letterFor(name || "?"));
  letter.style.background = colorFor(name || "?");
  return letter;
}

// ---- Right-click menu

function showMenu(e, site) {
  e.preventDefault();
  closeMenu();
  const i = sites.findIndex((s) => s.id === site.id);
  const item = (label, action, disabled = false) =>
    h("button", { type: "button", role: "menuitem", disabled, onclick: () => (closeMenu(), action()) }, label);
  menu = h(
    "div",
    { class: "menu", role: "menu" },
    item("Edit", () => openEditor(site)),
    item("Move to top", () => save(moveTo(sites, site.id, 0)), i === 0),
    item("Move up", () => save(move(sites, site.id, -1)), i === 0),
    item("Move down", () => save(move(sites, site.id, 1)), i === sites.length - 1),
    item("Move to bottom", () => save(moveTo(sites, site.id, sites.length - 1)), i === sites.length - 1),
    item("Remove", () => removeSite(site)),
  );
  document.body.append(menu);
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(e.clientX, innerWidth - box.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(e.clientY, innerHeight - box.height - 4))}px`;
  menu.querySelector("button:not(:disabled)").focus();
}

function closeMenu() {
  menu?.remove();
  menu = null;
}

document.addEventListener("pointerdown", (e) => {
  if (menu && !menu.contains(e.target)) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (menu) closeMenu();
  else if (draft) closeEditor();
});
addEventListener("blur", closeMenu);

// Removing is undoable rather than confirmed up front: an uploaded icon would
// otherwise be gone for good.
async function removeSite(site) {
  const index = sites.findIndex((s) => s.id === site.id);
  await save(remove(sites, site.id));
  const undo = () => save(moveTo(upsert(sites, site), site.id, Math.min(index, sites.length)));
  setStatus(`Removed ${site.name}. `, h("button", { type: "button", class: "link", onclick: undo }, "Undo"));
}

// ---- Adding a site

// Permission to read sites is only needed to find their icons. It must be
// requested straight from the click: Firefox only prompts for user actions.
const requestSiteAccess = () => browser.permissions.request({ origins: ["<all_urls>"] });

addButton.addEventListener("click", () => {
  // Checked before asking, so a new tab doesn't get a permission prompt
  // followed by "open a website first". startAdd checks again.
  if (!isWeb(activeUrl)) return setStatus("Open a website first, then add it.");
  startAdd(requestSiteAccess());
});

const isWeb = (url) => /^https?:/.test(url ?? "");

async function startAdd(access) {
  const tab = await targetTab();
  if (!isWeb(tab?.url)) {
    access.catch(() => {});
    setStatus("Open a website first, then add it.");
    return;
  }
  setStatus("");
  openEditor(
    { name: pickName({ tabTitle: tab.title, url: tab.url }), url: homeUrl({ url: tab.url }) },
    { pageUrl: tab.url, tabTitle: tab.title, favIconUrl: tab.favIconUrl, access },
  );
}

// ---- The editor

function openEditor(site, discovery = null) {
  closeMenu();
  draft = {
    id: site.id,
    name: site.name,
    url: site.url,
    icon: site.icon ?? null,
    plate: site.plate ?? false,
    pageUrl: discovery?.pageUrl,
    choices: site.icon ? [{ icon: site.icon, plate: site.plate, label: "current" }] : [],
    searchOpen: false,
    // Fields the user has changed, which discovery must not overwrite.
    touched: new Set(),
  };
  renderEditor();
  if (discovery) discover(draft, discovery);
}

function closeEditor() {
  draft = null;
  setStatus("");
  render();
}

function renderEditor() {
  const d = draft;
  footer.classList.add("hidden");
  const field = (key) => (e) => {
    d[key] = e.target.value;
    d.touched.add(key);
    if (key === "name") updatePreview();
  };
  ui = {
    name: h("input", { type: "text", name: "name", value: d.name, oninput: field("name") }),
    url: h("input", { type: "url", name: "url", value: d.url, oninput: field("url") }),
    preview: h("div", { class: "tile preview", "aria-hidden": "true" }),
    choices: h("div", { class: "choices", role: "group", "aria-label": "Icon" }),
    hint: h("p", { class: "hint", role: "status" }),
    plate: h("input", {
      type: "checkbox",
      name: "plate",
      checked: d.plate,
      onchange: (e) => {
        d.plate = e.target.checked;
        d.touched.add("plate");
        updatePreview();
      },
    }),
    file: h("input", {
      type: "file",
      accept: "image/*",
      hidden: true,
      onchange: (e) => e.target.files[0] && useImage(e.target.files[0], "upload"),
    }),
  };
  renderSearch();
  const isNew = !d.id;
  main.replaceChildren(
    h(
      "form",
      {
        class: "editor",
        onsubmit: saveDraft,
        ondragover: (e) => e.preventDefault(),
        ondrop: (e) => {
          e.preventDefault();
          const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
          if (file) useImage(file, "upload");
        },
      },
      h("h2", {}, isNew ? "Add a site" : "Edit site"),
      ui.preview,
      h("label", {}, "Name", ui.name),
      h("label", {}, "Address", ui.url),
      d.pageUrl &&
        d.pageUrl !== d.url &&
        h(
          "button",
          {
            type: "button",
            class: "link",
            onclick: () => {
              d.url = ui.url.value = d.pageUrl;
              d.touched.add("url");
            },
          },
          "Use this exact page",
        ),
      h("div", { class: "label-row" }, "Icon"),
      ui.choices,
      ui.search,
      ui.hint,
      !isNew &&
        h(
          "button",
          {
            type: "button",
            class: "link",
            onclick: () => discover(d, { pageUrl: d.url, access: requestSiteAccess() }),
          },
          "Find icons on the site",
        ),
      h("label", { class: "check" }, ui.plate, "Light background behind the icon"),
      ui.file,
      h(
        "div",
        { class: "actions" },
        h("button", { type: "submit", class: "primary" }, "Save"),
        h("button", { type: "button", onclick: closeEditor }, "Cancel"),
        !isNew && h("button", { type: "button", class: "danger", onclick: removeDraft }, "Remove"),
      ),
    ),
  );
  updatePreview();
  ui.name.focus();
}

function updatePreview() {
  ui.preview.replaceChildren(h("span", { class: "in" }, iconFor(draft), h("span", { class: "name" }, draft.name || " ")));
  renderChoices();
}

function renderChoices() {
  const d = draft;
  const choice = (content, pressed, onclick, attrs = {}) =>
    h("button", { type: "button", class: "choice", "aria-pressed": String(pressed), onclick, ...attrs }, content);
  const pickByUser = (c) => () => {
    d.touched.add("icon");
    pick(c);
  };
  ui.choices.replaceChildren(
    ...d.choices.map((c) =>
      choice(iconFor({ name: d.name, icon: c.icon, plate: c.plate }), c.icon === d.icon, pickByUser(c), {
        "data-size": c.svg ? "svg" : c.width,
        title: c.from
          ? `${c.from} from dashboard-icons`
          : c.svg
            ? "Scalable (SVG)"
            : c.width
              ? `${c.width}×${c.height}`
              : c.label,
      }),
    ),
    choice(iconFor({ name: d.name, icon: null }), d.icon === null, pickByUser(null), {
      "data-size": "letter",
      title: "Letter",
    }),
    choice(h("span", { class: "label" }, "Upload…"), false, () => ui.file.click(), { "aria-pressed": null }),
    choice(h("span", { class: "label" }, "Search…"), false, () => (d.searchOpen ? closeSearch() : openSearch()), {
      "aria-pressed": null,
      "aria-expanded": String(d.searchOpen),
      title: "Search dashboard-icons",
    }),
  );
}

function pick(c) {
  draft.icon = c?.icon ?? null;
  if (!draft.touched.has("plate")) {
    draft.plate = c?.plate ?? false;
    ui.plate.checked = draft.plate;
  }
  updatePreview();
}

function setHint(text) {
  if (ui) ui.hint.textContent = text;
}

async function useImage(blob, label) {
  const d = draft;
  try {
    const c = await toChoice(blob, { label });
    if (draft !== d) return;
    d.choices.unshift(c);
    d.touched.add("icon");
    pick(c);
    setHint("");
  } catch {
    setHint("That file isn't an image Firefox can read.");
  }
}

document.addEventListener("paste", (e) => {
  if (!draft) return;
  const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
  if (file) {
    e.preventDefault();
    useImage(file, "pasted");
  }
});

async function saveDraft(e) {
  e.preventDefault();
  // A second Enter while the first save is still writing.
  if (!draft) return;
  const d = draft;
  const name = d.name?.trim();
  let url = null;
  try {
    url = new URL(d.url?.trim());
  } catch {
    // reported below
  }
  if (!name) return setHint("Give the button a name.");
  if (!url || !/^https?:$/.test(url.protocol)) return setHint("The address must start with http:// or https://");
  draft = null;
  await save(upsert(sites, makeSite({ id: d.id, name, url: url.href, icon: d.icon, plate: d.plate })));
  refreshActive();
}

async function removeDraft() {
  const site = sites.find((s) => s.id === draft?.id);
  draft = null;
  if (site) await removeSite(site);
  else render();
}

// ---- Finding icons

// The site's own icons, then dashboard-icons' icon for the app if its name
// or host is one there. That one never beats an icon the site has.
async function discover(d, { pageUrl, tabTitle, favIconUrl, access }) {
  setHint("Looking for icons…");
  // Doesn't need permission to read sites, so it starts straight away.
  const icons = dashboardIcons().catch(() => null);
  const granted = await access.catch(() => false);
  if (draft !== d) return;
  const isNew = !d.id;
  let found = { choices: [] };
  if (granted) {
    found = await findIcons(pageUrl, { tabTitle, favIconUrl });
    if (draft !== d) return;
    if (isNew && !d.touched.has("name")) d.name = ui.name.value = found.name;
    if (isNew && !d.touched.has("url")) d.url = ui.url.value = found.home;
  }
  const guessed = await guessIcon(await icons, d);
  if (draft !== d) return;
  const known = new Set(d.choices.map((c) => c.icon));
  d.choices.push(...[...found.choices, guessed].filter((c) => c && !known.has(c.icon)));
  const best = found.choices[0] ?? guessed;
  if (isNew && !d.touched.has("icon") && best) pick(best);
  else updatePreview();
  if (!granted) setHint("Finding the site's own icons needs permission to read sites. You can still search for one or upload one.");
  else if (found.choices.length) setHint("");
  else if (guessed) setHint(`No large icon found on this site, so this one is ${guessed.from} from dashboard-icons.`);
  else setHint("No large icon found on this site. Search for one, upload one, or keep the letter.");
}

async function fetchOk(url) {
  const res = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}

// Reads the page and its web app manifest for icons and a name, then
// downloads the candidates to measure them, best first.
async function findIcons(pageUrl, { tabTitle, favIconUrl } = {}) {
  let doc = null;
  let base = pageUrl;
  try {
    const res = await fetchOk(pageUrl);
    // Sent to another site, such as a sign-in page: its name and icons
    // aren't this site's.
    if (!sameHost(res.url, pageUrl)) throw new Error(`redirected to ${res.url}`);
    base = res.url;
    doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const baseHref = doc.querySelector("base[href]")?.getAttribute("href");
    if (baseHref) base = new URL(baseHref, base).href;
  } catch {
    // Unreadable, or another site's: fall back to the conventional icon and the tab's own.
  }
  const links = doc
    ? [...doc.querySelectorAll("link[rel][href]")].map((l) => ({
        rel: l.getAttribute("rel"),
        href: l.getAttribute("href"),
        sizes: l.getAttribute("sizes"),
        type: l.getAttribute("type"),
      }))
    : [];

  let manifest = null;
  let manifestUrl = null;
  const manifestLink = links.find((l) => l.rel.toLowerCase().split(/\s+/).includes("manifest"));
  if (manifestLink) {
    try {
      manifestUrl = new URL(manifestLink.href, base).href;
      manifest = await (await fetchOk(manifestUrl)).json();
    } catch {
      manifest = null;
    }
  }

  const candidates = dedupe([
    ...candidatesFromManifest(manifest, manifestUrl),
    ...candidatesFromLinks(links, base),
    ...conventionalCandidates(base),
    ...(favIconUrl ? [{ url: favIconUrl, source: "icon", declared: 0, svg: false }] : []),
  ]);
  const measured = await Promise.all(
    candidates.map(async (c) => {
      try {
        const blob = await (await fetchOk(c.url)).blob();
        return { ...c, ...(await toChoice(blob, { svg: c.svg, label: c.source })) };
      } catch {
        return null;
      }
    }),
  );
  const seen = new Set();
  const choices = rankCandidates(measured.filter(Boolean))
    .filter((c) => !seen.has(c.icon) && seen.add(c.icon))
    .slice(0, MAX_CHOICES);

  const meta = (key) => doc?.querySelector(`meta[name="${key}"], meta[property="${key}"]`)?.getAttribute("content");
  return {
    choices,
    name: pickName({
      manifest,
      appName: meta("application-name") ?? meta("apple-mobile-web-app-title"),
      siteName: meta("og:site_name"),
      docTitle: doc?.title,
      tabTitle,
      url: base,
    }),
    home: homeUrl({ manifest, manifestUrl, url: base }),
  };
}

// ---- dashboard-icons

// The list of dashboard-icons, downloaded once while the sidebar is open:
// { base, index }. A failed download is tried again next time.
let dashboard = null;
function dashboardIcons() {
  dashboard ??= (async () => {
    const { dashboardIconsBase: base } = await browser.storage.local.get({ dashboardIconsBase: DASHBOARD_ICONS });
    const res = await fetch(`${base}metadata.json`, { credentials: "omit", signal: AbortSignal.timeout(INDEX_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${res.status} ${res.url}`);
    return { base, index: indexFrom(await res.json()) };
  })().catch((e) => {
    dashboard = null;
    throw e;
  });
  return dashboard;
}

// One of its icons (or a light or dark variant) as an editor choice, as SVG
// when it's drawn as one.
async function dashboardChoice({ base }, entry, variant) {
  for (const url of iconUrls(base, entry, variant)) {
    try {
      const res = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) continue;
      return { ...(await toChoice(await res.blob(), { svg: url.endsWith(".svg") })), from: variant };
    } catch {
      // try the next format
    }
  }
  throw new Error(`no icon for ${variant}`);
}

async function guessIcon(icons, d) {
  const entry = icons && guess(icons.index, { name: d.name, url: d.url });
  return entry ? dashboardChoice(icons, entry, entry.name).catch(() => null) : null;
}

// The search box and results under the icon choices, shown by "Search…".
function renderSearch() {
  const d = draft;
  const input = h("input", {
    type: "search",
    name: "icon-search",
    placeholder: "App name",
    autocomplete: "off",
    "aria-label": "Search dashboard-icons",
    oninput: () => showResults(d),
    onkeydown: (e) => {
      // Enter would save the site.
      if (e.key === "Enter") {
        e.preventDefault();
        results.querySelector("button")?.click();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        results.querySelector("button")?.focus();
      }
    },
  });
  const results = h("div", {
    class: "choices results",
    role: "group",
    "aria-label": "dashboard-icons",
    onkeydown: (e) => {
      const buttons = [...results.querySelectorAll("button")];
      const i = buttons.indexOf(document.activeElement);
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (i < 0 || !step) return;
      e.preventDefault();
      (i + step < 0 ? input : buttons[i + step])?.focus();
    },
  });
  ui.searchInput = input;
  ui.results = results;
  ui.search = h(
    "div",
    {
      class: "search",
      hidden: !d.searchOpen,
      onkeydown: (e) => {
        if (e.key !== "Escape") return;
        // Closes the search, not the editor.
        e.stopPropagation();
        closeSearch();
      },
    },
    input,
    results,
  );
}

function openSearch() {
  draft.searchOpen = true;
  ui.search.hidden = false;
  if (!ui.searchInput.value) ui.searchInput.value = draft.name ?? "";
  renderChoices();
  ui.searchInput.focus();
  ui.searchInput.select();
  showResults(draft);
}

function closeSearch() {
  draft.searchOpen = false;
  ui.search.hidden = true;
  renderChoices();
  ui.choices.querySelector("[aria-expanded]").focus();
}

async function showResults(d) {
  const query = ui.searchInput.value;
  let icons;
  try {
    icons = await dashboardIcons();
  } catch {
    if (draft === d) setHint("Couldn't reach dashboard-icons. Check the connection and search again.");
    return;
  }
  // Typed on since, or closed.
  if (draft !== d || ui.searchInput.value !== query) return;
  setHint("");
  const hits = search(icons.index, query, MAX_RESULTS)
    .flatMap((entry) => entry.variants.map((variant) => [entry, variant]))
    .slice(0, MAX_RESULTS);
  ui.results.replaceChildren(
    ...hits.map(([entry, variant]) => {
      const urls = iconUrls(icons.base, entry, variant);
      const img = h("img", { src: urls[0], alt: "", loading: "lazy" });
      img.addEventListener("error", () => urls.length > 1 && (img.src = urls.pop()), { once: true });
      return h(
        "button",
        { type: "button", class: "choice", title: variant, onclick: () => useDashboardIcon(d, icons, entry, variant) },
        h("span", { class: "icon" }, img),
      );
    }),
  );
  if (query.trim() && !hits.length) setHint("No icons match. Try the app's name rather than the site's.");
}

async function useDashboardIcon(d, icons, entry, variant) {
  setHint(`Downloading ${variant}…`);
  try {
    const c = await dashboardChoice(icons, entry, variant);
    if (draft !== d) return;
    const chosen = d.choices.find((k) => k.icon === c.icon) ?? (d.choices.unshift(c), c);
    d.touched.add("icon");
    setHint("");
    closeSearch();
    pick(chosen);
    ui.choices.querySelector('[aria-pressed="true"]').focus();
  } catch {
    if (draft === d) setHint(`Couldn't download ${variant} from dashboard-icons.`);
  }
}

// Draws an image into a square ICON_PX canvas, keeping its proportions, to
// measure it and check whether it needs a light background. The icon is the
// SVG itself when it is one, otherwise the canvas as a PNG.
async function toChoice(blob, { svg = false, label } = {}) {
  if (svg || blob.type === "image/svg+xml") blob = await prepareSvg(blob);
  const isSvg = blob.type === "image/svg+xml";
  const src = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    // SVGs without a set size report 0; draw those at full size.
    const w = img.naturalWidth || ICON_PX;
    const ht = img.naturalHeight || ICON_PX;
    const scale = Math.min(ICON_PX / w, ICON_PX / ht);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = ICON_PX;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (ICON_PX - w * scale) / 2, (ICON_PX - ht * scale) / 2, w * scale, ht * scale);
    return {
      icon: isSvg && blob.size <= MAX_SVG_BYTES ? await dataUrl(blob) : canvas.toDataURL("image/png"),
      plate: suggestPlate(ctx.getImageData(0, 0, ICON_PX, ICON_PX).data),
      width: img.naturalWidth,
      height: img.naturalHeight,
      svg: isSvg,
      label,
    };
  } finally {
    URL.revokeObjectURL(src);
  }
}

// An SVG with a width and height but no viewBox doesn't scale: its drawing
// stays that size however big it's shown. A viewBox makes it fill the icon.
// Throws for files that aren't SVG, such as an HTML error page at a .svg URL.
async function prepareSvg(blob) {
  const doc = new DOMParser().parseFromString(await blob.text(), "image/svg+xml");
  const root = doc.documentElement;
  if (root.namespaceURI !== "http://www.w3.org/2000/svg" || root.localName !== "svg") throw new Error("not an SVG");
  // Only plain lengths: "100%" or "2em" can't become a viewBox.
  const size = (attr) => +(root.getAttribute(attr)?.match(/^\s*([\d.]+)(px)?\s*$/)?.[1] ?? 0);
  const [w, h] = [size("width"), size("height")];
  if (!root.hasAttribute("viewBox") && w > 0 && h > 0) root.setAttribute("viewBox", `0 0 ${w} ${h}`);
  return new Blob([new XMLSerializer().serializeToString(doc)], { type: "image/svg+xml" });
}

function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ---- Start

sites = await loadSites();
render();
await refreshActive();
