import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "atomicreps-budget-"));
  process.env.ATOMICREPS_API = "https://door.invalid";
  process.env.ATOMICREPS_UNSAFE_ORIGIN = "1";
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ATOMICREPS_API;
  delete process.env.ATOMICREPS_UNSAFE_ORIGIN;
});

function serving(status: number, headers: Record<string, string> = {}) {
  return vi.fn(
    async () => new Response(JSON.stringify({ text: "", data: null }), { status, headers }),
  );
}

describe("the hourly budget", () => {
  it("refuses past the endpoint's rate without opening a socket, and refills with time", async () => {
    const fetchImpl = serving(200);
    vi.stubGlobal("fetch", fetchImpl);
    const api = await import("../src/api.js");
    const { BUDGET_PER_HOUR, BUDGET_PERIOD_MS } = await import("../src/constants.js");
    const clock = await import("../src/clock.js");
    const rate = BUDGET_PER_HOUR["/mcp/vote"] ?? 0;
    let now = 1_700_000_000_000;
    vi.spyOn(clock, "now").mockImplementation(() => now);

    for (let i = 0; i < rate; i += 1) expect((await api.vote("r1", "useful")).ok).toBe(true);
    const refused = await api.vote("r1", "useful");
    expect(refused).toMatchObject({ ok: false, reason: "budget" });
    expect(fetchImpl).toHaveBeenCalledTimes(rate);

    now += BUDGET_PERIOD_MS / rate + 1;
    expect((await api.vote("r1", "useful")).ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(rate + 1);
  });

  it("is one budget across processes: a fresh module sees what the last one spent", async () => {
    vi.stubGlobal("fetch", serving(200));
    const first = await import("../src/api.js");
    await first.vote("r1", "useful");
    vi.resetModules();
    const { readConfig } = await import("../src/config.js");
    const bucket = readConfig().budget?.["/mcp/vote"];
    expect(bucket).toBeDefined();
    expect(bucket?.tokens).toBeLessThan(60);
  });

  it("obeys a 429 for its Retry-After, then asks again", async () => {
    const fetchImpl = serving(429, { "retry-after": "600" });
    vi.stubGlobal("fetch", fetchImpl);
    const api = await import("../src/api.js");
    const clock = await import("../src/clock.js");
    let now = 1_700_000_000_000;
    vi.spyOn(clock, "now").mockImplementation(() => now);

    expect(await api.vote("r1", "useful")).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(await api.vote("r1", "useful")).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 600_001;
    await api.vote("r1", "useful");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("the local quiet clock", () => {
  it("is quiet for at most an hour on a day-long mute, then asks once", async () => {
    const clock = await import("../src/clock.js");
    const { MAX_LOCAL_QUIET_MS } = await import("../src/constants.js");
    const now = 1_700_000_000_000;
    const kept = clock.clampQuiet(now + 24 * 60 * 60_000, now);
    expect(kept).toBe(now + MAX_LOCAL_QUIET_MS);
    expect(clock.locallyQuiet(kept, now)).toBe(true);
    expect(clock.locallyQuiet(kept, now + MAX_LOCAL_QUIET_MS)).toBe(false);
  });
});
