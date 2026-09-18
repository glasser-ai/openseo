import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { LOOKUPS, REPORT_TITLE } from "../domain/lookups.js";
import { toneOf } from "../domain/thresholds.js";
import { TRAFFIC_ENDPOINT } from "../domain/traffic.js";
import { getBalance } from "../glasser/client.js";
import { formatUsd, microsToUsd, usdToMicros } from "../ledger/micros.js";
import {
  allPending,
  clearKey,
  getHistory,
  getKey,
  getSettings,
  type Headroom,
  headroom,
  type PendingRecord,
  type Settings,
  type SettledCharge,
  setKey,
} from "../ledger/store.js";
import { Meter } from "./charts.jsx";
import type { SettingsSection } from "./navigation.js";
import { TONE_TEXT } from "./palette.js";
import { saveSettings } from "./preferences.js";
import { Card, Heading, Prose, Status } from "./primitives.jsx";

export const SECTIONS: readonly [SettingsSection, string][] = [
  ["connection", "Connection"],
  ["activity", "Activity"],
];
/** One money formatter for the whole product. */
const money = (value: string | bigint) => formatUsd(BigInt(value));
/**
 * "Sep 17, 1:48 PM". No year — this column shares a 528px row with the domain
 * and the Provider, and the year is almost always the current one; where it
 * genuinely matters, hovering the row shows the full endpoint path.
 */
const date = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
/** Names come from the same table the panel uses, so one charge cannot go by
    two names in two places. */
const feature = (endpoint: string) => {
  if (endpoint === TRAFFIC_ENDPOINT) return REPORT_TITLE.traffic;
  const id = LOOKUPS.find((lookup) => lookup.endpoint === endpoint)?.id;
  return id ? REPORT_TITLE[id] : "Domain lookup";
};
export type Snapshot = {
  settings: Settings;
  hasKey: boolean;
  room: Headroom;
  pending: PendingRecord[];
  history: SettledCharge[];
};

export type Feedback = { text: string; bad: boolean } | null;

export type Actions = {
  busy: boolean;
  perform: (action: () => Promise<void>, success: string) => Promise<void>;
};

/**
 * The data and actions for settings. **Shared by both surfaces** — the separate
 * options page, and the section inside the panel.
 *
 * The reason for extracting it is plain: Settings in the panel used to send
 * people to another tab, and that page read the same storage and rendered the
 * same sections. Written twice, one copy falls behind sooner or later.
 */
export function useSettingsData() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [balance, setBalance] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const knownKey = useRef<string | undefined>(undefined);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const [settings, key, room, pending, history] = await Promise.all([
      getSettings(),
      getKey(),
      headroom(),
      allPending(),
      getHistory(),
    ]);
    if (!mounted.current) return;
    setData({ settings, hasKey: !!key, room, pending, history });
    if (key !== knownKey.current) {
      knownKey.current = key;
      setBalance(key ? "Checking connection…" : "");
      if (key) {
        const result = await getBalance(key);
        if (mounted.current && knownKey.current === key)
          setBalance(
            result.kind === "answered"
              ? `Balance $${result.value.available_usd}`
              : "Connection unavailable. Check your Key or try again later.",
          );
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const read = () =>
      void refresh().catch(() => {
        if (mounted.current)
          setFeedback({ text: "Settings could not be read. Try again.", bad: true });
      });
    read();
    const changed = (_changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local") read();
    };
    chrome.storage.onChanged.addListener(changed);
    return () => {
      mounted.current = false;
      chrome.storage.onChanged.removeListener(changed);
    };
  }, [refresh]);

  const perform = async (action: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      await refresh();
      setFeedback({ text: success, bad: false });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "The change could not be saved. Try again.",
        bad: true,
      });
    } finally {
      setBusy(false);
    }
  };

  return { data, balance, busy, feedback, setFeedback, perform };
}

export function AccountSettings({
  data,
  balance,
  busy,
  perform,
}: { data: Snapshot; balance: string } & Actions) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <Heading>Connection</Heading>
        <Connection hasKey={data.hasKey} balance={balance} busy={busy} perform={perform} />
        <div className="mt-4 border-t border-border pt-3">
          <SpentSummary data={data} />
        </div>
      </Card>
      <SpendingSettings settings={data.settings} busy={busy} perform={perform} />
    </div>
  );
}

function SpendingSettings({ settings, busy, perform }: { settings: Settings } & Actions) {
  const [daily, setDaily] = useState("");
  const [monthly, setMonthly] = useState("");
  useEffect(() => {
    setDaily(microsToUsd(BigInt(settings.dailyCapMicros)));
    setMonthly(microsToUsd(BigInt(settings.monthlyCapMicros)));
  }, [settings.dailyCapMicros, settings.monthlyCapMicros]);
  return (
    <Card>
      <h2 className="text-small font-medium">Estimated budgets · USD</h2>
      <form
        className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            const day = usdToMicros(daily);
            const month = usdToMicros(monthly);
            if (day < 0n || month < 0n) throw new Error("Budgets must be zero or more.");
            await saveSettings({
              dailyCapMicros: day.toString(),
              monthlyCapMicros: month.toString(),
            });
          }, "Budgets saved.");
        }}
      >
        <label className="block text-small text-muted-foreground">
          Daily
          <input
            className="field mono mt-1 min-h-8 px-2 py-1"
            inputMode="decimal"
            value={daily}
            disabled={busy}
            required
            onChange={(event) => setDaily(event.target.value)}
          />
        </label>
        <label className="block text-small text-muted-foreground">
          Monthly
          <input
            className="field mono mt-1 min-h-8 px-2 py-1"
            inputMode="decimal"
            value={monthly}
            disabled={busy}
            required
            onChange={(event) => setMonthly(event.target.value)}
          />
        </label>
        <button
          className="button button-secondary min-h-8 px-3 py-1 text-small"
          type="submit"
          disabled={busy}
        >
          Save
        </button>
      </form>
    </Card>
  );
}

function Connection({
  hasKey,
  balance,
  busy,
  perform,
}: { hasKey: boolean; balance: string } & Actions) {
  const [input, setInput] = useState("");
  const [show, setShow] = useState(false);
  const [action, setAction] = useState<"replace" | "remove" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRemovalRef = useRef<HTMLButtonElement>(null);
  const keyActionsRef = useRef<HTMLDetailsElement>(null);
  const keyActionsTriggerRef = useRef<HTMLElement>(null);
  const previousAction = useRef(action);

  useEffect(() => {
    if (action === "replace") inputRef.current?.focus();
    if (action === "remove") cancelRemovalRef.current?.focus();
    if (action === null && previousAction.current !== null) keyActionsTriggerRef.current?.focus();
    previousAction.current = action;
  }, [action]);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const menu = keyActionsRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target))
        menu.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  const cancel = () => {
    setInput("");
    setShow(false);
    setAction(null);
  };
  return (
    <div className="mt-3">
      {hasKey && (
        <div className="flex items-center gap-2">
          <p role="status" className="min-w-0 flex-1 font-medium">
            {balance || "Key saved"}
          </p>
          {action === null && (
            <details
              ref={keyActionsRef}
              className="relative shrink-0"
              onKeyDown={(event) => {
                if (event.key !== "Escape" || !event.currentTarget.open) return;
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.open = false;
                keyActionsTriggerRef.current?.focus();
              }}
            >
              <summary
                ref={keyActionsTriggerRef}
                aria-label="API Key actions"
                aria-disabled={busy}
                title="API Key actions"
                className="flex size-7 list-none items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:bg-muted hover:text-muted-foreground [&::-webkit-details-marker]:hidden"
                onClick={(event) => {
                  if (busy) event.preventDefault();
                }}
              >
                <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden="true">
                  <circle cx="3" cy="8" r="1" />
                  <circle cx="8" cy="8" r="1" />
                  <circle cx="13" cy="8" r="1" />
                </svg>
              </summary>
              <div className="absolute right-0 top-full z-10 mt-1 w-max rounded-sm border border-border bg-card p-1 shadow-sm">
                <button
                  type="button"
                  aria-label="Replace API Key"
                  className="block w-full rounded-sm px-3 py-1.5 text-left text-small text-muted-foreground hover:bg-muted"
                  disabled={busy}
                  onClick={() => setAction("replace")}
                >
                  Replace API Key
                </button>
                <button
                  type="button"
                  aria-label="Remove API Key"
                  className="block w-full rounded-sm px-3 py-1.5 text-left text-small text-muted-foreground hover:bg-muted"
                  disabled={busy}
                  onClick={() => setAction("remove")}
                >
                  Remove API Key
                </button>
              </div>
            </details>
          )}
        </div>
      )}
      {(!hasKey || action === "replace") && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              const key = input.trim();
              if (!key.startsWith("gl_") || key.length < 4)
                throw new Error("Enter a glasser Key that starts with gl_.");
              const outcome = await getBalance(key);
              if (outcome.kind !== "answered")
                throw new Error(
                  outcome.kind === "refused"
                    ? outcome.message
                    : "Could not verify this Key. Check your connection and try again.",
                );
              await setKey(key);
              cancel();
            }, "Key saved. Return to your website; the open panel is ready.");
          }}
        >
          <label htmlFor="api-key" className="block font-medium">
            API Key
          </label>
          <input
            ref={inputRef}
            id="api-key"
            className="field mono"
            type={show ? "text" : "password"}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="gl_…"
            required
            aria-describedby="key-help"
          />
          <label className="flex items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={show}
              onChange={(event) => setShow(event.target.checked)}
            />
            Show Key
          </label>
          <p id="key-help" className="text-small text-muted-foreground">
            Need a Key?{" "}
            <a
              className="underline"
              href="https://app.glasser.ai/keys?utm_source=openseo&utm_medium=extension&utm_campaign=onboarding&utm_content=connection"
              target="_blank"
              rel="noopener noreferrer"
            >
              Get a glasser Key ↗
            </a>
          </p>
          <button type="submit" className="button button-primary" disabled={busy || !input.trim()}>
            {busy ? "Checking…" : hasKey ? "Confirm replacement" : "Connect glasser"}
          </button>
        </form>
      )}
      {hasKey && action === "remove" && (
        <div className="mt-3 space-y-3" role="group" aria-label="Confirm Key removal">
          <p className="text-small" id="remove-key-help">
            Remove this Key from OpenSEO? New paid lookups will stop. Your saved results will stay,
            and the Key will remain active in glasser.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              aria-describedby="remove-key-help"
              onClick={() =>
                void perform(async () => {
                  await clearKey();
                  cancel();
                }, "Key removed. Your saved results are still available.")
              }
            >
              {busy ? "Removing…" : "Confirm removal"}
            </button>
            <button
              ref={cancelRemovalRef}
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={cancel}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {hasKey && action === "replace" && (
        <button
          type="button"
          className="mt-2 py-1 text-small text-muted-foreground hover:text-foreground"
          disabled={busy}
          onClick={cancel}
        >
          Cancel
        </button>
      )}
    </div>
  );
}

/** One settled charge, compressed to a single row. */
function ChargeRow({ entry }: { entry: SettledCharge }) {
  return (
    <li className="flex items-baseline gap-3 border-t border-border py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate">{feature(entry.endpoint)}</span>
        <span className="block truncate text-small text-muted-foreground" title={entry.endpoint}>
          {(entry.domains ?? []).join(", ") || "—"} · {entry.provider} · {date(entry.at)}
        </span>
      </span>
      <span className="shrink-0 whitespace-nowrap tabular-nums">
        {entry.chargeReported === false ? (
          <span className="text-small text-muted-foreground">not reported</span>
        ) : (
          money(entry.chargeMicros)
        )}
      </span>
      <a
        className="mono shrink-0 text-small text-muted-foreground hover:text-foreground"
        href={entry.runUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open this Run"
      >
        ↗
      </a>
    </li>
  );
}

/** Spent = cap - remaining - reserved. All three numbers were there; nobody had
    ever subtracted them. */
const spent = (cap: string, remaining: bigint, reserved: bigint): bigint => {
  const value = BigInt(cap) - remaining - reserved;
  return value > 0n ? value : 0n;
};

/**
 * How much of the budget is used — **measured from remaining, not from spend**.
 *
 * These are not the same number. headroom() computes dayRemaining as cap minus
 * settled minus reserved, and reserve() uses exactly that to decide whether to
 * refuse a new request. That is to say **reservations block lookups too**.
 * The spent() above cancels down to the settled part alone, which under-reports
 * as a numerator: with a $5 cap, $0.50 settled and $4.50 reserved it would read
 * "10% used" — while remaining is already 0 and no lookup can be sent at all.
 *
 * Clamped to [0,1]: remaining goes negative when a settlement overshoots its own
 * reservation.
 */
const used = (cap: string, remaining: bigint): number => {
  const total = Number(cap);
  if (!(total > 0)) return 0; // A cap can legitimately be 0, which cannot divide.
  return Math.max(0, Math.min(1, (total - Number(remaining)) / total));
};

/**
 * One budget cell.
 *
 * This used to be three bare numbers with no denominators — the same defect as a
 * bare 71 on the report side: whether $1.20 is a lot depends on whether the cap
 * is $5 or $50, and the cap was nowhere beside it.
 */
function BudgetCell({
  caption,
  meterLabel,
  cap,
  remaining,
  reserved,
}: {
  readonly caption: string;
  readonly meterLabel: string;
  readonly cap: string;
  readonly remaining: bigint;
  readonly reserved: bigint;
}) {
  const ratio = used(cap, remaining);
  const tone = toneOf("budget-used", ratio);
  const capped = BigInt(cap) > 0n;
  const pct = `${Math.round(ratio * 100)}%`;
  /*
   * The figure prints **settled spend** while the meter measures **settled plus
   * reserved**. They are not the same quantity, so a non-zero reservation has to
   * be stated — otherwise "$0.50 · of $5.00" sits beside a full red bar while a
   * screen reader announces "Daily budget used, 100%", and all three contradict
   * one another.
   * "Held" is the product's own word for it (glasser balance prints Balance,
   * Held and Available).
   */
  const held = reserved > 0n ? money(reserved) : null;
  return (
    <div>
      <div className={`text-section font-semibold leading-none tabular-nums ${TONE_TEXT[tone]}`}>
        {money(spent(cap, remaining, reserved))}
      </div>
      <div className="mt-1 text-small text-muted-foreground">
        {capped ? `${caption} · of ${money(cap)}` : caption}
      </div>
      {held && <div className="text-small text-muted-foreground">{held} held</div>}
      {capped && (
        <Meter
          value={ratio * 100}
          label={meterLabel}
          valueText={held ? `${pct}, including ${held} held` : pct}
          tone={tone}
        />
      )}
    </div>
  );
}

function SpentSummary({ data }: { data: Snapshot }) {
  return (
    <>
      <h3 className="text-small font-medium">Spent</h3>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-3">
        <BudgetCell
          caption="today"
          meterLabel="Daily budget used"
          cap={data.settings.dailyCapMicros}
          remaining={data.room.dayRemaining}
          reserved={data.room.reserved}
        />
        <BudgetCell
          caption="this month"
          meterLabel="Monthly budget used"
          cap={data.settings.monthlyCapMicros}
          remaining={data.room.monthRemaining}
          reserved={data.room.reserved}
        />
        <div>
          {/* A count of charges is unbounded, with no cap and no direction — no
              colour and no meter. */}
          <div className="text-section font-semibold leading-none tabular-nums">
            {data.history.length}
          </div>
          <div className="mt-1 text-small text-muted-foreground">charges recorded</div>
        </div>
      </div>
    </>
  );
}

const FIRST_CHARGES = 12;

export function Activity({ data, busy, perform }: { data: Snapshot } & Actions) {
  const [all, setAll] = useState(false);
  const shown = all ? data.history : data.history.slice(0, FIRST_CHARGES);

  return (
    <>
      {/* Having no unfinished requests is the normal case, so this takes one row
          rather than a whole card. */}
      {data.pending.length > 0 && (
        <Card>
          <Heading>Unfinished requests</Heading>
          <ul className="mt-3">
            {data.pending.map((record) => (
              <li className="border-t border-border py-3" key={record.idemKey}>
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{feature(record.endpoint)}</span>
                    <span className="block truncate text-small text-muted-foreground">
                      {record.domains.join(", ")} · {date(record.dispatchedAt)}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-small ${
                      record.state === "suspended" ? "text-warn-text" : "text-muted-foreground"
                    }`}
                  >
                    {record.state === "suspended" ? "Needs attention" : "In progress"}
                  </span>
                  {record.runUrl && (
                    <a
                      className="mono shrink-0 text-small text-muted-foreground hover:text-foreground"
                      href={record.runUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open this Run"
                    >
                      ↗
                    </a>
                  )}
                </div>
                <p className="mt-1 text-small text-muted-foreground">
                  {money(record.reservedMicros)} reserved ·{" "}
                  {record.reason ?? "Waiting for the Provider."}
                </p>
                {record.state === "suspended" && (
                  <Details title="Release this reservation">
                    <p>
                      The request may already have been charged. Releasing its reservation does not
                      cancel or refund it.
                    </p>
                    <button
                      type="button"
                      className="button button-secondary mt-3"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          const reply = await chrome.runtime.sendMessage({
                            type: "openseo:write-off",
                            idemKey: record.idemKey,
                          });
                          if (!reply?.ok)
                            throw new Error(
                              reply?.reason ?? "The reservation could not be released.",
                            );
                        }, "Reservation released. Any Provider charge remains in effect.")
                      }
                    >
                      Release reservation
                    </button>
                  </Details>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <div className="flex items-baseline gap-2">
          <Heading>Recent charges</Heading>
          {data.pending.length === 0 && (
            <span className="ml-auto text-small text-muted-foreground">nothing unfinished</span>
          )}
        </div>
        {data.history.length === 0 ? (
          <Prose>No charges yet. Lookups you run will appear here with their Run links.</Prose>
        ) : (
          <>
            <ul className="mt-3">
              {shown.map((entry) => (
                <ChargeRow key={entry.runId} entry={entry} />
              ))}
            </ul>
            {data.history.length > FIRST_CHARGES && (
              <button
                type="button"
                onClick={() => setAll(!all)}
                className="mt-3 text-small text-muted-foreground hover:text-foreground"
              >
                {all ? "Show fewer" : `Show all ${data.history.length}`}
              </button>
            )}
          </>
        )}
      </Card>
    </>
  );
}

export function Details({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="mt-4 text-small text-muted-foreground">
      <summary className="py-1">{title}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
