// Replaces the addons.mozilla.org listing's screenshots with the ones in
// release/screenshots/, in the order and with the captions of the "amo"
// shots in docs/screenshots.json. New ones are uploaded before the old ones
// are deleted, so a failure part-way leaves the listing with screenshots.
// Reads WEB_EXT_API_KEY and WEB_EXT_API_SECRET.
import fs from "node:fs/promises";
import { blockingProblems, token } from "./amo-credentials.js";

const read = async (path) => JSON.parse(await fs.readFile(new URL(path, import.meta.url), "utf8"));
const scene = await read("../docs/screenshots.json");
const { id } = (await read("../extension/manifest.json")).browser_specific_settings.gecko;
const ADDON = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(id)}/`;

const { WEB_EXT_API_KEY: key = "", WEB_EXT_API_SECRET: secret = "" } = process.env;
const problems = blockingProblems(key, secret);
if (problems.length) {
  for (const p of problems) console.error(`AMO credentials: ${p}.`);
  process.exit(1);
}

// One API call, with a fresh token each time (AMO refuses a reused one).
// AMO allows each account 3 edits a minute, 10 an hour and 24 a day
// (uploads, captions and deletions all count, as do release submissions), so
// a throttled call waits as long as AMO asks, up to an hour, and tries again.
async function api(path, { method = "GET", form, json } = {}) {
  for (let attempt = 1; ; attempt++) {
    const headers = { Authorization: `JWT ${token(key, secret)}` };
    let body = form;
    if (json) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(json);
    }
    const res = await fetch(ADDON + path, { method, headers, body });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.status === 429 && attempt < 10) {
      const seconds = Number(res.headers.get("retry-after")) || Number(data?.detail?.match(/(\d+) seconds?/)?.[1]) || 60;
      console.log(`AMO asked to wait ${seconds}s before ${method} ${path || "the add-on"}...`);
      await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${ADDON + path}: ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
}

const old = (await api("")).previews ?? [];
for (const [position, shot] of scene.amo.shots.entries()) {
  const image = await fs.readFile(new URL(`../release/screenshots/${shot.file}`, import.meta.url));
  const form = new FormData();
  form.append("image", new Blob([image], { type: "image/png" }), shot.file);
  form.append("position", String(position));
  const preview = await api("previews/", { method: "POST", form });
  // AMO only takes a caption once the image exists.
  await api(`previews/${preview.id}/`, { method: "PATCH", json: { caption: { "en-US": shot.caption }, position } });
  console.log(`uploaded ${shot.file}`);
}
for (const preview of old) await api(`previews/${preview.id}/`, { method: "DELETE" });
console.log(`The listing now has ${scene.amo.shots.length} screenshots (${old.length} old ones removed).`);
