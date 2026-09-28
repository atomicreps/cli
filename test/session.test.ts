import { describe, expect, it } from "vitest";

import { BACKGROUND_SEEN_KEPT_MS, BACKGROUND_STALE_MS } from "../src/constants.js";
import { backgroundTaskIds, stillWorking, unattended } from "../src/session.js";

const NOW = 1_790_000_000_000;
const MINUTE = 60_000;

describe("the task list Claude Code hands a Stop", () => {
  it("reads the id of every task, whatever its type, as Claude Code 2.1.284 sends them", () => {
    const tasks = [
      { id: "aa64279e85560a034", type: "subagent", status: "running", agent_type: "claude" },
      { id: "b1tybrxuc", type: "shell", status: "running", command: "sleep 40" },
    ];
    expect(backgroundTaskIds(tasks)).toEqual(["aa64279e85560a034", "b1tybrxuc"]);
    expect(backgroundTaskIds([])).toEqual([]);
  });

  it("is undefined on a Claude Code that predates the field, and skips an entry with no id", () => {
    expect(backgroundTaskIds(undefined)).toBeUndefined();
    expect(backgroundTaskIds("running")).toBeUndefined();
    expect(backgroundTaskIds([{ type: "shell" }, 7, { id: "b1" }])).toEqual(["b1"]);
  });
});

describe("background work still running", () => {
  it("holds a Stop back from the first sight of a task, and not once none is left", () => {
    const first = stillWorking(["b1"], {}, NOW);
    expect(first).toEqual({ busy: true, seen: { b1: NOW } });
    expect(stillWorking([], first.seen, NOW + MINUTE).busy).toBe(false);
  });

  it("keeps the first sight, so a task stops counting at the stale limit however often it is seen", () => {
    const seen = { dev: NOW };
    expect(stillWorking(["dev"], seen, NOW + BACKGROUND_STALE_MS - 1).busy).toBe(true);
    expect(stillWorking(["dev"], seen, NOW + BACKGROUND_STALE_MS).busy).toBe(false);
  });

  it("is still busy while a fresh task runs beside a stale one", () => {
    const seen = { dev: NOW - BACKGROUND_STALE_MS * 2 };
    expect(stillWorking(["dev", "agent"], seen, NOW).busy).toBe(true);
  });

  it("never drops another session's task for being absent here, only for its age", () => {
    const seen = { other: NOW - MINUTE, ancient: NOW - BACKGROUND_SEEN_KEPT_MS };
    expect(stillWorking([], seen, NOW).seen).toEqual({ other: NOW - MINUTE });
  });
});

describe("a session nobody reads", () => {
  it("is a subagent, or a headless run through claude -p or the Agent SDK", () => {
    expect(unattended("agent-7", { CLAUDE_CODE_ENTRYPOINT: "cli" })).toBe(true);
    expect(unattended(undefined, { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" })).toBe(true);
    expect(unattended(undefined, { CLAUDE_CODE_ENTRYPOINT: "sdk-ts" })).toBe(true);
  });

  it("is not the terminal, and not an editor that names no entrypoint", () => {
    expect(unattended(undefined, { CLAUDE_CODE_ENTRYPOINT: "cli" })).toBe(false);
    expect(unattended(undefined, {})).toBe(false);
  });
});
