import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readJsonFile } from "../src/files.js";

const realHome = process.env.HOME;
let home: string;
let claudeHome: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "atomicreps-home-"));
  claudeHome = join(home, ".claude");
  mkdirSync(claudeHome, { recursive: true });
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  process.env.CLAUDE_CONFIG_DIR = claudeHome;
  process.env.COPILOT_HOME = join(home, ".copilot");
  vi.resetModules();
});

afterEach(() => {
  process.env.HOME = realHome;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.COPILOT_HOME;
});

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

const noCli = (): boolean => false;

async function load() {
  return await import("../src/unwire.js");
}

describe("finding what connect wrote", () => {
  it("finds nothing on a machine connect never touched", async () => {
    writeJson(join(claudeHome, "settings.json"), { permissions: { allow: ["Bash"] } });
    const { leftovers } = await load();
    expect(leftovers(noCli)).toEqual([]);
  });

  it("finds both channels' entries and labels the alpha one", async () => {
    writeJson(join(home, ".cursor", "mcp.json"), {
      mcpServers: { atomicreps: {}, "atomicreps-alpha": {}, playwright: {} },
    });
    const { leftovers } = await load();
    const labels = leftovers(noCli).map((row) => row.label);
    expect(labels).toEqual(["Cursor", "Cursor (alpha)"]);
  });

  it("finds a Claude Code server registered at user scope", async () => {
    writeJson(join(claudeHome, ".claude.json"), {
      mcpServers: { "atomicreps-alpha": { command: "npx" }, other: {} },
    });
    const { leftovers } = await load();
    expect(leftovers(noCli).map((row) => row.id)).toEqual(["claude:atomicreps-alpha"]);
  });

  it("asks the Codex CLI rather than reading its TOML", async () => {
    const asked: string[] = [];
    const { leftovers } = await load();
    const rows = leftovers((command, name) => {
      asked.push(`${command} ${name}`);
      return name === "atomicreps";
    });
    expect(asked).toEqual(["codex atomicreps", "codex atomicreps-alpha"]);
    expect(rows.map((row) => row.id)).toEqual(["codex:atomicreps"]);
  });
});

describe("removing it", () => {
  it("takes our entry out of each JSON config and leaves every other server", async () => {
    const vscode = join(home, "Library", "Application Support", "Code", "User", "mcp.json");
    const copilot = join(home, ".copilot", "mcp-config.json");
    writeJson(join(home, ".codeium", "windsurf", "mcp_config.json"), {
      mcpServers: { atomicreps: {}, other: { command: "x" } },
    });
    writeJson(copilot, { mcpServers: { "atomicreps-alpha": {}, other: {} } });
    if (process.platform === "darwin") {
      writeJson(vscode, { servers: { atomicreps: {} }, inputs: [] });
    }
    const { leftovers } = await load();
    const rows = leftovers(noCli);
    for (const row of rows) expect(row.remove().state).toBe("done");
    expect(readJsonFile(join(home, ".codeium", "windsurf", "mcp_config.json"))).toEqual({
      mcpServers: { other: { command: "x" } },
    });
    expect(readJsonFile(copilot)).toEqual({ mcpServers: { other: {} } });
    if (process.platform === "darwin") {
      expect(readJsonFile(vscode)).toEqual({ servers: {}, inputs: [] });
    }
    expect(leftovers(noCli)).toEqual([]);
  });

  it("removes our four allow rules for each channel and no one else's", async () => {
    const settings = join(claudeHome, "settings.json");
    writeJson(settings, {
      theme: "dark",
      permissions: {
        allow: [
          "Bash(git status)",
          "mcp__atomicreps__rep",
          "mcp__atomicreps__answer",
          "mcp__atomicreps__me",
          "mcp__atomicreps__settings",
          "mcp__atomicreps-alpha__rep",
          "mcp__atomicreps-staging__rep",
        ],
        deny: ["Read(.env)"],
      },
    });
    const { leftovers } = await load();
    const rows = leftovers(noCli);
    expect(rows.map((row) => row.id)).toEqual(["allow:atomicreps", "allow:atomicreps-alpha"]);
    for (const row of rows) row.remove();
    expect(readJsonFile(settings)).toEqual({
      theme: "dark",
      permissions: {
        allow: ["Bash(git status)", "mcp__atomicreps-staging__rep"],
        deny: ["Read(.env)"],
      },
    });
  });
});

describe("taking the status line back", () => {
  it("puts the user's own command back and deletes the wrapper", async () => {
    const settings = join(claudeHome, "settings.json");
    writeJson(settings, { statusLine: { type: "command", command: "bash ~/mine.sh", padding: 1 } });
    const wire = await import("../src/statusline-wire.js");
    wire.wireStatusLine(settings, "npx -y atomicreps statusline");
    const wrapper = wire.statusLineWrapperPath();
    expect(existsSync(wrapper)).toBe(true);

    const { leftovers } = await load();
    const [row] = leftovers(noCli);
    expect(row?.id).toBe("statusline");
    expect(row?.remove().state).toBe("done");
    expect(readJsonFile(settings)).toEqual({
      statusLine: { type: "command", command: "bash ~/mine.sh", padding: 1 },
    });
    expect(existsSync(wrapper)).toBe(false);
  });

  it("drops a status line that was only ours", async () => {
    const settings = join(claudeHome, "settings.json");
    writeJson(settings, {
      theme: "dark",
      statusLine: { type: "command", command: "npx -y atomicreps statusline --alpha" },
    });
    const { leftovers } = await load();
    const [row] = leftovers(noCli);
    expect(row?.remove().state).toBe("done");
    expect(readJsonFile(settings)).toEqual({ theme: "dark" });
  });
});
