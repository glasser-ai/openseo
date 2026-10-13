// Uploads a release ZIP to the Chrome Web Store and submits it for review.
//
//   node scripts/publish-chrome-web-store.mjs <zip> <version>   upload and submit
//   node scripts/publish-chrome-web-store.mjs --status          read-only check
//
// Env: CWS_SERVICE_ACCOUNT_KEY (the JSON key itself), CWS_PUBLISHER_ID,
// CWS_ITEM_ID. Nothing here is OpenSEO-specific, so other extensions can copy
// the file unchanged and set their own CWS_ITEM_ID.
//
// No dependencies: the service account's token is a signed JWT exchanged at
// Google's token endpoint, which node:crypto covers. A Google auth library would
// be the only package the release job installs.
import assert from "node:assert/strict";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const API = "https://chromewebstore.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/chromewebstore";

const env = (name) => {
  const value = process.env[name];
  assert.ok(value, `Missing ${name}`);
  return value;
};
const key = JSON.parse(env("CWS_SERVICE_ACCOUNT_KEY"));
const item = `publishers/${env("CWS_PUBLISHER_ID")}/items/${env("CWS_ITEM_ID")}`;

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: key.client_email,
    scope: SCOPE,
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");
  const response = await fetch(key.token_uri, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const body = await response.json();
  assert.ok(response.ok, `Token request failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

const token = await accessToken();

async function call(method, path, body) {
  const response = await fetch(`${API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}),
    },
    ...(body === undefined ? {} : { body }),
  });
  const text = await response.text();
  assert.ok(response.ok, `${method} ${path} failed with ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

const status = () => call("GET", `v2/${item}:fetchStatus`);

if (process.argv[2] === "--status") {
  console.log(JSON.stringify(await status(), null, 2));
  process.exit(0);
}

const [zip, version] = process.argv.slice(2);
assert.ok(zip && version, "Usage: publish-chrome-web-store.mjs <zip> <version>");

// A version submitted by hand in the Developer Dashboard is already done. The
// store refuses a second upload at the same version, and that refusal would
// mark a good release as failed.
const before = await status();
const versions = (revision) =>
  (revision?.distributionChannels ?? []).map((channel) => channel.crxVersion);
for (const [label, revision] of [
  ["submitted", before.submittedItemRevisionStatus],
  ["published", before.publishedItemRevisionStatus],
]) {
  if (versions(revision).includes(version)) {
    console.log(`${version} is already ${label} (${revision.state}); nothing to upload.`);
    process.exit(0);
  }
}

let upload = await call("POST", `upload/v2/${item}:upload`, readFileSync(zip));
// Large packages are processed after the request returns. Five minutes is far
// beyond what a 1 MB extension takes; past it, failing beats a hung job.
for (let waited = 0; upload.uploadState === "IN_PROGRESS"; waited += 5) {
  assert.ok(waited < 300, "Upload still processing after 5 minutes");
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const current = await status();
  upload = { ...upload, uploadState: current.lastAsyncUploadState };
}
assert.equal(upload.uploadState, "SUCCEEDED", `Upload failed: ${JSON.stringify(upload)}`);
// Checked so a stale or wrong archive cannot be submitted under this release.
if (upload.crxVersion) assert.equal(upload.crxVersion, version, "Uploaded version mismatch");
console.log(`Uploaded ${version}.`);

// DEFAULT_PUBLISH: live as soon as review approves it, with the rollout and
// visibility already set in the Developer Dashboard.
const published = await call(
  "POST",
  `v2/${item}:publish`,
  JSON.stringify({ publishType: "DEFAULT_PUBLISH" }),
);
console.log(`Submitted for review: ${JSON.stringify(published)}`);
