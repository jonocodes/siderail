// Checks addons.mozilla.org API credentials without submitting anything: asks
// AMO whose they are, and if it refuses them, says what looks wrong. Reads
// WEB_EXT_API_KEY and WEB_EXT_API_SECRET, as web-ext does. Prints no secrets.
// Exits non-zero if they won't work.
import { createHmac, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const PROFILE = "https://addons.mozilla.org/api/v5/accounts/profile/";

// Problems that stop the values working whatever AMO says: web-ext uses them
// exactly as given.
export function blockingProblems(key = "", secret = "") {
  const problems = [];
  if (!key) problems.push("WEB_EXT_API_KEY isn't set");
  if (!secret) problems.push("WEB_EXT_API_SECRET isn't set");
  if ((key && key !== key.trim()) || (secret && secret !== secret.trim()))
    problems.push("a value has spaces or a newline at its start or end");
  return problems;
}

// Likely reasons when AMO refuses them. AMO keys look like user:12345678:123
// and secrets are 64 hex characters.
export function formatHints(key, secret) {
  const hints = [];
  if (/^[0-9a-f]{64}$/i.test(key)) hints.push("the key looks like a secret: are the two swapped?");
  else if (!/^user:\d+:\d+$/.test(key)) hints.push("the key (JWT issuer) should look like user:12345678:123");
  if (!/^[0-9a-f]{64}$/i.test(secret) && !/^user:/.test(secret))
    hints.push(`the secret should be 64 hex characters, not ${secret.length}`);
  return hints;
}

// A short-lived token for AMO's API, signed with the secret (HS256).
export function token(key, secret, { now = Math.floor(Date.now() / 1000), jti = randomUUID() } = {}) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${part({ alg: "HS256", typ: "JWT" })}.${part({ iss: key, jti, iat: now, exp: now + 60 })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

async function main() {
  const { WEB_EXT_API_KEY: key = "", WEB_EXT_API_SECRET: secret = "" } = process.env;
  const fail = (lines) => {
    for (const line of lines) console.error(`AMO credentials: ${line}${/[.?]$/.test(line) ? "" : "."}`);
    process.exit(1);
  };
  const blocking = blockingProblems(key, secret);
  if (blocking.length) fail(blocking);
  const res = await fetch(PROFILE, { headers: { Authorization: `JWT ${token(key, secret)}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data.detail ?? JSON.stringify(data)).replace(/\.$/, "");
    fail([`addons.mozilla.org refused them (${res.status}: ${detail})`, ...formatHints(key, secret)]);
  }
  console.log(`AMO credentials work: they belong to "${data.name || data.username}".`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
