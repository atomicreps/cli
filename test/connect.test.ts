import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setChannel } from "../src/config.js";
import {
  agentTargets,
  type AgentTarget,
  claudeSettingsPath,
  mergeMcpJson,
  orderOffers,
  serverName,
  vscodeConfig,
} from "../src/connect.js";
import { readJsonFile } from "../src/files.js";

function offers(
  found: Partial<Record<string, boolean>>,
): Array<{ target: AgentTarget; found: boolean }> {
  return agentTargets().map((target) => ({ target, found: found[target.id] ?? false }));
}

describe("which rows are offered", () => {
  it("offers an editor that is not installed, because that is when you want its config written", () => {
    const ids = orderOffers(offers({ claude: true })).map((offer) => offer.target.id);
    expect(ids).toContain("cursor");
    expect(ids).toContain("windsurf");
    expect(ids).toContain("codex");
  });

  it("puts what was found first and `Something else` last", () => {
    const ids = orderOffers(offers({ codex: true, windsurf: true })).map(
      (offer) => offer.target.id,
    );
    expect(ids.slice(0, 2)).toEqual(["windsurf", "codex"]);
    expect(ids.at(-1)).toBe("manual");
  });

  it("keeps catalog order inside a band rather than shuffling on every run", () => {
    expect(orderOffers(offers({})).map((offer) => offer.target.id)).toEqual([
      "claude",
      "allowlist",
      "statusline",
      "vscode",
      "copilot",
      "cursor",
      "windsurf",
      "codex",
      "manual",
    ]);
  });
});

describe("a CLI that is not on the path", () => {
  const cliTargets = agentTargets().filter(
    (target) => target.id === "claude" || target.id === "codex" || target.id === "copilot",
  );

  it("hands back the command instead of spawning a binary that is not there", () => {
    for (const target of cliTargets) {
      const applied = target.apply(false);
      expect(applied.state).toBe("noted");
      expect(applied.says).toContain("npx -y atomicreps mcp");
    }
  });

  it("names the tool the user has to install, not just a failure", () => {
    expect(
      agentTargets()
        .find((t) => t.id === "codex")
        ?.apply(false).says,
    ).toContain("codex mcp add");
  });
});

describe("merging into an editor's MCP file", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "atomicreps-connect-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes under the key the editor reads and keeps the user's other servers", () => {
    const path = join(dir, "mcp.json");
    writeFileSync(path, JSON.stringify({ servers: { github: { type: "http", url: "x" } } }));
    expect(mergeMcpJson(path, false, vscodeConfig()).state).toBe("done");
    const written = readJsonFile<{ servers: Record<string, unknown>; mcpServers?: unknown }>(path);
    expect(written?.servers.github).toEqual({ type: "http", url: "x" });
    expect(written?.servers[serverName()]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "atomicreps", "mcp"],
    });
    expect(written?.mcpServers).toBeUndefined();
  });

  it("refuses a file it cannot parse rather than replacing someone's configuration", () => {
    const path = join(dir, "broken.json");
    writeFileSync(path, "{ not json");
    const before = statSync(path).size;
    expect(mergeMcpJson(path, false, vscodeConfig()).state).toBe("failed");
    expect(statSync(path).size).toBe(before);
  });
});

describe("where Claude Code's settings are", () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;

  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  });

  it("follows CLAUDE_CONFIG_DIR when the user has moved the directory", () => {
    process.env.CLAUDE_CONFIG_DIR = "/tmp/somewhere-else";
    expect(claudeSettingsPath()).toBe("/tmp/somewhere-else/settings.json");
  });

  it("falls back to the default directory when it is unset", () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(claudeSettingsPath()).toMatch(/\.claude\/settings\.json$/);
  });
});

describe("what the screen promises is what it runs", () => {
  const saved = process.env.ATOMICREPS_CHANNEL;

  afterEach(() => {
    setChannel(saved === "alpha" ? "alpha" : "default");
  });

  it("reads the channel when the row is built, not when the module loaded", () => {
    setChannel("alpha");
    const claude = agentTargets().find((target) => target.id === "claude");
    expect(claude?.detail).toContain("atomicreps-alpha");
    expect(claude?.detail).toContain("--alpha");

    setChannel("default");
    const plain = agentTargets().find((target) => target.id === "claude");
    expect(plain?.detail).not.toContain("--alpha");
  });

  it("agrees with the command it would run, on every CLI row", () => {
    for (const channel of ["default", "alpha"] as const) {
      setChannel(channel);
      for (const target of agentTargets()) {
        if (!target.detail.startsWith("Runs ")) continue;
        const shown = target.detail.slice("Runs ".length);
        expect(shown, `${target.id} on ${channel}`).toContain(serverName());
      }
    }
  });
});
