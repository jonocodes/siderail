import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { blockingProblems, formatHints, token } from "../../scripts/amo-credentials.js";

const KEY = "user:12345678:123";
const SECRET = "ab".repeat(32);

test("missing values and stray whitespace are caught before asking AMO", () => {
  assert.deepEqual(blockingProblems(KEY, SECRET), []);
  assert.deepEqual(blockingProblems("", ""), ["WEB_EXT_API_KEY isn't set", "WEB_EXT_API_SECRET isn't set"]);
  assert.deepEqual(blockingProblems(`${KEY}\n`, SECRET), ["a value has spaces or a newline at its start or end"]);
  assert.deepEqual(blockingProblems(KEY, ` ${SECRET}`), ["a value has spaces or a newline at its start or end"]);
});

test("when AMO refuses them, the hints point at swapped or mistyped values", () => {
  assert.deepEqual(formatHints(KEY, SECRET), []);
  assert.deepEqual(formatHints(SECRET, KEY), ["the key looks like a secret: are the two swapped?"]);
  assert.deepEqual(formatHints("JWT issuer: user:1:2", "abc"), [
    "the key (JWT issuer) should look like user:12345678:123",
    "the secret should be 64 hex characters, not 3",
  ]);
});

test("the token is an HS256 JWT for the key, valid for a minute, signed with the secret", () => {
  const jwt = token(KEY, SECRET, { now: 1_000_000, jti: "an-id" });
  const [header, payload, signature] = jwt.split(".");
  const read = (part) => JSON.parse(Buffer.from(part, "base64url").toString());
  assert.deepEqual(read(header), { alg: "HS256", typ: "JWT" });
  assert.deepEqual(read(payload), { iss: KEY, jti: "an-id", iat: 1_000_000, exp: 1_000_060 });
  assert.equal(signature, createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url"));
});
