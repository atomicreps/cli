import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const OURS = '"/usr/bin/node" "/x/cli.js" statusline || npx -y atomicreps statusline';

function settings(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
}

function seed(value: Record<string, unknown>): void {
  writeFileSync(join(claudeHome, "settings.json"), JSON.stringify(value));
}

describe("wireStatusLine", () => {
  it("writes our command where there was none, leaving the rest of the file alone", async () => {
    seed({ theme: "dark", permissions: { allow: ["Bash"] } });
    const { wireStatusLine, statusLineWired } = await import("../src/statusline-wire.js");
    expect(statusLineWired(SETTINGS)).toBe(false);
    expect(wireStatusLine(SETTINGS, OURS).state).toBe("done");
    expect(settings()).toEqual({
      theme: "dark",
      permissions: { allow: ["Bash"] },
      statusLine: { type: "command", command: OURS },
    });
    expect(statusLineWired(SETTINGS)).toBe(true);
  });

  it("keeps a custom command as the first row of a wrapper and ours as the second", async () => {
    seed({ statusLine: { type: "command", command: "bash ~/mine.sh", padding: 2 } });
    const { wireStatusLine, statusLineWired, statusLineWrapperPath } =
      await import("../src/statusline-wire.js");
    expect(wireStatusLine(SETTINGS, OURS).state).toBe("done");
    const wrapper = statusLineWrapperPath();
    expect(existsSync(wrapper)).toBe(true);
    const lines = readFileSync(wrapper, "utf8").split("\n");
    expect(lines.findIndex((l) => l.includes("bash ~/mine.sh"))).toBeLessThan(
      lines.findIndex((l) => l.includes(OURS)),
    );
    const line = settings().statusLine as Record<string, unknown>;
    expect(line.command).toBe(`sh "${wrapper}"`);
    expect(line.padding).toBe(2);
    expect(statusLineWired(SETTINGS)).toBe(true);
    expect(wireStatusLine(SETTINGS, OURS).says).toBe("already in place");
  });

  it("hands a ccstatusline user the widget and writes nothing", async () => {
    seed({ statusLine: { type: "command", command: "npx ccstatusline@latest" } });
    const { wireStatusLine, statusLineWrapperPath } = await import("../src/statusline-wire.js");
    expect(wireStatusLine(SETTINGS, OURS).state).toBe("noted");
    expect(existsSync(statusLineWrapperPath())).toBe(false);
    expect((settings().statusLine as Record<string, unknown>).command).toBe(
      "npx ccstatusline@latest",
    );
  });

  it("refuses a settings file it cannot parse rather than replacing it", async () => {
    writeFileSync(join(claudeHome, "settings.json"), "{ not json");
    const { wireStatusLine } = await import("../src/statusline-wire.js");
    expect(wireStatusLine(SETTINGS, OURS).state).toBe("failed");
    expect(readFileSync(join(claudeHome, "settings.json"), "utf8")).toBe("{ not json");
  });
});

describe("statusLineCommand", () => {
  it("pins the running binary and falls back to npx", async () => {
    const { statusLineCommand } = await import("../src/statusline-wire.js");
    const command = statusLineCommand("/opt/node", "/tmp/a b/cli.js");
    expect(command.startsWith('"/opt/node" "/tmp/a b/cli.js" statusline')).toBe(true);
    expect(command).toContain("|| npx -y atomicreps statusline");
  });
});
