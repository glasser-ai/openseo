import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getBalance } from "../../glasser/client.js";
import { clearKey, DEFAULT_SETTINGS, setKey } from "../../ledger/store.js";
import { AccountSettings, type Snapshot } from "../settings.js";

vi.mock("../../glasser/client.js", () => ({ getBalance: vi.fn() }));
vi.mock("../../ledger/store.js", async (original) => ({
  ...(await original<typeof import("../../ledger/store.js")>()),
  clearKey: vi.fn(),
  setKey: vi.fn(),
}));

let root: Root;
let container: HTMLElement;
const data: Snapshot = {
  hasKey: true,
  settings: DEFAULT_SETTINGS,
  room: { dayRemaining: 0n, monthRemaining: 0n, reserved: 0n },
  pending: [],
  history: [],
};
const perform = async (action: () => Promise<void>) => action();
const button = (text: string) => {
  const found = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
};
const click = async (text: string) => act(async () => button(text).click());
const keyActions = () =>
  container.querySelector<HTMLElement>('summary[aria-label="API Key actions"]')!;
const chooseKeyAction = async (text: string) => {
  await act(async () => keyActions().click());
  expect(container.querySelector("details")?.open).toBe(true);
  await click(text);
};
const enterKey = async (value: string) => {
  await act(async () => {
    const input = container.querySelector("#api-key") as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(AccountSettings, {
        data,
        balance: "Balance $491.12286",
        busy: false,
        perform,
      }),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps the Key until removal is confirmed and supports cancellation", async () => {
  await chooseKeyAction("Remove API Key");
  expect(clearKey).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(button("Cancel"));
  await click("Cancel");
  expect(clearKey).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(keyActions());
  await chooseKeyAction("Remove API Key");
  await click("Confirm removal");
  expect(clearKey).toHaveBeenCalledTimes(1);
});

it("discards a cancelled replacement and requires explicit confirmation to save", async () => {
  await chooseKeyAction("Replace API Key");
  expect(document.activeElement?.id).toBe("api-key");
  await enterKey("gl_cancelled");
  await click("Cancel");
  expect(document.activeElement).toBe(keyActions());
  expect(setKey).not.toHaveBeenCalled();
  expect(getBalance).not.toHaveBeenCalled();
  await chooseKeyAction("Replace API Key");
  expect((container.querySelector("#api-key") as HTMLInputElement).value).toBe("");
  expect(button("Confirm replacement").disabled).toBe(true);
  await enterKey("gl_new");
  expect(setKey).not.toHaveBeenCalled();
  vi.mocked(getBalance).mockResolvedValue({
    kind: "answered",
    value: { available_usd: "10", balance_usd: "10", held_usd: "0" },
    requestId: null,
  });
  await click("Confirm replacement");
  expect(getBalance).toHaveBeenCalledWith("gl_new");
  expect(setKey).toHaveBeenCalledExactlyOnceWith("gl_new");
});

/** With the cap used up the cell is red — at that point lookups really are
    refused. */
it("shows an exhausted budget as bad", () => {
  const meters = [...container.querySelectorAll("[role=meter]")];
  expect(meters.map((meter) => meter.getAttribute("aria-label"))).toEqual([
    "Daily budget used",
    "Monthly budget used",
  ]);
  for (const meter of meters) expect(meter.getAttribute("data-tone")).toBe("bad");
});

/*
 * Reservations block new requests too, so they have to count towards "how much
 * is used". This cell has $0.50 settled against $4.50 reserved: measured as
 * settled over cap it is 10% and neutral, while remaining is already 0 and
 * nothing can be sent at all.
 */
it("counts reservations as spent budget", async () => {
  await act(async () =>
    root.render(
      createElement(AccountSettings, {
        data: {
          ...data,
          room: { dayRemaining: 0n, monthRemaining: 15_000_000n, reserved: 4_500_000n },
        },
        balance: "",
        busy: false,
        perform,
      }),
    ),
  );
  const daily = container.querySelector('[role=meter][aria-label="Daily budget used"]');
  expect(daily?.getAttribute("data-tone")).toBe("bad");
  // The figure prints settled spend ($0.50) while the bar measures settled plus
  // reserved (100%). They are not the same quantity, so the reservation has to be
  // stated beside it — otherwise a full red bar cannot explain that $0.50.
  expect(daily?.getAttribute("aria-valuetext")).toBe("100%, including $4.50 held");
  expect(container.textContent).toContain("$4.50 held");
});

/** A cap of 0 is a legitimate configuration (the screenshot script sets exactly
    that) and cannot be used as a divisor. */
it("draws no budget meter when the cap is zero", async () => {
  await act(async () =>
    root.render(
      createElement(AccountSettings, {
        data: {
          ...data,
          settings: { dailyCapMicros: "0", monthlyCapMicros: "0" },
          room: { dayRemaining: 0n, monthRemaining: 0n, reserved: 0n },
        },
        balance: "",
        busy: false,
        perform,
      }),
    ),
  );
  expect(container.querySelectorAll("[role=meter]")).toHaveLength(0);
});
