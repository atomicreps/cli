import { describe, expect, it } from "vitest";

import { isBehind } from "../src/version.js";

describe("isBehind", () => {
  it("is true only for an earlier release", () => {
    expect(isBehind("0.0.3", "0.0.4")).toBe(true);
    expect(isBehind("0.0.9", "0.1.0")).toBe(true);
    expect(isBehind("0.9.9", "1.0.0")).toBe(true);
  });

  it("is false for the same release and for a newer one", () => {
    expect(isBehind("0.0.4", "0.0.4")).toBe(false);
    expect(isBehind("0.0.5", "0.0.4")).toBe(false);
    expect(isBehind("1.0.0", "0.9.9")).toBe(false);
  });

  it("compares each part as a number, not as text", () => {
    expect(isBehind("0.0.9", "0.0.10")).toBe(true);
    expect(isBehind("0.0.10", "0.0.9")).toBe(false);
  });

  it("stays quiet on anything it cannot read", () => {
    expect(isBehind("", "0.0.4")).toBe(false);
    expect(isBehind("0.0.4", "")).toBe(false);
    expect(isBehind("0.0", "0.0.4")).toBe(false);
    expect(isBehind("0.0.4-beta.1", "0.0.5")).toBe(false);
    expect(isBehind("next", "0.0.4")).toBe(false);
  });
});
