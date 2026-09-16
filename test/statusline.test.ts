import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredRep } from "../src/types.js";

let configHome: string;

const BLOCK = [
  "⚛ **Atomic Reps · Testing Strategies**",
  "──────────────────────────",
  "What does toHaveBeenLastCalledWith check?",
  "",
  "```",
  "expect(log).toHaveBeenLastCalledWith('third');",
  "```",
  "",
  "A. That the function was called at least once with those arguments",
  "B. That the mock's most recent call used the given arguments",
  "C. That the function returned the specified value on its last call",
  "D. That only the last test in the suite called the function",
  "",
  "_From memory. Reply with a letter._",
].join("\n");

const VERDICT =
  "✅ **Right** · The mock's most recent call is the one checked\n──────────────────────────\nMore words.\n\n_Streak: 5 days._";

beforeEach(() => {
  configHome = mkdtempSync(join(tmpdir(), "atomicreps-status-"));
  process.env.XDG_CONFIG_HOME = configHome;
  delete process.env.COLUMNS;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.COLUMNS;
});

function seedReps(reps: StoredRep[]): void {
  const dir = join(configHome, "atomicreps");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "reps.json"), JSON.stringify({ reps }));
}

const NOW = 1_700_000_000_000;

function pending(servedAt = NOW - 60_000): StoredRep {
  return {
    id: "q7",
    topicSlug: "testing_strategies",
    handle: "testing.unit",
    text: BLOCK,
    servedAt,
  };
}

async function load() {
  const statusline = await import("../src/statusline.js");
  const config = await import("../src/config.js");
  config.writeConfig({ token: "arep_test" });
  return { statusline, config };
}

describe("an open rep", () => {
  it("is the question itself: the stem, then the options cut to their first clause", async () => {
    seedReps([pending()]);
    const { statusline } = await load();
    const rows = statusline.statusLine(NOW).split("\n");
    expect(rows[0]).toBe("⚛ What does toHaveBeenLastCalledWith check?");
    expect(rows[1], "the word all four open with is dropped").toContain(
      "A the function was called",
    );
    expect(rows[2]).toContain(" · D only the last test");
    expect(rows[1]).not.toContain("That");
    expect(rows, "two options per row at a hundred columns").toHaveLength(3);
  });

  it("never lets a row past the width, and the code in the block is not the stem", async () => {
    seedReps([pending()]);
    process.env.COLUMNS = "60";
    const { statusline } = await load();
    const rows = statusline.statusLine(NOW).split("\n");
    for (const row of rows) expect(row.length, row).toBeLessThanOrEqual(60);
    expect(rows[1]).toMatch(/^ {2}A .*… · B .*…$/);
    expect(statusline.statusLine(NOW)).not.toContain("expect(log)");
  });
});

describe("after the letter", () => {
  it("keeps the verdict's first line up for a while, with the day beside it", async () => {
    seedReps([{ ...pending(), answeredAt: NOW - 60_000, correct: true, verdict: VERDICT }]);
    const { statusline, config } = await load();
    config.updateConfig({ nextEligibleAt: NOW + 20 * 60_000 });
    const line = statusline.statusLine(NOW);
    expect(line).toContain("✅ Right · The mock's most recent call is the one checked");
    expect(line).not.toContain("**");
    expect(line).toContain("1 today");
  });

  it("lets the verdict go once its time is up", async () => {
    seedReps([{ ...pending(), answeredAt: NOW - 11 * 60_000, correct: true, verdict: VERDICT }]);
    const { statusline } = await load();
    expect(statusline.statusLine(NOW)).not.toContain("Right");
  });
});

describe("with nothing open", () => {
  it("says when the door opens and how the day stands", async () => {
    seedReps([
      {
        ...pending(NOW - 3 * 60 * 60_000),
        answeredAt: NOW - 3 * 60 * 60_000,
        correct: false,
        verdict: VERDICT,
      },
    ]);
    const { statusline, config } = await load();
    config.updateConfig({ nextEligibleAt: NOW + 20 * 60_000 });
    const { hhmm } = await import("../src/clock.js");
    expect(statusline.statusLine(NOW)).toBe(`⚛ next rep ${hhmm(NOW + 20 * 60_000)} · 1 today`);
  });

  it("says nothing at all when there is nothing to say", async () => {
    seedReps([]);
    const { statusline } = await load();
    expect(statusline.statusLine(NOW)).toBe("");
  });
});
