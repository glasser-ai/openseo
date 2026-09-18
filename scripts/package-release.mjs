import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const { version } = readJson("package.json");
assert.match(version, /^\d+\.\d+\.\d+$/, "Release version must use MAJOR.MINOR.PATCH");
if (process.env.RELEASE_TAG) {
  assert.equal(process.env.RELEASE_TAG, `v${version}`, "Tag must match package.json version");
}

const build = new URL(".output/chrome-mv3/", root);
const manifest = readJson(".output/chrome-mv3/manifest.json");
assert.equal(manifest.version, version, "Build version must match package.json");
assert.equal(manifest.name, "OpenSEO");
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.action.default_title, "OpenSEO");
assert.doesNotMatch(JSON.stringify(manifest), /localhost|127\.0\.0\.1|ws:\/\//, "Use a production build");

// Include the project license alongside the dependency and font notices already in public/.
for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  copyFileSync(new URL(file, root), new URL(file, build));
}
for (const file of ["THIRD_PARTY_LICENSES.txt", "fonts/Poppins-OFL.txt", "fonts/KodeMono-OFL.txt"]) {
  assert.ok(readFileSync(new URL(file, build)).length, `Missing license: ${file}`);
}

const filename = `openseo-${version}-chrome.zip`;
const archive = new URL(`.output/${filename}`, root);
rmSync(archive, { force: true });
execFileSync("zip", ["-q", "-r", fileURLToPath(archive), "."], { cwd: fileURLToPath(build) });
const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(new URL(".output/SHA256SUMS", root), `${digest}  ${filename}\n`);
console.log(`Packaged ${filename} with manifest.json at the archive root.`);
