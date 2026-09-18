import { Status } from "./primitives.jsx";
import { AccountSettings, Activity, useSettingsData } from "./settings.jsx";

/**
 * Settings inside the panel.
 *
 * **The same components and the same data** as the standalone settings page (see
 * src/ui/settings), differing only in arrangement: a 560px column has no room
 * for section navigation on the left, so the two sections simply stack and
 * scroll.
 *
 * This is what removes the need to send anyone to another tab — change a Key or
 * a cap in the panel, and go straight back to the numbers.
 */
export function SettingsView() {
  const { data, balance, busy, feedback, perform } = useSettingsData();

  return (
    <div className="flex flex-col gap-4 py-4">
      {feedback && (
        <div className="rounded-token border border-border bg-card p-4">
          <Status bad={feedback.bad}>{feedback.text}</Status>
        </div>
      )}
      {!data ? (
        <Status>Loading settings…</Status>
      ) : (
        <>
          <div id="connection">
            <AccountSettings data={data} balance={balance} busy={busy} perform={perform} />
          </div>
          <Activity data={data} busy={busy} perform={perform} />
        </>
      )}
    </div>
  );
}
