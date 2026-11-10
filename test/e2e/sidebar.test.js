// Drives the real extension in headless Firefox against local fixture sites.
// The tests run in order and share one browser: each starts from the sites
// the ones before it left behind.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { By, Key, until } from "selenium-webdriver";
import { startFixtures, png } from "./fixtures.js";
import { launch } from "./browser.js";

let driver;
let sites;
let siteTab;
let railTab;

before(async () => {
  sites = await startFixtures();
  ({ driver, siteTab, railTab } = await launch({ firstUrl: sites.alpha }));
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

test("an SVG icon found from the editor is kept as SVG, made to scale", async () => {
  await menu(sites.alpha, "Edit");
  await (await button("Find icons on the site")).click();
  await (await $('.choice[data-size="svg"]')).click();
  await (await $('button[type="submit"]')).click();
  const src = await (await $(`.tile[title="${sites.alpha}"] img`)).getAttribute("src");
  assert.match(src, /^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(src.split(",")[1], "base64").toString();
  assert.match(svg, /<circle /);
  assert.match(svg, /viewBox="0 0 100 100"/);
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
