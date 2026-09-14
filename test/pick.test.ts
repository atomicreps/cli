import { describe, expect, it } from "vitest";

import { bandFrom, viewport } from "../src/pick.js";

describe("two levels make a range", () => {
  it("reads the same either way round", () => {
    expect(bandFrom(2, 4)).toEqual({ min: 2, max: 4 });
    expect(bandFrom(4, 2)).toEqual({ min: 2, max: 4 });
  });

  it("the same level twice is that level alone, not an empty range", () => {
    expect(bandFrom(3, 3)).toEqual({ min: 3, max: 3 });
  });
});

describe("the scrolling window", () => {
  it("shows everything when everything fits, without scrolling", () => {
    expect(viewport(5, 0, 10)).toEqual({ start: 0, end: 5 });
  });

  it("keeps the cursor off both edges in a long list", () => {
    const { start, end } = viewport(100, 50, 10);
    expect(50 - start).toBeGreaterThan(0);
    expect(end - 50).toBeGreaterThan(1);
  });

  it("stops at the ends rather than scrolling past them", () => {
    expect(viewport(100, 0, 10)).toEqual({ start: 0, end: 10 });
    expect(viewport(100, 99, 10)).toEqual({ start: 90, end: 100 });
  });
});
