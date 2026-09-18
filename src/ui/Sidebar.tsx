import { TAB_LABEL, TABS, type Tab } from "./navigation.js";

/** One outlined icon per section, on a 16px grid, in one style — no emoji. */
const ICON: Record<Tab, string> = {
  overview: "M2.5 8.5 8 3l5.5 5.5M4 7.5V13h8V7.5",
  traffic: "M2.5 11.5 6 8l2.5 2.5L13.5 5M13.5 5H10M13.5 5v3.5",
  search: "M7.2 12a4.8 4.8 0 1 0 0-9.6 4.8 4.8 0 0 0 0 9.6ZM10.7 10.7 14 14",
  backlinks:
    "M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.8.8M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7.5 12l.8-.8",
};

/** The left-hand navigation. Vertical, arrow-key navigable, with the selected
    item filled in near-black. */
/** Settings is pinned to the foot of the navigation. */
export function Sidebar({
  tab,
  onTab,
  settingsOpen,
  onSettings,
}: {
  readonly tab: Tab;
  readonly onTab: (next: Tab) => void;
  readonly settingsOpen: boolean;
  readonly onSettings: () => void;
}) {
  return (
    <nav
      className="report-nav flex w-[132px] shrink-0 flex-col border-r border-border bg-card p-2"
      aria-label="Domain reports"
      onKeyDown={(event) => {
        const delta = ["ArrowDown", "ArrowRight"].includes(event.key)
          ? 1
          : ["ArrowUp", "ArrowLeft"].includes(event.key)
            ? -1
            : 0;
        if (delta === 0) return;
        event.preventDefault();
        const focused = TABS.find((id) => event.target === document.getElementById(`tab-${id}`));
        if (!focused) return;
        const next = TABS[(TABS.indexOf(focused) + delta + TABS.length) % TABS.length];
        if (!next) return;
        document.getElementById(`tab-${next}`)?.focus();
      }}
    >
      {TABS.map((id) => {
        // With Settings open none of the four sections should still be lit —
        // otherwise the screen shows two current locations at once.
        const active = tab === id && !settingsOpen;
        return (
          <button
            key={id}
            id={`tab-${id}`}
            type="button"
            aria-current={active ? "page" : undefined}
            aria-controls="report-panel"
            onClick={() => onTab(id)}
            className={`flex min-h-10 w-full items-center gap-2.5 rounded-sm px-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              active
                ? "bg-primary font-medium text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <svg
              viewBox="0 0 16 16"
              className="size-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d={ICON[id]} />
            </svg>
            <span className="min-w-0 flex-1">{TAB_LABEL[id]}</span>
          </button>
        );
      })}

      <div className="mt-auto border-t border-border pt-2">
        {/* Settings lives inside the panel, so it is a selectable view like the
            four above rather than a link out. */}
        <button
          type="button"
          id="tab-settings"
          aria-current={settingsOpen ? "page" : undefined}
          onClick={onSettings}
          className={`flex min-h-10 w-full items-center gap-2.5 rounded-sm px-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            settingsOpen
              ? "bg-primary font-medium text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <svg
            viewBox="0 0 16 16"
            className="size-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden
          >
            <circle cx="8" cy="8" r="2" />
            <path
              d="M8 1.7v1.6M8 12.7v1.6M14.3 8h-1.6M3.3 8H1.7M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7L3.6 3.6"
              strokeLinecap="round"
            />
          </svg>
          Settings
        </button>
      </div>
    </nav>
  );
}
