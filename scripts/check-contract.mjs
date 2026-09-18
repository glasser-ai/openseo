/**
 * The upstream drift guard — something the local check (regenerate the types and
 * diff) can never catch: as long as nobody touches vendor/openapi.json it agrees
 * with itself perfectly, while the live contract has moved on.
 *
 * The `contract` reported by /health is the sha256 of the API definition **that
 * process is actually running**, serialised the same way the published
 * openapi.json is — so the two are byte-comparable with `sha256sum
 * openapi.json`.
 *
 * A mismatch is a **hard failure**. This guard is either exact or eventually
 * deleted — the usual "fix" for a guard that cries wolf daily is to remove it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const HEALTH_URL = process.env.GLASSER_HEALTH_URL ?? "https://api.glasser.ai/health";
const SNAPSHOT = new URL("../vendor/openapi.json", import.meta.url);

const local = createHash("sha256").update(readFileSync(SNAPSHOT)).digest("hex");

let deployed;
try {
  const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${HEALTH_URL} answered ${response.status}`);
  deployed = (await response.json()).contract;
} catch (error) {
  console.error(`✗ could not read the deployed contract hash from ${HEALTH_URL}`);
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (typeof deployed !== "string" || deployed.length === 0) {
  console.error(`✗ ${HEALTH_URL} returned no "contract" field.`);
  process.exit(1);
}

if (local !== deployed) {
  console.error("✗ vendor/openapi.json is not the contract production is serving.\n");
  console.error(`  vendored: ${local}`);
  console.error(`  deployed: ${deployed}\n`);
  console.error("  Refresh it, then let the type check tell you what actually broke:");
  console.error("    pnpm update:contract");
  console.error("    pnpm generate:types && pnpm check-types\n");
  process.exit(1);
}

console.log(`✓ vendor/openapi.json matches the deployed contract (${local.slice(0, 12)}…)`);
