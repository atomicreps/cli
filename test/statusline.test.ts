import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ESC = String.fromCharCode(27);

let configHome: string;

const BLOCK =
  "⚛ **Atomic Reps · Testing Strategies**\n──────────────────────────\nWhich runner?\n\nA. One\nB. Two\n\n_From memory. Reply with a letter._";

beforeEach(() => {
  configHome = mkdtempSync(join(tmpdir(), "atomicreps-status-"));
  process.env.XDG_CONFIG_HOME = configHome;
  delete process.env.NO_COLOR;
  delete process.env.COLUMNS;
  process.env.TERM = "xterm-256color";
  vi.resetModules();
});

afterEach(() => {
  delete process.env.COLUMNS;
  delete process.env.NO_COLOR;
});

function seedPending(text = BLOCK, id = "q7"): void {
  const dir = join(configHome, "atomicreps");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "reps.json"),
    JSON.stringify({
      reps: [
        { id, topicSlug: "testing_strategies", handle: "testing.unit", text, servedAt: 1_000 },
      ],
    }),
  );
}

async function load() {
  const statusline = await import("../src/statusline.js");
  const config = await import("../src/config.js");
  const constants = await import("../src/constants.js");
  return { statusline, config, constants };
}

describe("the status line while a rep is open", () => {
  it("names the topic the block named and links the web answer to that rep", async () => {
    const { statusline, config, constants } = await load();
    config.writeConfig({ token: "arep_test" });
    seedPending();

    const line = statusline.statusLine(2_000);
    expect(line).toContain("rep open");
    expect(line).toContain("Testing Strategies");
    expect(line).toContain("reply A-D");
    expect(line, "OSC 8, so the words are what shows").toContain(
      `${ESC}]8;;${constants.DEFAULT_SITE}/r/q7`,
    );
    expect(line).toContain("answer on the web");
  });

  it("falls back to what this machine knows the rep by when the block has no header", async () => {
    const { statusline, config } = await load();
    config.writeConfig({ token: "arep_test" });
    seedPending("nothing shaped like a block at all");

    expect(statusline.statusLine(2_000)).toContain("testing.unit");
  });

  it("writes no escape at all when the terminal refuses colour", async () => {
    const { statusline, config } = await load();
    config.writeConfig({ token: "arep_test" });
    seedPending();
    process.env.NO_COLOR = "1";

    const line = statusline.statusLine(2_000);
    expect(line).not.toContain(ESC);
    expect(line, "the question is still named").toContain("Testing Strategies");
  });
});

describe("the width the terminal says it has", () => {
  it("drops whole segments off the end rather than cut a word or an escape", async () => {
    const { statusline, config } = await load();
    config.writeConfig({ token: "arep_test" });
    seedPending();

    process.env.COLUMNS = "40";
    const narrow = statusline.statusLine(2_000);
    expect(narrow, "the link goes first").not.toContain("answer on the web");
    expect(narrow).not.toContain(ESC);
    expect(narrow).toBe("(•_•)? rep open · Testing Strategies");

    process.env.COLUMNS = "20";
    expect(statusline.statusLine(2_000)).toBe("(•_•)? rep open");

    process.env.COLUMNS = "not a number";
    expect(statusline.statusLine(2_000), "an unreadable width is no width").toContain(
      "answer on the web",
    );
  });
});

describe("the line with no rep open", () => {
  it("says when the next one opens, on the machine's own clock", async () => {
    const { statusline, config } = await load();
    const clock = await import("../src/clock.js");
    const now = 1_700_000_000_000;
    config.writeConfig({ token: "arep_test", nextEligibleAt: now + 20 * 60_000 });

    const line = statusline.statusLine(now);
    expect(line).toContain(clock.hhmm(now + 20 * 60_000));
    expect(line).toMatch(/\d\d:\d\d/);
  });

  it("says a rep is ready once the clock has run out, and asks for a sign-in without a token", async () => {
    const { statusline, config } = await load();
    const now = 1_700_000_000_000;
    config.writeConfig({ token: "arep_test", nextEligibleAt: now - 1 });
    expect(statusline.statusLine(now)).toContain("rep ready");

    config.writeConfig({});
    expect(statusline.statusLine(now)).toContain("not signed in");
  });
});
