// Starts headless Firefox with the built extension and opens the sidebar page
// as a tab. The sidebar panel itself can't be reached over WebDriver: as a
// tab, its buttons load into the tab used before it (see targetTab()).
// Shared by the e2e tests and scripts/screenshots.js.
import { execFileSync } from "node:child_process";
import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const XPI = new URL("../../dist/siderail.xpi", import.meta.url).pathname;
const ADDON_ID = "siderail@jonocodes";
// Pinning the extension's internal UUID gives its pages a known address.
const UUID = "5e0b1a8c-7d2f-4b61-9a3e-51de0a11c0de";
const which = (cmd) => execFileSync("which", [cmd]).toString().trim();

// Returns the driver and the two window handles: siteTab (where sites load)
// and railTab (the sidebar page), with railTab selected.
export async function launch({ firstUrl, prefs = {} } = {}) {
  const options = new firefox.Options()
    .setBinary(process.env.FIREFOX_BIN ?? which("firefox"))
    .addArguments("-headless")
    .setPreference("extensions.webextensions.uuids", JSON.stringify({ [ADDON_ID]: UUID }))
    // Grant optional permissions without a prompt.
    .setPreference("extensions.webextOptionalPermissionPrompts", false);
  for (const [key, value] of Object.entries(prefs)) options.setPreference(key, value);
  const driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    // System access lets us open the extension's page from Firefox's own
    // (chrome) context; WebDriver refuses to navigate a tab to it directly.
    .setFirefoxService(new firefox.ServiceBuilder(which("geckodriver")).addArguments("--allow-system-access"))
    .build();
  await driver.installAddon(XPI, true);
  const siteTab = await driver.getWindowHandle();
  if (firstUrl) await driver.get(firstUrl);
  const railTab = await openPage(driver, "sidebar/sidebar.html");
  return { driver, siteTab, railTab };
}

// Opens one of the extension's pages in a new tab, selects it and returns
// its window handle.
export async function openPage(driver, path) {
  const before = await driver.getAllWindowHandles();
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript(
    "gBrowser.selectedTab = gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });",
    `moz-extension://${UUID}/${path}`,
  );
  await driver.setContext(firefox.Context.CONTENT);
  const tab = (await driver.getAllWindowHandles()).find((h) => !before.includes(h));
  await driver.switchTo().window(tab);
  return tab;
}
