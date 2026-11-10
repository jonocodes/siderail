import { toBackup, fromBackup } from "../lib/backup.js";
import { merge } from "../lib/sites.js";
import { loadSites, saveSites } from "../storage.js";

const status = document.getElementById("status");
const file = document.getElementById("file");

const count = (n) => `${n} site${n === 1 ? "" : "s"}`;

document.getElementById("export").addEventListener("click", async () => {
  const sites = await loadSites();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([toBackup(sites)], { type: "application/json" }));
  a.download = `siderail-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  // Revoking straight away can cancel the download before it starts.
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  status.textContent = `Exported ${count(sites.length)}.`;
});

document.getElementById("import").addEventListener("click", () => file.click());

file.addEventListener("change", async () => {
  const [chosen] = file.files;
  // So choosing the same file again still counts as a change.
  file.value = "";
  if (!chosen) return;
  try {
    const incoming = fromBackup(await chosen.text());
    const { sites, added, replaced } = merge(await loadSites(), incoming);
    await saveSites(sites);
    status.textContent = incoming.length
      ? `Imported ${count(incoming.length)}: ${added} added, ${replaced} replaced.`
      : "That backup has no sites in it.";
  } catch (e) {
    status.textContent = e.message;
  }
});
