import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readJsonFile } from "../src/files.js";

let claudeHome: string;
let SETTINGS: string;

beforeEach(() => {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "atomicreps-"));
  claudeHome = mkdtempSync(join(tmpdir(), "atomicreps-claude-"));
  process.env.CLAUDE_CONFIG_DIR = claudeHome;
  SETTINGS = join(claudeHome, "settings.json");
  vi.resetModules();
});

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
});

const OLD_OURS = "npx -y atomicreps hook";

async function ourGroup(): Promise<{
  hooks: Array<{ type: string; command: string; timeout: number }>;
}> {
  const { hookCommand } = await import("../src/hooks-wire.js");
  return { hooks: [{ type: "command", command: hookCommand(), timeout: 5 }] };
}
const THEIRS = {
  hooks: [{ type: "command", command: "afplay /System/Library/Sounds/Glass.aiff" }],
};
const LINTER = { matcher: "Edit", hooks: [{ type: "command", command: "pnpm lint" }] };

function settings(): Record<string, unknown> {
  return readJsonFile<Record<string, unknown>>(SETTINGS) ?? {};
}

function seed(value: Record<string, unknown>): void {
  writeFileSync(SETTINGS, JSON.stringify(value));
}

function installPlugin(): void {
  mkdirSync(join(claudeHome, "plugins"), { recursive: true });
  writeFileSync(
    join(claudeHome, "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "atomicreps@atomicreps": [{ scope: "user" }] } }),
  );
}

describe("wireHooks", () => {
  it("writes a Stop and a UserPromptSubmit entry, leaving the rest of the file alone", async () => {
    seed({ theme: "dark", permissions: { allow: ["Bash"] } });
    const { wireHooks, hooksWired } = await import("../src/hooks-wire.js");
    expect(hooksWired(SETTINGS)).toBe(false);
    expect(wireHooks(SETTINGS).state).toBe("done");
    const OUR_GROUP = await ourGroup();
    expect(settings()).toEqual({
      theme: "dark",
      permissions: { allow: ["Bash"] },
      hooks: { Stop: [OUR_GROUP], UserPromptSubmit: [OUR_GROUP] },
    });
    expect(hooksWired(SETTINGS)).toBe(true);
  });

  it("keeps every hook the user already has, under our events and others", async () => {
    seed({ hooks: { Stop: [THEIRS], PostToolUse: [LINTER] } });
    const { wireHooks } = await import("../src/hooks-wire.js");
    wireHooks(SETTINGS);
    const OUR_GROUP = await ourGroup();
    expect(settings().hooks).toEqual({
      Stop: [THEIRS, OUR_GROUP],
      PostToolUse: [LINTER],
      UserPromptSubmit: [OUR_GROUP],
    });
  });

  it("adds nothing the second time, or where the same command is already there", async () => {
    const { wireHooks, hookCommand } = await import("../src/hooks-wire.js");
    const OUR_GROUP = await ourGroup();
    wireHooks(SETTINGS);
    expect(wireHooks(SETTINGS).says).toBe("already in place");
    expect(settings().hooks).toEqual({ Stop: [OUR_GROUP], UserPromptSubmit: [OUR_GROUP] });

    seed({
      hooks: { Stop: [{ hooks: [THEIRS.hooks[0], { type: "command", command: hookCommand() }] }] },
    });
    wireHooks(SETTINGS);
    const hooks = settings().hooks as Record<string, unknown[]>;
    expect(hooks.Stop).toHaveLength(1);
    expect(hooks.UserPromptSubmit).toEqual([OUR_GROUP]);
  });

  it("replaces the bare npx hook an older connect wrote, rather than adding a second", async () => {
    seed({
      hooks: { Stop: [THEIRS, { hooks: [{ type: "command", command: OLD_OURS, timeout: 5 }] }] },
    });
    const { wireHooks, hooksWired } = await import("../src/hooks-wire.js");
    expect(hooksWired(SETTINGS), "the bare form is offered again, so connect replaces it").toBe(
      false,
    );
    wireHooks(SETTINGS);
    const OUR_GROUP = await ourGroup();
    expect(settings().hooks).toEqual({ Stop: [THEIRS, OUR_GROUP], UserPromptSubmit: [OUR_GROUP] });
  });

  it("counts a hook pinned to another install's path as ours, on both events", async () => {
    const other =
      '"/old/bin/node" "/old/atomicreps/dist/cli.js" hook 2>/dev/null || npx -y atomicreps hook';
    const group = { hooks: [{ type: "command", command: other, timeout: 5 }] };
    seed({ hooks: { Stop: [group], UserPromptSubmit: [group] } });
    const { hooksWired, hooksOurs } = await import("../src/hooks-wire.js");
    expect(hooksWired(SETTINGS)).toBe(true);
    expect(hooksOurs(SETTINGS)).toBe(true);
  });

  it("writes nothing when the plugin is installed, and says why", async () => {
    installPlugin();
    seed({ theme: "dark" });
    const { wireHooks } = await import("../src/hooks-wire.js");
    const applied = wireHooks(SETTINGS);
    expect(applied.state).toBe("noted");
    expect(applied.says).toContain("plugin already runs these hooks");
    expect(settings()).toEqual({ theme: "dark" });
  });

  it("refuses a settings file that does not parse", async () => {
    writeFileSync(SETTINGS, "{ not json");
    const { wireHooks } = await import("../src/hooks-wire.js");
    expect(wireHooks(SETTINGS).state).toBe("failed");
  });

  it("writes the alpha command on the alpha channel", async () => {
    const config = await import("../src/config.js");
    config.setChannel("alpha");
    const { wireHooks, hooksWired } = await import("../src/hooks-wire.js");
    wireHooks(SETTINGS);
    const hooks = settings().hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    expect(hooks.Stop?.[0]?.hooks[0]?.command).toContain(" hook --alpha 2>/dev/null");
    expect(hooks.Stop?.[0]?.hooks[0]?.command).toMatch(/\|\| npx -y atomicreps hook --alpha$/);
    expect(hooksWired(SETTINGS)).toBe(true);
    config.setChannel("default");
  });
});

describe("unwireHooks", () => {
  it("takes out only our command, and every other hook stays where it was", async () => {
    const OUR_GROUP = await ourGroup();
    seed({
      theme: "dark",
      hooks: {
        Stop: [THEIRS, OUR_GROUP],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "date" }, OUR_GROUP.hooks[0]] }],
        PostToolUse: [LINTER],
      },
    });
    const { unwireHooks, hooksOurs } = await import("../src/hooks-wire.js");
    expect(hooksOurs(SETTINGS)).toBe(true);
    expect(unwireHooks(SETTINGS).state).toBe("done");
    expect(settings()).toEqual({
      theme: "dark",
      hooks: {
        Stop: [THEIRS],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "date" }] }],
        PostToolUse: [LINTER],
      },
    });
    expect(hooksOurs(SETTINGS)).toBe(false);
  });

  it("drops the hooks key when ours was all it held, in any form and on either channel", async () => {
    seed({
      theme: "dark",
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: OLD_OURS, timeout: 5 }] }],
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "npx -y atomicreps hook --alpha", timeout: 5 }] },
        ],
      },
    });
    const { unwireHooks } = await import("../src/hooks-wire.js");
    unwireHooks(SETTINGS);
    expect(settings()).toEqual({ theme: "dark" });
    expect(unwireHooks(SETTINGS).says).toBe("already gone");
  });

  it("is listed by logout --purge, and removing it leaves foreign hooks", async () => {
    seed({ hooks: { Stop: [THEIRS] } });
    const { wireHooks } = await import("../src/hooks-wire.js");
    wireHooks(SETTINGS);
    const { leftovers } = await import("../src/unwire.js");
    const row = leftovers(() => false).find((r) => r.id === "hooks");
    expect(row).toBeDefined();
    row?.remove();
    expect(settings()).toEqual({ hooks: { Stop: [THEIRS] } });
  });
});
