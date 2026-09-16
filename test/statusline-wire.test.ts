import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
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

const OURS = "printf ours || npx -y atomicreps statusline";

function settings(): Record<string, unknown> {
  return readJsonFile<Record<string, unknown>>(SETTINGS) ?? {};
}

function seed(value: Record<string, unknown>): void {
  writeFileSync(SETTINGS, JSON.stringify(value));
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

  it("keeps a custom command as the first row and ours as the second, each on its own line", async () => {
    seed({ statusLine: { type: "command", command: "printf mine", padding: 2 } });
    const { wireStatusLine, statusLineWired, statusLineWrapperPath } =
      await import("../src/statusline-wire.js");
    expect(wireStatusLine(SETTINGS, OURS).state).toBe("done");
    const wrapper = statusLineWrapperPath();
    const line = settings().statusLine as Record<string, unknown>;
    expect(line.command).toBe(`sh "${wrapper}"`);
    expect(line.padding).toBe(2);
    const rows = execFileSync("sh", [wrapper], { input: "{}", encoding: "utf8" });
    expect(rows).toBe("mine\nours");
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
    writeFileSync(SETTINGS, "{ not json");
    const { wireStatusLine } = await import("../src/statusline-wire.js");
    expect(wireStatusLine(SETTINGS, OURS).state).toBe("failed");
    expect(statSync(SETTINGS).size).toBe("{ not json".length);
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
