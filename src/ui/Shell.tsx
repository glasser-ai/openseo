import { useEffect, useRef, useState } from "react";
import type { Tab } from "./navigation.js";
import { Report } from "./Report.jsx";
import { SettingsView } from "./SettingsView.jsx";
import { Sidebar } from "./Sidebar.jsx";
import { useReport } from "./useReport.js";
import { type SiteState, useSite } from "./useSite.js";
import { useThemeIcon } from "./useThemeIcon.js";

/** An icon button in the header. Outlined SVG at the sidebar's stroke width,
    with a 32px hit area. */
function IconButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <svg
        viewBox="0 0 16 16"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <title>{label}</title>
        {children}
      </svg>
    </button>
  );
}

export function Shell() {
  useThemeIcon();
  const { state, reload } = useSite();
  const [tab, setTab] = useState<Tab>("overview");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connection, setConnection] = useState<{ hasKey: boolean; revision: number } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const unavailable = new URLSearchParams(location.search).has("unavailable");
  const close = () => {
    if (window.parent !== window) window.parent.postMessage({ type: "openseo:close" }, "*");
    else window.close();
  };
  useEffect(() => {
    let live = true;
    const read = () =>
      void chrome.storage.local
        .get("openseo:key")
        .then((bag) => {
          if (live)
            setConnection((old) => ({
              hasKey:
                typeof bag["openseo:key"] === "string" && bag["openseo:key"].trim().length > 0,
              revision: (old?.revision ?? 0) + 1,
            }));
        })
        .catch(() => {
          if (live) setConnection({ hasKey: false, revision: 0 });
        });
    read();
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && "openseo:key" in changes) read();
    };
    chrome.storage.onChanged.addListener(changed);
    return () => {
      live = false;
      chrome.storage.onChanged.removeListener(changed);
    };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const select = (next: Tab) => {
    setSettingsOpen(false);
    setTab(next);
    scroll.current?.scrollTo({ top: 0 });
  };

  const domain = state.kind === "ready" && !unavailable ? state.host : "";

  return (
    <div className="flex h-dvh min-w-0 flex-col bg-background">
      {/*
        One line. It used to be three: the product name, the domain, and
        "Connected to glasser" — nearly 100px of height without a single number.
        The product name is already on the toolbar icon, and connection state
        belongs to the settings page (without a Key the body says so itself).
        What is left is the one thing this screen has to identify: the domain.
      */}
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border bg-card px-4 py-2.5">
        <img src="/icon/32.png" alt="OpenSEO" className="size-5 shrink-0" />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="min-w-0 truncate text-body font-semibold tracking-tight">
            {state.kind === "ready" && !unavailable ? state.host : "Domain inspector"}
          </h1>
          <span className="shrink-0 text-small text-muted-foreground" title="OpenSEO version">
            v{chrome.runtime.getManifest().version}
          </span>
        </div>
        <button
          type="button"
          aria-label="Reload panel"
          title="Reload this panel using saved results where available"
          disabled={state.kind === "loading"}
          onClick={reload}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-2 text-small text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-wait"
        >
          <svg
            viewBox="0 0 16 16"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M13.5 8a5.5 5.5 0 1 1-1.7-4M13 1.5V5H9.5" />
          </svg>
          {state.kind === "loading" ? "Reloading…" : "Reload panel"}
        </button>
        <IconButton label="Close panel" onClick={close}>
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </IconButton>
      </header>
      <ReportWorkspace
        key={`${domain}:${connection?.revision ?? 0}`}
        domain={domain}
        state={state}
        connection={connection}
        unavailable={unavailable}
        tab={tab}
        settingsOpen={settingsOpen}
        scroll={scroll}
        select={select}
        onSettings={() => {
          setSettingsOpen(true);
          scroll.current?.scrollTo({ top: 0 });
        }}
        close={close}
      />
    </div>
  );
}

/** Reset results and in-flight callbacks together when the domain or Key changes. */
function ReportWorkspace({
  domain,
  state,
  connection,
  unavailable,
  tab,
  settingsOpen,
  scroll,
  select,
  onSettings,
  close,
}: {
  readonly domain: string;
  readonly state: SiteState;
  readonly connection: { hasKey: boolean; revision: number } | null;
  readonly unavailable: boolean;
  readonly tab: Tab;
  readonly settingsOpen: boolean;
  readonly scroll: React.RefObject<HTMLDivElement | null>;
  readonly select: (tab: Tab) => void;
  readonly onSettings: () => void;
  readonly close: () => void;
}) {
  const report = useReport(domain, connection?.hasKey === true);
  return (
    <div className="report-workspace flex min-h-0 flex-1">
      <Sidebar tab={tab} onTab={select} settingsOpen={settingsOpen} onSettings={onSettings} />
      <div
        ref={scroll}
        id="report-panel"
        role="region"
        aria-labelledby={settingsOpen ? "tab-settings" : `tab-${tab}`}
        tabIndex={0}
        className="scroll-area min-w-0 flex-1 px-4"
      >
        {unavailable || state.kind === "failed" ? (
          <div className="report-card my-5">
            <h2 className="text-section font-semibold tracking-tight">
              This page cannot be inspected
            </h2>
            <p className="mt-2 text-muted-foreground">
              Open a regular website, then select OpenSEO again. Chrome pages and the Chrome Web
              Store do not allow this panel.
            </p>
            <button type="button" className="button button-secondary mt-4" onClick={close}>
              Close
            </button>
          </div>
        ) : state.kind === "loading" || connection === null ? (
          <div className="flex flex-col gap-4 py-4" role="status" aria-label="Reading this tab">
            {[0, 1].map((index) => (
              <div key={index} className="report-card">
                <div className="h-4 w-32 animate-pulse rounded-sm bg-muted" />
                <div className="mt-4 h-7 w-28 animate-pulse rounded-sm bg-muted" />
                <div className="mt-2 h-3 w-20 animate-pulse rounded-sm bg-muted" />
              </div>
            ))}
          </div>
        ) : settingsOpen ? (
          <SettingsView />
        ) : (
          <Report
            report={report}
            onSettings={onSettings}
            domain={state.host}
            hasKey={connection.hasKey}
            tab={tab}
            onTab={select}
          />
        )}
      </div>
    </div>
  );
}
