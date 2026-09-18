import { runFailure } from "../glasser/runFailure.js";
import type { Run } from "../glasser/schema.js";
import type { PendingRecord } from "../ledger/store.js";
import { type PanelPayload, writePanel } from "./cache.js";
import { LOOKUPS } from "./lookups.js";
import { extractTraffic, TRAFFIC_ENDPOINT, TRAFFIC_PROVIDER } from "./traffic.js";

/** Save panel answers before releasing their pending request, including recovery. */
export async function persistPanel(
  record: Pick<PendingRecord, "provider" | "endpoint" | "input">,
  run: Run,
): Promise<void> {
  if (runFailure(run)) return;
  let payload: PanelPayload;
  const lookup = LOOKUPS.find(
    (item) => item.provider === record.provider && item.endpoint === record.endpoint,
  );
  if (lookup) {
    const fields = lookup.extract(run.output);
    const keywords = lookup.extractKeywords?.(run.output);
    payload = fields.length
      ? { kind: "fields", fields, ...(keywords ? { keywords } : {}) }
      : { kind: "none", reason: "The Provider has no data for this domain." };
  } else if (record.provider === TRAFFIC_PROVIDER && record.endpoint === TRAFFIC_ENDPOINT) {
    const panel = extractTraffic(run.output);
    payload = panel
      ? { kind: "traffic", panel }
      : { kind: "none", reason: "The Provider has no data for this domain." };
  } else return;
  await writePanel(record.endpoint, record.input, {
    payload,
    runUrl: run.run_url,
    chargeUsd: run.charge_usd,
  });
}

/** Settle old search-result requests without treating their batches as panel reports. */
export async function persistRecoveredPanel(record: PendingRecord, run: Run): Promise<void> {
  if (record.purpose?.kind === "serp") return;
  await persistPanel(record, run);
}
