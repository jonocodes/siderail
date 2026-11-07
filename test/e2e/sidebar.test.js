// Drives the real extension in headless Firefox. The sidebar panel itself
// can't be reached over WebDriver, so the test opens the same page as a tab:
// there, buttons load into the tab used before it (see targetTab()).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { startFixtures } from "./fixtures.js";

const XPI = new URL("../../dist/siderail.xpi", import.meta.url).pathname;
const ADDON_ID = "siderail@jonocodes";
// Pinning the extension's internal UUID gives its pages a known address.
const UUID = "5e0b1a8c-7d2f-4b61-9a3e-51de0a11c0de";
const SIDEBAR = `moz-extension://${UUID}/sidebar/sidebar.html`;
const which = (cmd) => execFileSync("which", [cmd]).toString().trim();

let driver;
let sites;
let siteTab;
let railTab;

before(async () => {
  sites = await startFixtures();
  const options = new firefox.Options()
    .setBinary(process.env.FIREFOX_BIN ?? which("firefox"))
    .addArguments("-headless")
    .setPreference("extensions.webextensions.uuids", JSON.stringify({ [ADDON_ID]: UUID }))
    // Grant optional permissions without a prompt.
    .setPreference("extensions.webextOptionalPermissionPrompts", false);
  driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    // System access lets the test open the extension's page from Firefox's own
    // (chrome) context; WebDriver refuses to navigate a tab to it directly.
    .setFirefoxService(new firefox.ServiceBuilder(which("geckodriver")).addArguments("--allow-system-access"))
    .build();
  await driver.installAddon(XPI, true);
  siteTab = await driver.getWindowHandle();
  await driver.get(sites.alpha);
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript(
    "gBrowser.selectedTab = gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });",
    SIDEBAR,
  );
  await driver.setContext(firefox.Context.CONTENT);
  railTab = (await driver.getAllWindowHandles()).find((h) => h !== siteTab);
  await driver.switchTo().window(railTab);
});

after(async () => {
  await driver?.quit();
  await sites?.close();
});

const $ = (css) => driver.wait(until.elementLocated(By.css(css)), 5000);
const tileNames = async () =>
  Promise.all((await driver.findElements(By.css(".tile:not(.preview) .name"))).map((e) => e.getText()));
const activeName = async () => (await $(".tile.active .name")).getText();

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

test("starts empty", async () => {
  assert.match(await (await $(".empty")).getText(), /No sites yet/);
});

test("adds a site with its largest icon and the site's own name", async () => {
  await addCurrentSite();
  assert.equal(await (await $('input[name="name"]')).getAttribute("value"), "Alpha");
  assert.equal(await (await $('input[name="url"]')).getAttribute("value"), sites.alpha);
  const pressed = await $('.choice[aria-pressed="true"]');
  assert.equal(await pressed.getAttribute("data-size"), "512");
  // The 512px and 180px icons are offered; the 16px favicon isn't.
  const sizes = await Promise.all((await driver.findElements(By.css(".choice[data-size]"))).map((e) => e.getAttribute("data-size")));
  assert.deepEqual(sizes, ["512", "180", "letter"]);
  await (await $('button[type="submit"]')).click();
  await $(".tiles");
  assert.deepEqual(await tileNames(), ["Alpha"]);
  assert.equal(await activeName(), "Alpha");
});

test("falls back to a letter when a site has only a small favicon", async () => {
  await goTo(sites.bravo);
  await addCurrentSite();
  assert.equal(await (await $('input[name="name"]')).getAttribute("value"), "Bravo");
  assert.equal(await (await $('.choice[aria-pressed="true"]')).getAttribute("data-size"), "letter");
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

test("right-click menu edits, reorders and removes", async () => {
  const menuFor = async (name) => {
    const tile = await $(`.tile[title="${name === "Alpha" ? sites.alpha : sites.bravo}"]`);
    await driver.actions().contextClick(tile).perform();
    return $(".menu");
  };
  const choose = async (label) => (await driver.findElement(By.xpath(`//div[@class="menu"]/button[.="${label}"]`))).click();

  await menuFor("Bravo");
  await choose("Edit");
  const name = await $('input[name="name"]');
  await name.clear();
  await name.sendKeys("Bravo TV");
  await (await $('button[type="submit"]')).click();
  await driver.wait(async () => (await tileNames()).includes("Bravo TV"), 5000);

  await menuFor("Bravo");
  await choose("Move up");
  await driver.wait(async () => (await tileNames())[0] === "Bravo TV", 5000);

  await menuFor("Alpha");
  await choose("Remove");
  await driver.wait(async () => (await tileNames()).length === 1, 5000);
  assert.deepEqual(await tileNames(), ["Bravo TV"]);
});
