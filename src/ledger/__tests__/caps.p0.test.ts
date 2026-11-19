import { beforeEach, describe, expect, it, vi } from "vitest";
import { capsRaised, DEFAULT_SETTINGS, getSettings, patchSettings, reserve } from "../store.js";

/**
 * Changing a default does nothing for **an extension already installed**:
 * getSettings is `{...DEFAULT_SETTINGS, ...stored}`, and once something has been
 * stored the default can never reach it again.
 * Hence this migration, which may only touch the two values that are still
 * exactly the old defaults.
 */
const bag: Record<string, unknown> = {};
beforeEach(() => {
  for (const key of Object.keys(bag)) delete bag[key];
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => (key in bag ? { [key]: bag[key] } : {}),
        set: async (patch: Record<string, unknown>) => {
          Object.assign(bag, patch);
        },
      },
    },
  });
});

const store = (daily: string, monthly: string) => {
  bag["openseo:settings"] = {
    paidAcknowledged: true,
    dailyCapMicros: daily,
    monthlyCapMicros: monthly,
  };
};

describe("spending settings", () => {
  it("preserves explicit limits even when they match retired defaults", async () => {
    store("500000", "5000000");
    const settings = await getSettings();
    expect(settings.dailyCapMicros).toBe("500000");
    expect(settings.monthlyCapMicros).toBe("5000000");
  });

  it("never overwrites limits the user chose", async () => {
    store("250000", "1000000");
    const settings = await getSettings();
    expect(settings.dailyCapMicros).toBe("250000");
    expect(settings.monthlyCapMicros).toBe("1000000");
  });

  it("leaves a deliberate zero alone — that is 'stop spending', not an old default", async () => {
    store("0", "0");
    const settings = await getSettings();
    expect(settings.dailyCapMicros).toBe("0");
    expect(settings.monthlyCapMicros).toBe("0");
  });

  it("does nothing when no settings were ever stored", async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(bag["openseo:settings"]).toBeUndefined();
  });
});

it("rejects invalid limits and serializes concurrent updates", async () => {
  await expect(patchSettings({ dailyCapMicros: "-1" })).rejects.toThrow();
  await Promise.all([
    patchSettings({ dailyCapMicros: "123" }),
    patchSettings({ monthlyCapMicros: "456" }),
  ]);
  expect(await getSettings()).toMatchObject({ dailyCapMicros: "123", monthlyCapMicros: "456" });
});

describe("budget check", () => {
  it("lets a free lookup through a $0 budget and stops a paid one", async () => {
    store("0", "0");
    expect(await reserve(0n)).toBe(true);
    expect(await reserve(1n)).toBe(false);
  });
});

describe("capsRaised", () => {
  it("is true only when a cap goes up", () => {
    expect(capsRaised({ dailyCapMicros: "100" }, { dailyCapMicros: "200" })).toBe(true);
    expect(capsRaised({ monthlyCapMicros: "100" }, { monthlyCapMicros: "200" })).toBe(true);
    expect(capsRaised({ dailyCapMicros: "200" }, { dailyCapMicros: "100" })).toBe(false);
    expect(
      capsRaised({ dailyCapMicros: "100" }, { dailyCapMicros: "100", ratingBadge: false }),
    ).toBe(false);
    // A first save that writes the defaults raises nothing.
    expect(capsRaised(undefined, { ratingBadge: false })).toBe(false);
  });
});
