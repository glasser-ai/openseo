import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Shell } from "../Shell.js";

let root: Root;
let container: HTMLElement;
let host: string;
let send: ReturnType<typeof vi.fn>;
let oldRun: ((result: unknown) => void) | undefined;
const entry = (value: string) => ({
  payload: { kind: "fields", fields: [{ label: "Domain Rating", value }] },
  fetchedAt: Date.now(),
  runUrl: "",
  chargeUsd: "0.00",
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Element.prototype.scrollTo = vi.fn();
  host = "first.example";
  oldRun = undefined;
  send = vi.fn(async (message) => {
    if (message.type === "openseo:site") return { url: `https://${host}` };
    if (message.type === "openseo:peek")
      return entry(message.domain === "first.example" ? "42" : "77");
    if (message.type === "openseo:peek-traffic") return null;
    if (message.type === "openseo:traffic") {
      if (message.domain === "first.example")
        return new Promise((resolve) => {
          oldRun = resolve;
        });
      return { ok: false, reason: "No traffic available" };
    }
    return null;
  });
  vi.stubGlobal("chrome", {
    runtime: { sendMessage: send, getManifest: () => ({ version: "0.1.0" }) },
    storage: {
      local: {
        get: async () => ({
          "openseo:key": "gl_test",
          "openseo:settings": { paidAcknowledged: true },
        }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("discards an old domain's pending result after reading another tab", async () => {
  await act(async () => root.render(createElement(Shell)));
  expect(container.textContent).toContain("42");
  host = "second.example";
  await act(async () =>
    (container.querySelector('[aria-label="Reload panel"]') as HTMLButtonElement).click(),
  );
  expect(container.querySelector("h1")?.textContent).toBe("second.example");
  expect(container.textContent).toContain("77");
  await act(async () =>
    oldRun?.({
      ok: true,
      panel: { engagement: { visits: 123456 } },
      fetchedAt: Date.now(),
      chargeUsd: "0.01",
      runUrl: "",
    }),
  );
  expect(container.textContent).not.toContain("123.5K");
  expect(container.textContent).toContain("77");
  expect(send.mock.calls.some(([message]) => message.domain === "")).toBe(false);
});

it("moves report navigation focus without activating a paid report", async () => {
  await act(async () => root.render(createElement(Shell)));
  const overview = container.querySelector("#tab-overview") as HTMLButtonElement;
  const before = send.mock.calls.length;
  await act(async () => {
    overview.focus();
    overview.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  expect(document.activeElement?.id).toBe("tab-traffic");
  expect(overview.getAttribute("aria-current")).toBe("page");
  expect(send.mock.calls).toHaveLength(before);
  expect(container.querySelector("#tab-traffic")?.textContent).toBe("Traffic");
});
