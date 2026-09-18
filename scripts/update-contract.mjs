import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const source = "https://glasser.ai/docs/openapi.json";
const health = "https://api.glasser.ai/health";
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}
const [spec, deployed] = await Promise.all([get(source), get(health)]);
// The public docs add navigation metadata; it is not part of the API contract.
for (const path of Object.values(spec.paths)) {
  for (const operation of Object.values(path)) {
    if (operation && typeof operation === "object") delete operation["x-mint"];
  }
}
const snapshot = `${JSON.stringify(spec, null, 2)}\n`;
const hash = createHash("sha256").update(snapshot).digest("hex");
if (hash !== deployed.contract) {
  throw new Error("The public docs and deployed API differ. Snapshot unchanged. Retry after their releases agree.");
}
writeFileSync(new URL("../vendor/openapi.json", import.meta.url), snapshot);
console.log(`Updated the public API contract (${hash}). Run pnpm generate:types and pnpm check-types.`);
