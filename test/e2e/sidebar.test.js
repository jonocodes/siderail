// Drives the real extension in headless Firefox against local fixture sites.
// The tests run in order and share one browser: each starts from the sites
// the ones before it left behind.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { By, Key, until } from "selenium-webdriver";
import { startFixtures, png } from "./fixtures.js";
import { launch, openPage } from "./browser.js";

let driver;
let sites;
let siteTab;
let railTab;
let downloads;

before(async () => {
  sites = await startFixtures();
  downloads = await mkdtemp(join(tmpdir(), "siderail-downloads-"));
  ({ driver, siteTab, railTab } = await launch({
    firstUrl: sites.alpha,
    prefs: { "browser.download.folderList": 2, "browser.download.dir": downloads, "browser.download.useDownloadDir": true },
  }));
  await useDashboardIcons(sites.dashboardIcons);
});

after(async () => {
  await driver?.quit();
  await sites?.close();
});

const $ = (css) => driver.wait(until.elementLocated(By.css(css)), 5000);
const tileNames = async () =>
  Promise.all((await driver.findElements(By.css(".tile:not(.preview) .name"))).map((e) => e.getText()));
const activeName = async () => (await $(".tile.active .name")).getText();
const inputValue = async (name) => (await $(`input[name="${name}"]`)).getAttribute("value");
// The data-size of the selected icon choice; the choices are redrawn often,
// so a stale element counts as not there yet.
const pressedSize = () => $('.choice[aria-pressed="true"]').then((e) => e.getAttribute("data-size")).catch(() => null);
const button = async (label) => (await $(".editor")).findElement(By.xpath(`.//button[.="${label}"]`));

async function goTo(url) {
  await driver.switchTo().window(siteTab);
  await driver.get(url);
  await driver.switchTo().window(railTab);
}

// Opens the editor for the site in the other tab and waits for icon discovery.
async function addCurrentSite() {
  await (await $("#add")).click();
  await $(".editor");
  await driver.wait(async () => (await (await $(".editor .hint")).getText()) !== "Looking for icons…", 10000);
}

// Right-clicks the button whose address is `url` and picks `label` from the menu.
async function menu(url, label) {
  await driver.actions().contextClick(await $(`.tile[title="${url}"]`)).perform();
  await (await $(".menu")).findElement(By.xpath(`./button[.="${label}"]`)).click();
}

// Points the add-on at a copy of dashboard-icons instead of jsDelivr.
async function useDashboardIcons(base) {
  await driver.executeAsyncScript("browser.storage.local.set({ dashboardIconsBase: arguments[0] }).then(arguments[1]);", base);
}

const pressedTitle = () => $('.choice[aria-pressed="true"]').then((e) => e.getAttribute("title")).catch(() => null);
const resultTitles = async () =>
  Promise.all((await driver.findElements(By.css(".results button"))).map((e) => e.getAttribute("title"))).catch(() => null);
const svgOf = async (url) => {
  const src = await (await $(`.tile[title="${url}"] img`)).getAttribute("src");
  assert.match(src, /^data:image\/svg\+xml;base64,/);
  return Buffer.from(src.split(",")[1], "base64").toString();
};

async function hasSiteAccess() {
  return driver.executeAsyncScript("browser.permissions.contains({ origins: ['<all_urls>'] }).then(arguments[0]);");
}

test("starts empty", async () => {
  assert.match(await (await $(".empty")).getText(), /No sites yet/);
});

test("on a page that isn't a website, adding says so without asking for access", async () => {
  await goTo("about:blank");
  await (await $("#add")).click();
  await driver.wait(async () => (await (await $("#status")).getText()).includes("Open a website first"), 5000);
  // The test profile grants permission requests silently, so a request would show here.
  assert.equal(await hasSiteAccess(), false);
  await goTo(sites.alpha);
});

test("adds a site with its largest icon and the site's own name", async () => {
  await addCurrentSite();
  assert.equal(await inputValue("name"), "Alpha");
  assert.equal(await inputValue("url"), sites.alpha);
  assert.equal(await pressedSize(), "512");
  // The 512px, 180px and SVG icons are offered; the 16px favicon isn't.
  const sizes = await Promise.all((await driver.findElements(By.css(".choice[data-size]"))).map((e) => e.getAttribute("data-size")));
  assert.deepEqual(sizes, ["512", "180", "svg", "letter"]);
  await (await $('button[type="submit"]')).click();
  await $(".tiles");
  assert.deepEqual(await tileNames(), ["Alpha"]);
  assert.equal(await activeName(), "Alpha");
});

test("falls back to a letter when a site has only a small favicon", async () => {
  await goTo(sites.bravo);
  await addCurrentSite();
  assert.equal(await inputValue("name"), "Bravo");
  assert.equal(await pressedSize(), "letter");
  assert.match(await (await $(".editor .hint")).getText(), /No large icon/);
  await (await $('button[type="submit"]')).click();
  await driver.wait(async () => (await tileNames()).length === 2, 5000);
  assert.deepEqual(await tileNames(), ["Alpha", "Bravo"]);
  assert.equal(await activeName(), "Bravo");
});

test("clicking a button loads the site in the other tab", async () => {
  await (await $(".tile:not(.active)")).click();
  await driver.switchTo().window(siteTab);
  await driver.wait(until.urlIs(sites.alpha), 5000);
  await driver.switchTo().window(railTab);
  await driver.wait(async () => (await activeName()) === "Alpha", 5000);
});

test("ctrl-click opens the site in a new tab", async () => {
  const before = await driver.getAllWindowHandles();
  await driver.actions().keyDown(Key.CONTROL).click(await $(".tile:not(.active)")).keyUp(Key.CONTROL).perform();
  await driver.wait(async () => (await driver.getAllWindowHandles()).length === before.length + 1, 5000);
  const opened = (await driver.getAllWindowHandles()).find((h) => !before.includes(h));
  await driver.switchTo().window(opened);
  await driver.wait(until.urlIs(sites.bravo), 5000);
  await driver.close();
  await driver.switchTo().window(siteTab);
  assert.equal(await driver.getCurrentUrl(), sites.alpha);
  await driver.switchTo().window(railTab);
});

test("an uploaded dark logo on transparency gets a light background", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "siderail-")), "logo.png");
  await writeFile(file, png(256, [20, 20, 20], { fill: 0.6 }));
  await menu(sites.bravo, "Edit");
  await (await $('input[type="file"]')).sendKeys(file);
  await driver.wait(async () => (await pressedSize()) === "256", 5000);
  assert.equal(await (await $('input[name="plate"]')).isSelected(), true);
  await (await $('button[type="submit"]')).click();
  await $(`.tile[title="${sites.bravo}"] .icon.plate img`);
  // The plate's padding once grew with the button's width and pushed the name out.
  assert.deepEqual(await tileNames(), ["Alpha", "Bravo"]);
});

test("an SVG icon found from the editor is kept as SVG, made to scale and fit", async () => {
  await menu(sites.alpha, "Edit");
  await (await button("Find icons on the site")).click();
  await (await $('.choice[data-size="svg"]')).click();
  await (await $('button[type="submit"]')).click();
  const src = await (await $(`.tile[title="${sites.alpha}"] img`)).getAttribute("src");
  assert.match(src, /^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(src.split(",")[1], "base64").toString();
  assert.match(svg, /<ellipse /);
  assert.match(svg, /viewBox="0 0 50 100"/);
  // A tall image is fitted inside its square icon rather than overflowing it.
  const [img, box] = await driver.executeScript(
    "const img = document.querySelector(`.tile[title='${arguments[0]}'] img`); return [img, img.parentElement].map((e) => e.getBoundingClientRect().toJSON());",
    sites.alpha,
  );
  assert.ok(img.height <= box.height + 0.5, `image ${img.height}px tall in a ${box.height}px icon`);
});

test("right-click menu edits, reorders and removes, and removing can be undone", async () => {
  await menu(sites.bravo, "Edit");
  const name = await $('input[name="name"]');
  await name.clear();
  await name.sendKeys("Bravo TV");
  await (await $('button[type="submit"]')).click();
  await driver.wait(async () => (await tileNames()).includes("Bravo TV"), 5000);

  await menu(sites.bravo, "Move up");
  await driver.wait(async () => (await tileNames())[0] === "Bravo TV", 5000);

  await menu(sites.bravo, "Move to bottom");
  await driver.wait(async () => (await tileNames())[1] === "Bravo TV", 5000);

  await menu(sites.bravo, "Move to top");
  await driver.wait(async () => (await tileNames())[0] === "Bravo TV", 5000);

  // Undo puts it back where it was, not at the end.
  await menu(sites.bravo, "Remove");
  await driver.wait(async () => (await tileNames()).length === 1, 5000);
  await (await $("#status")).findElement(By.xpath(`./button[.="Undo"]`)).click();
  await driver.wait(async () => (await tileNames()).length === 2, 5000);
  assert.deepEqual(await tileNames(), ["Bravo TV", "Alpha"]);

  await menu(sites.alpha, "Remove");
  await driver.wait(async () => (await tileNames()).length === 1, 5000);
  assert.deepEqual(await tileNames(), ["Bravo TV"]);
});

test("a site saved at a deep page stays highlighted elsewhere on its host", async () => {
  const deep = `${sites.bravo}deep/page`;
  await goTo(deep);
  await addCurrentSite();
  assert.equal(await inputValue("url"), sites.bravo);
  await (await button("Use this exact page")).click();
  assert.equal(await inputValue("url"), deep);
  await (await button("Cancel")).click();

  await menu(sites.bravo, "Edit");
  const url = await $('input[name="url"]');
  await url.clear();
  await url.sendKeys(deep);
  await (await $('button[type="submit"]')).click();
  await $(`.tile[title="${deep}"]`);
  await goTo(sites.bravo);
  await driver.wait(async () => (await activeName()) === "Bravo TV", 5000);
});

test("a page that sends the add-on to a sign-in page elsewhere keeps its own name and address", async () => {
  // The browser shows "Charlie"; the add-on's own fetch of the page lands on
  // "Sign in - AuthApp" on the other host, which mustn't be used.
  await goTo(`${sites.bravo}bounced/`);
  await addCurrentSite();
  assert.equal(await inputValue("name"), "Charlie");
  assert.equal(await inputValue("url"), sites.bravo);
  assert.equal(await pressedSize(), "letter");
  await (await button("Cancel")).click();
});

test("exports the list, icons included, and imports it back", async () => {
  // Export from the options page.
  const optionsTab = await openPage(driver, "options/options.html");
  await (await $("#export")).click();
  let file = null;
  await driver.wait(async () => {
    file = (await readdir(downloads)).find((f) => /^siderail-[\d-]+\.json$/.test(f));
    return file && (await readFile(join(downloads, file), "utf8")).endsWith("}");
  }, 5000);
  const exported = JSON.parse(await readFile(join(downloads, file), "utf8"));
  assert.equal(exported.format, "siderail");
  assert.deepEqual(exported.sites.map((s) => [s.name, s.plate]), [["Bravo TV", true]]);
  assert.match(exported.sites[0].icon, /^data:image\/png;base64,/);
  assert.match(await (await $("#status")).getText(), /Exported 1 site\./);
  await driver.close();
  await driver.switchTo().window(railTab);

  // Remove everything; the empty sidebar links to the options page to import.
  await menu(`${sites.bravo}deep/page`, "Remove");
  await $(".empty");
  const before = await driver.getAllWindowHandles();
  await (await $(".empty button.link")).click();
  await driver.wait(async () => (await driver.getAllWindowHandles()).length > before.length, 5000);
  const importTab = (await driver.getAllWindowHandles()).find((h) => !before.includes(h));
  await driver.switchTo().window(importTab);
  await driver.wait(until.urlContains("options/options.html"), 5000);

  const importFile = async (path) => {
    await (await $("#file")).sendKeys(path);
    await driver.wait(async () => (await (await $("#status")).getText()) !== "", 5000);
    const text = await (await $("#status")).getText();
    await driver.executeScript("document.getElementById('status').textContent = '';");
    return text;
  };
  assert.equal(await importFile(join(downloads, file)), "Imported 1 site: 1 added, 0 replaced.");
  // Importing again replaces rather than duplicates.
  assert.equal(await importFile(join(downloads, file)), "Imported 1 site: 0 added, 1 replaced.");
  const junk = join(downloads, "junk.json");
  await writeFile(junk, '{"hello": "world"}');
  assert.equal(await importFile(junk), "That file isn't a Siderail backup.");
  await driver.close();

  await driver.switchTo().window(railTab);
  await driver.wait(async () => (await tileNames()).length === 1, 5000);
  assert.deepEqual(await tileNames(), ["Bravo TV"]);
  await $(`.tile[title="${sites.bravo}deep/page"] .icon.plate img`);
});

test("a self-hosted app without a large icon gets its icon from dashboard-icons", async () => {
  const jellyfin = `${sites.bravo}jellyfin/`;
  await goTo(jellyfin);
  await addCurrentSite();
  assert.equal(await inputValue("name"), "Jellyfin");
  assert.equal(await inputValue("url"), jellyfin);
  assert.equal(await pressedTitle(), "jellyfin from dashboard-icons");
  assert.match(await (await $(".editor .hint")).getText(), /No large icon found on this site, so this one is jellyfin from dashboard-icons/);
  await (await $('button[type="submit"]')).click();
  await driver.wait(async () => (await tileNames()).length === 2, 5000);
  assert.match(await svgOf(jellyfin), /class="jellyfin"/);
});

test("an app's own icon still comes before dashboard-icons'", async () => {
  await goTo(`${sites.alpha}sonarr/`);
  await addCurrentSite();
  assert.equal(await inputValue("name"), "Sonarr");
  assert.equal(await pressedSize(), "180");
  const titles = await Promise.all((await driver.findElements(By.css(".choice[data-size]"))).map((e) => e.getAttribute("title")));
  assert.deepEqual(titles, ["180×180", "sonarr from dashboard-icons", "Letter"]);
  await (await button("Cancel")).click();
});

test("searches dashboard-icons from the editor, without permission to read sites", async () => {
  await driver.executeAsyncScript("browser.permissions.remove({ origins: ['<all_urls>'] }).then(arguments[0]);");
  assert.equal(await hasSiteAccess(), false);
  const jellyfin = `${sites.bravo}jellyfin/`;
  await menu(jellyfin, "Edit");

  // It starts from the site's name.
  await (await button("Search…")).click();
  const search = await $('input[name="icon-search"]');
  assert.equal(await search.getAttribute("value"), "Jellyfin");
  await driver.wait(async () => (await resultTitles())?.[0] === "jellyfin", 5000);

  // Light and dark variants are offered; the arrow keys move between results.
  await search.clear();
  await search.sendKeys("PLEX");
  await driver.wait(async () => (await resultTitles())?.join() === "plex,plex-light", 5000);
  await search.sendKeys(Key.ARROW_DOWN);
  await driver.switchTo().activeElement().sendKeys(Key.ARROW_RIGHT);
  assert.equal(await driver.switchTo().activeElement().getAttribute("title"), "plex-light");
  await driver.switchTo().activeElement().sendKeys(Key.ENTER);
  await driver.wait(async () => (await pressedTitle()) === "plex-light from dashboard-icons", 5000);
  assert.equal(await (await $(".search")).isDisplayed(), false);

  // Aliases count. Enter in the search box picks the first result rather
  // than saving; this icon only comes as a PNG.
  await (await button("Search…")).click();
  await search.clear();
  await search.sendKeys("usenet");
  await driver.wait(async () => (await resultTitles())?.join() === "nzb-get", 5000);
  await search.sendKeys(Key.ENTER);
  await driver.wait(async () => (await pressedSize()) === "128", 5000);
  await $(".editor");

  // Listed as SVG, but there's only a PNG: that's used instead.
  await (await button("Search…")).click();
  await search.clear();
  await search.sendKeys("kodi");
  await driver.wait(async () => (await resultTitles())?.join() === "kodi", 5000);
  await (await $('.results button[title="kodi"]')).click();
  await driver.wait(async () => (await pressedSize()) === "96", 5000);

  // Escape closes the search, not the editor.
  await (await button("Search…")).click();
  await search.sendKeys(Key.ESCAPE);
  assert.equal(await (await $(".search")).isDisplayed(), false);
  await (await $('.choice[title="plex-light from dashboard-icons"]')).click();
  await (await $('button[type="submit"]')).click();
  await $(".tiles");
  assert.match(await svgOf(jellyfin), /class="plex-light"/);
});

test("says so when dashboard-icons can't be reached", async () => {
  await useDashboardIcons(`${sites.dashboardIcons}gone/`);
  // The list is kept while the page is open.
  await driver.executeScript("location.reload()");
  await $(".tiles");
  await menu(`${sites.bravo}jellyfin/`, "Edit");
  await (await button("Search…")).click();
  await driver.wait(async () => /Couldn't reach dashboard-icons/.test(await (await $(".editor .hint")).getText()), 5000);
  // The rest of the editor still works.
  await (await button("Cancel")).click();
  await $(".tiles");
  await useDashboardIcons(sites.dashboardIcons);
});
