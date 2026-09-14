import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let configHome: string;

beforeEach(() => {
  configHome = mkdtempSync(join(tmpdir(), "atomicreps-purge-"));
  process.env.XDG_CONFIG_HOME = configHome;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
});

function path(name: string): string {
  return join(configHome, "atomicreps", name);
}

describe("purging what this machine remembers", () => {
  it("takes the reps, the summary and the error log, and leaves the public caches", async () => {
    const store = await import("../src/store.js");
    const config = await import("../src/config.js");
    config.writeConfig({ token: "arep_test" });
    store.observeRep({ kind: "question", id: "q1", topicSlug: "react" }, "a block", Date.now());
    store.writeStatusCache({ currentStreak: 3 }, Date.now());
    config.noteFailure("rep: timeout", Date.now());
    mkdirSync(join(configHome, "atomicreps"), { recursive: true });
    writeFileSync(path("grammar.json"), "{}");
    expect(existsSync(path("reps.json"))).toBe(true);
    expect(existsSync(path("status.json"))).toBe(true);
    expect(existsSync(path("last-error.log"))).toBe(true);

    store.purgeLocalData();

    expect(existsSync(path("reps.json"))).toBe(false);
    expect(existsSync(path("status.json"))).toBe(false);
    expect(existsSync(path("last-error.log"))).toBe(false);
    expect(store.listReps()).toEqual([]);
    expect(existsSync(path("grammar.json"))).toBe(true);
  });

  it("says nothing and throws nothing when there was never anything to forget", async () => {
    const store = await import("../src/store.js");
    expect(() => store.purgeLocalData()).not.toThrow();
  });
});
