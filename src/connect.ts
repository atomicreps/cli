import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { isAlpha } from "./config.js";
import { PROBE_MS, TOOL_NAMES } from "./constants.js";
import { ensureDir, readJsonFile, writeFileAtomic } from "./files.js";
import { isRecord, stringList } from "./types.js";
import { SERVER_VERSION } from "./version.js";

export function serverName(): string {
  return isAlpha() ? "atomicreps-alpha" : "atomicreps";
}

export function bridgeArgs(pin = false): string[] {
  const pkg = pin ? `atomicreps@${SERVER_VERSION}` : "atomicreps";
  return isAlpha() ? ["-y", pkg, "mcp", "--alpha"] : ["-y", pkg, "mcp"];
}

export function toolAllowlist(): string[] {
  return TOOL_NAMES.map((tool) => `mcp__${serverName()}__${tool}`);
}

export function claudeAddArgs(pin = false): string[] {
  return ["mcp", "add", "--scope", "user", serverName(), "--", "npx", ...bridgeArgs(pin)];
}

export function claudeAddCommand(pin = false): string {
  return `claude ${claudeAddArgs(pin).join(" ")}`;
}

export function cursorConfig(pin = false): Record<string, unknown> {
  return { mcpServers: { [serverName()]: { command: "npx", args: bridgeArgs(pin) } } };
}

export function claudeSettingsPath(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR;
  if (configured) return join(configured, "settings.json");
  return join(homedir(), ".claude", "settings.json");
}

function cliAnswers(command: string): boolean {
  try {
    const probe = spawnSync(command, ["--version"], { stdio: "ignore", timeout: PROBE_MS });
    return probe.status === 0;
  } catch {
    return false;
  }
}

let claudeProbe: boolean | undefined;

export function claudeAvailable(): boolean {
  return (claudeProbe ??= cliAnswers("claude"));
}

function unusableSettings(path: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? "settings.json is not an object" : null;
  } catch {
    return "could not parse the file; add the allowlist by hand";
  }
}

export function allowInClaude(): { added: string[]; path: string; skipped?: string } {
  const path = claudeSettingsPath();
  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    const parsed = readJsonFile<Record<string, unknown>>(path);
    if (parsed === null) {
      const skipped = unusableSettings(path);
      if (skipped !== null) return { added: [], path, skipped };
    } else settings = parsed;
  }
  const permissions = isRecord(settings.permissions) ? settings.permissions : {};
  const allow = stringList(permissions.allow);
  const added = toolAllowlist().filter((tool) => !allow.includes(tool));
  if (added.length === 0) return { added, path };
  const next = { ...settings, permissions: { ...permissions, allow: [...allow, ...added] } };
  writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
  return { added, path };
}

export function allowlistMissing(): string[] {
  const parsed = readJsonFile<{ permissions?: { allow?: unknown } }>(claudeSettingsPath());
  const allow = Array.isArray(parsed?.permissions?.allow) ? parsed.permissions.allow : [];
  return toolAllowlist().filter((tool) => !allow.includes(tool));
}

export type AgentId = "claude" | "allowlist" | "cursor" | "codex" | "windsurf" | "manual";

export type Applied = { state: "done" | "noted" | "failed"; says: string };

export type AgentTarget = {
  id: AgentId;
  label: string;
  hint: string;
  detail: string;
  found: () => boolean;
  done?: () => boolean;
  apply: (found: boolean) => Applied;
};

function tilde(path: string): string {
  return path.replace(homedir(), "~");
}

export function cursorMcpPath(): string {
  return join(homedir(), ".cursor", "mcp.json");
}

export function windsurfMcpPath(): string {
  return join(homedir(), ".codeium", "windsurf", "mcp_config.json");
}

export function mergeMcpJson(path: string, pin = false): Applied {
  const parsed = readJsonFile<Record<string, unknown>>(path);
  if (parsed === null && existsSync(path)) {
    return { state: "failed", says: `${path} did not parse; add the entry by hand` };
  }
  const base = parsed ?? {};
  const servers = isRecord(base.mcpServers) ? base.mcpServers : {};
  const next = {
    ...base,
    mcpServers: { ...servers, [serverName()]: { command: "npx", args: bridgeArgs(pin) } },
  };
  ensureDir(dirname(path));
  writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
  return { state: "done", says: `added to ${path}` };
}

export function codexAddArgs(pin = false): string[] {
  return ["mcp", "add", serverName(), "--", "npx", ...bridgeArgs(pin)];
}

export function codexAddCommand(pin = false): string {
  return `codex ${codexAddArgs(pin).join(" ")}`;
}

function runCli(
  found: boolean,
  command: string,
  args: string[],
  said: string,
  line: string,
): Applied {
  if (!found) return { state: "noted", says: `not on this path; run: ${line}` };
  const run = spawnSync(command, args, { encoding: "utf8" });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
  return run.status === 0
    ? { state: "done", says: said }
    : { state: "failed", says: output || `could not run: ${line}` };
}

export function agentTargets(pin = false): readonly AgentTarget[] {
  return [
    {
      id: "claude",
      label: "Claude Code",
      hint: "user scope",
      detail: `Runs ${claudeAddCommand(pin)}`,
      found: () => claudeAvailable(),
      apply: (found) =>
        runCli(found, "claude", claudeAddArgs(pin), "added at user scope", claudeAddCommand(pin)),
    },
    {
      id: "allowlist",
      label: "\u2026and allow its four tools",
      hint: tilde(claudeSettingsPath()),
      detail:
        "Adds rep, answer, me and settings to permissions.allow, so the first rep is not a permission prompt in front of your build. Everything else in the file is left alone.",
      found: () => claudeAvailable(),
      done: () => allowlistMissing().length === 0,
      apply: () => {
        const run = allowInClaude();
        if (run.skipped !== undefined) return { state: "failed", says: run.skipped };
        return {
          state: "done",
          says:
            run.added.length === 0
              ? "already in place"
              : `${run.added.length} tools added to ${run.path}`,
        };
      },
    },
    {
      id: "cursor",
      label: "Cursor",
      hint: tilde(cursorMcpPath()),
      detail: "Adds one entry to the mcpServers object; anything already in that file stays.",
      found: () => existsSync(join(homedir(), ".cursor")),
      apply: () => mergeMcpJson(cursorMcpPath(), pin),
    },
    {
      id: "windsurf",
      label: "Windsurf",
      hint: tilde(windsurfMcpPath()),
      detail: "Adds one entry to the mcpServers object; anything already in that file stays.",
      found: () => existsSync(join(homedir(), ".codeium", "windsurf")),
      apply: () => mergeMcpJson(windsurfMcpPath(), pin),
    },
    {
      id: "codex",
      label: "Codex",
      hint: "codex mcp add",
      detail: `Runs ${codexAddCommand(pin)}`,
      found: () => cliAnswers("codex"),
      apply: (found) =>
        runCli(found, "codex", codexAddArgs(pin), "registered with Codex", codexAddCommand(pin)),
    },
    {
      id: "manual",
      label: "I'll set it up myself",
      hint: "print the config, write nothing",
      detail:
        "Another MCP client, something running locally, or a machine you would rather wire up by hand. Nothing is written; the server entry and the token page are printed for you to copy.",
      found: () => true,
      apply: () => ({ state: "noted", says: "printed below" }),
    },
  ];
}

export type Offer = { target: AgentTarget; found: boolean; apply: () => Applied };

export function orderOffers<T extends { target: AgentTarget; found: boolean }>(
  offers: readonly T[],
): T[] {
  const rank = (offer: T): number => (offer.target.id === "manual" ? 2 : offer.found ? 0 : 1);
  return offers
    .map((offer, index) => ({ offer, index }))
    .toSorted((a, b) => rank(a.offer) - rank(b.offer) || a.index - b.index)
    .map((entry) => entry.offer);
}

export function connectOffers(pin = false): Offer[] {
  return orderOffers(
    agentTargets(pin)
      .filter((target) => target.done?.() !== true)
      .map((target) => {
        const found = target.found();
        return { target, found, apply: () => target.apply(found) };
      }),
  );
}
