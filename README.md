# Siderail

A Firefox add-on that shows your chosen sites as big buttons in the sidebar. Clicking a button loads that site in the current tab, so one window and one tab can move between sites like channels on a TV.

- One column of buttons that share the sidebar's height: a handful of sites get large buttons with the icon above the name, and many sites shrink to compact rows.
- Large icons only. Small favicons look blurry on a big button, so Siderail finds a site's large icons (its web app manifest, Apple touch icon, SVG icon), or you upload one, or it shows a coloured letter.
- The button for the site in the current tab is highlighted.

It started as a launcher for a living-room PC, but nothing in it is TV-specific: it works just as well as a simple console for someone who only needs a few sites.

<p>
  <img src="docs/screenshot-sidebar.png" alt="The sidebar with seven streaming and self-hosted services as large buttons, Netflix highlighted" width="180">
  &nbsp;
  <img src="docs/screenshot-family.png" alt="The sidebar in light mode with Gmail, Docs, NY Times, Wikipedia and Photos, Gmail highlighted" width="180">
  &nbsp;
  <img src="docs/screenshot-editor.png" alt="Adding Plex: name, address, and a choice of the icons found on the site, a letter tile or an upload" width="180">
</p>

## Using it

- **Add a site:** open it, then press **+ Add this site** at the bottom of the sidebar. Siderail suggests a name, a home address and the best icon it found; change any of them, then **Save**.
- **Open a site:** click its button to load it in the current tab. Ctrl-, Shift- or middle-click opens it in a new tab.
- **Edit, reorder or remove:** right-click a button.
- **Icons:** in the editor, pick any of the icons found, the letter, or **Upload…**. You can also paste or drop an image onto the editor. **Light background behind the icon** puts a white square behind dark logos; Siderail ticks it automatically for mostly-black icons on transparency.

### Permissions

- **Tabs:** to read the current tab's address (for the highlight and for adding sites) and to load sites into it.
- **Storage:** your list of sites, kept on this computer.
- **Access your data for all websites** (optional, asked the first time you add a site): only used to download the page you're adding and its icons, to find a large icon and its name. Without it you can still add sites with an uploaded icon or a letter.

Icons are stored inside the add-on as images, not links, so the sidebar works offline and sites can't see when it's shown.

## Development

Everything runs inside the flox environment, which provides Node, Firefox and geckodriver and installs the npm tools on first activation:

```sh
flox activate
just            # list recipes
just dev        # Firefox with the add-on loaded; your test sites persist in .dev-profile/
just test       # unit tests
just e2e        # end-to-end tests in headless Firefox
just check      # lint + unit + e2e
just build      # dist/siderail.xpi (unsigned)
just screenshots  # regenerate the README screenshots
```

Firefox loads unsigned add-ons temporarily (`just dev`, or `about:debugging`), so signing only matters for a permanent install.

### Layout

- `extension/manifest.json`: Manifest V3, Firefox 142+.
- `extension/sidebar/`: the sidebar page. `sidebar.js` is the UI: the button list, the right-click menu, the editor and icon discovery, which needs the browser.
- `extension/lib/`: pure logic with no browser APIs, all unit-tested:
  - `match.js`: which saved site a tab address belongs to (same host, longest path prefix).
  - `icons.js`: collecting icon candidates from `<link>` tags and the manifest, then ranking them. Icons under 64px are dropped.
  - `names.js`: suggesting a name (manifest, then meta tags, then the page title, then the host) and a home address.
  - `sites.js`: list operations (add or replace, remove, move).
  - `letter.js`, `plate.js`: the letter fallback and the "needs a light background" check.

### Tests

- `test/unit/`: `node --test` against `extension/lib/`.
- `test/e2e/`: Selenium and geckodriver drive the built add-on in headless Firefox against two local fixture sites (`fixtures.js`). One has a manifest and an Apple touch icon; the other has only a 16px favicon. They cover adding sites, the icon ranking, the letter fallback, the highlight, opening a site, and editing, reordering and removing.
  - WebDriver can't reach the real sidebar panel, so the tests open the same page in a tab. There, buttons load into the tab used before it (`targetTab()` in `sidebar.js`).
  - Firefox won't let WebDriver navigate a tab to an extension page, so the test opens it from Firefox's privileged context, which needs geckodriver's `--allow-system-access`.
  - A pref pins the add-on's internal UUID, so its page has a known address.

### Screenshots

`just screenshots` regenerates `docs/screenshot-*.png` from `docs/screenshots.json`, so change that file rather than editing the images. `just screenshots editor` redoes only the shots whose file name contains "editor".

- **What's in them:** the scene file has named site lists (`tv`, `family`) and the shots: which list, the size and theme, the page open in the current tab (its button is highlighted) and, for the editor, the site being added.
- **Icons** come from [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) by name (`"plex"`), or any URL (NY Times is from [selfh.st/icons](https://github.com/selfhst/icons)), pinned to a commit so the images only change when the scene does. Generating them needs internet access for the icons only.
- **How:** `scripts/screenshots.js` reuses the e2e setup (`test/e2e/browser.js`) and sends all of Firefox's traffic through a local proxy that serves a stand-in page for each site, so no real site is visited. Each stand-in's manifest offers the scene's icon, and every site is added through the real **+ Add this site** editor, so icon sizing and the light background are decided by the add-on itself. HSTS preloading and https upgrades are turned off for this.
- Output is byte-identical between runs on the same machine; fonts come from the system, so another machine may differ slightly.

## Design decisions

These were settled while designing it. Revisit them only with a reason.

- **The sidebar, not tabs.** Firefox's own vertical tabs were the obvious alternative. But every site stays loaded (and keeps playing audio in the background), and the icons are small. Siderail keeps one page and swaps what's in it.
- **One column.** A wider sidebar makes bigger buttons, not more columns.
- **Large icons or nothing.** Scaled-up 16px favicons were mocked up and rejected as too blurry. The fallback is a letter tile, never a favicon.
- **No custom layouts.** Letting users supply their own HTML, or load a dashboard site into the sidebar with its links redirected into the main tab, was considered and dropped.
- **Firefox only.** Chrome's side panel can't reopen by itself when the browser starts, which defeats a launcher that should always be there. Chrome also only installs extensions automatically through machine-wide policy.
- **Signing through addons.mozilla.org.** Release Firefox only installs signed add-ons permanently. Building Firefox with signing turned off, or using Developer Edition, was rejected.
- **Parked alternatives.** If signing or installation becomes the blocker:
  - A Tampermonkey userscript avoids signing, but has to draw over every page, fights site layouts, and doesn't run on Firefox's own pages.
  - Firefox AutoConfig (a privileged startup script) could add a real panel without an add-on, but suits a single managed machine only.

## Not done yet

- Searching [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) for an icon, which matters most for self-hosted apps.
- Syncing the list between computers (Firefox Sync's add-on storage is too small for icons, so it would sync the list and re-fetch icons).
- An admin-set list through Firefox's policy file (managed storage), for kiosk and family machines.
- Drag to reorder.
- Signing and publishing on addons.mozilla.org.

## License

[GPL-3.0-or-later](LICENSE).
