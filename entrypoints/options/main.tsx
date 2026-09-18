import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/ui/style.css";
import type { SettingsSection } from "../../src/ui/navigation.js";
import { Status } from "../../src/ui/primitives.jsx";
import { AccountSettings, Activity, SECTIONS, useSettingsData } from "../../src/ui/settings.jsx";

const sectionFromHash = (): SettingsSection =>
  SECTIONS.find(([id]) => `#${id}` === location.hash)?.[0] ?? "connection";

/**
 * The standalone settings page: a wide layout with section navigation on the
 * left.
 *
 * The data, the actions and each section's contents all come from
 * src/ui/settings — Settings inside the panel uses **the same components** in a
 * different arrangement. Written separately, one copy would fall behind.
 */
function Options() {
  const [section, setSection] = useState(sectionFromHash);
  // Called once. Calling it twice yields two unrelated pieces of state — perform
  // would refresh the other one, and the numbers on screen would not move.
  const { data, balance, busy, feedback, setFeedback, perform } = useSettingsData();

  useEffect(() => {
    const hash = () => {
      setSection(sectionFromHash());
      setFeedback(null);
    };
    window.addEventListener("hashchange", hash);
    return () => window.removeEventListener("hashchange", hash);
  }, [setFeedback]);

  return (
    <main className="options-layout">
      <aside>
        <a href="#connection" className="flex items-center gap-2 text-section font-semibold">
          <img src="/icon/32.png" alt="" className="size-6" />
          OpenSEO
        </a>
        <p className="mt-2 text-small text-muted-foreground">Settings and activity</p>
        <nav className="options-nav mt-6" aria-label="Settings">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} aria-current={section === id ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <h1 className="mb-5 text-hero font-semibold tracking-tight">
          {SECTIONS.find(([id]) => id === section)?.[1]}
        </h1>
        {feedback && (
          <div className="mb-4 rounded-token border border-border bg-card p-4">
            <Status bad={feedback.bad}>{feedback.text}</Status>
          </div>
        )}
        {!data ? (
          <Status>Loading settings…</Status>
        ) : (
          <div className="space-y-4">
            {section === "connection" && (
              <AccountSettings data={data} balance={balance} busy={busy} perform={perform} />
            )}
            {section === "activity" && <Activity data={data} busy={busy} perform={perform} />}
          </div>
        )}
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Options />);
