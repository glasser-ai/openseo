import type { Run } from "./schema.js";

/** A failed request is not evidence that the Provider has no data. */
export function runFailure(run: Run): string | null {
  const clause = run.charge_basis?.clause;
  if (run.status !== "COMPLETED" || (clause && !["rule", "NO_RESULT"].includes(clause))) {
    return (
      run.failure?.message ??
      (run.status === "STOPPED"
        ? "The request was stopped. Check Activity for its charge."
        : "The Provider request failed. Check Activity for its charge.")
    );
  }
  return null;
}
