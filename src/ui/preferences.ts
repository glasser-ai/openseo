import type { Settings } from "../ledger/store.js";

/** All settings writes share the worker queue with spending decisions. */
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const reply = await chrome.runtime.sendMessage({ type: "openseo:settings", patch });
  if (!reply?.ok) throw new Error(reply?.reason ?? "Settings could not be saved.");
}
