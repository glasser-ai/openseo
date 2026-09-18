import { describe, expect, it } from "vitest";
import {
  decodeMicros,
  encodeMicros,
  formatUsd,
  maxMicros,
  microsToUsd,
  usdToMicros,
} from "../micros.js";

describe("usdToMicros", () => {
  it("parses exact decimal strings without touching floats", () => {
    expect(usdToMicros("0.30")).toBe(300_000n);
    expect(usdToMicros("1")).toBe(1_000_000n);
    expect(usdToMicros("0.000001")).toBe(1n);
    expect(usdToMicros("12.345678")).toBe(12_345_678n);
    expect(usdToMicros("-0.50")).toBe(-500_000n);
  });

  it("is exact where float arithmetic is not", () => {
    // Number("0.07") * 1e6 === 70000.00000000001
    expect(usdToMicros("0.07")).toBe(70_000n);
    expect(usdToMicros("0.29")).toBe(290_000n);
  });

  it("rejects anything that is not an exact amount", () => {
    for (const bad of ["", "abc", "1.2345678", "1e6", "0x10", " ", "1,000", "NaN"]) {
      expect(() => usdToMicros(bad)).toThrow(TypeError);
    }
  });
});

describe("microsToUsd", () => {
  it("renders the canonical form, trailing zeros stripped", () => {
    expect(microsToUsd(300_000n)).toBe("0.3");
    expect(microsToUsd(1_000_000n)).toBe("1");
    expect(microsToUsd(1n)).toBe("0.000001");
    expect(microsToUsd(12_345_678n)).toBe("12.345678");
    expect(microsToUsd(-500_000n)).toBe("-0.5");
    expect(microsToUsd(0n)).toBe("0");
  });

  it("round-trips back to the identical bigint — the invariant that matters", () => {
    for (const usd of ["0", "0.30", "1", "0.000001", "12.345678", "-0.50", "9999.99"]) {
      const micros = usdToMicros(usd);
      expect(usdToMicros(microsToUsd(micros))).toBe(micros);
    }
  });
});

describe("formatUsd", () => {
  it("keeps sub-cent amounts legible instead of showing $0.00", () => {
    expect(formatUsd(300_000n)).toBe("$0.30");
    expect(formatUsd(1_250_000n)).toBe("$1.25");
    expect(formatUsd(500n)).toBe("$0.0005");
    expect(formatUsd(0n)).toBe("$0.00");
    // Exact, not truncated: $0.024 once printed as $0.02, a fifth less.
    expect(formatUsd(24_000n)).toBe("$0.024");
    expect(formatUsd(8_000n)).toBe("$0.008");
    expect(formatUsd(132_000n)).toBe("$0.132");
    expect(formatUsd(-24_000n)).toBe("-$0.024");
  });
});

describe("storage codec", () => {
  it("round-trips bigint through the string form", () => {
    for (const value of [0n, 1n, 300_000n, -500_000n, 9_007_199_254_740_993n]) {
      expect(decodeMicros(encodeMicros(value))).toBe(value);
    }
  });

  it("survives a value larger than Number.MAX_SAFE_INTEGER", () => {
    const huge = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2
    expect(decodeMicros(encodeMicros(huge))).toBe(huge);
    // One trip through Number and it never comes back — which is exactly why the
    // stored form has to be a string.
    expect(BigInt(Number(encodeMicros(huge)))).not.toBe(huge);
  });

  it("throws on corrupt values rather than yielding 0", () => {
    for (const bad of [undefined, null, 42, "", "1.5", "abc", "0x10", {}, []]) {
      expect(() => decodeMicros(bad)).toThrow(TypeError);
    }
  });
});

describe("maxMicros", () => {
  it("picks the largest clause", () => {
    expect(maxMicros([300_000n, 20_000n, 950_000n, 0n])).toBe(950_000n);
  });
  it("refuses an empty list", () => {
    expect(() => maxMicros([])).toThrow(TypeError);
  });
});
