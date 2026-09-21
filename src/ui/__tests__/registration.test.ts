import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Registration } from "../Registration.js";

let root: Root;
let container: HTMLElement;
let answer: (reply: unknown) => void;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: vi.fn(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      ),
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = async () => {
  await act(async () => {
    root.render(createElement(Registration, { domain: "www.rdap.org" }));
  });
};

const card = () => container.querySelector("section");

/*
 * The registry is asked over the network, and this card sits **above** the
 * summary — so rendering nothing while waiting meant the card appeared from
 * nowhere and shoved "At a glance" down the panel as it landed.
 */
it("holds the card's space while the registry is still being asked", async () => {
  await render();
  expect(card()).not.toBeNull();
  // The heading is known before the answer is, so it is printed rather than
  // greyed out.
  expect(card()?.textContent).toContain("rdap.org · free");
  expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
});

it("replaces the placeholder with the record, and keeps no pulse behind", async () => {
  await render();
  await act(async () => {
    answer({
      kind: "ok",
      fetchedAt: Date.now(),
      value: {
        registered: "2012-12-27T00:00:00Z",
        expires: "2034-12-27T00:00:00Z",
        updated: null,
        registrar: "Porkbun LLC",
      },
    });
  });
  expect(card()?.textContent).toContain("2012-12-27");
  expect(card()?.textContent).toContain("registered");
  expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
});

/** A card saying "not found" is not worth the space, so the placeholder goes
    with it rather than hardening into an empty card. */
it("drops the card entirely when the registry has no record", async () => {
  await render();
  await act(async () => answer({ kind: "unsupported" }));
  expect(card()).toBeNull();
});
