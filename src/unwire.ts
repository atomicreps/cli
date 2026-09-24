import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  type Applied,
  claudeAvailable,
  claudeSettingsPath,
  cursorMcpPath,
  runCli,
  vscodeMcpPath,
  windsurfMcpPath,
} from "./connect.js";
import { PROBE_MS, TOOL_NAMES } from "./constants.js";
import { readJsonFile, writeFileAtomic } from "./files.js";
import { statusLineOurs, unwireStatusLine } from "./statusline-wire.js";
import { isRecord, stringList } from "./types.js";

const SERVERS = [
  { name: "atomicreps", tag: "" },
  { name: "atomicreps-alpha", tag: " (alpha)" },
] as const;

export type Leftover = {
  id: string;
  label: string;
  hint: string;
  detail: string;
  remove: () => Applied;
};

export type CliProbe = (command: "codex", name: string) => boolean;

function cliHas(command: "codex", name: string): boolean {
  try {
    const probe = spawnSync(command, ["mcp", "get", name], { stdio: "ignore", timeout: PROBE_MS });
    return probe.status === 0;
  } catch {
    return false;
  }
}

function claudeJsonPath(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR;
  return configured ? join(configured, ".claude.json") : join(homedir(), ".claude.json");
}

function copilotMcpPath(): string {
  return join(process.env.COPILOT_HOME ?? join(homedir(), ".copilot"), "mcp-config.json");
}

function tilde(path: string): string {
  return path.replace(homedir(), "~");
}

function jsonTargets(): Array<{ id: string; label: string; path: string; key: string }> {
  return [
    { id: "vscode", label: "VS Code (Copilot)", path: vscodeMcpPath(), key: "servers" },
    { id: "copilot", label: "Copilot CLI", path: copilotMcpPath(), key: "mcpServers" },
    { id: "cursor", label: "Cursor", path: cursorMcpPath(), key: "mcpServers" },
    { id: "windsurf", label: "Windsurf", path: windsurfMcpPath(), key: "mcpServers" },
  ];
}

function hasServer(path: string, key: string, name: string): boolean {
  const parsed = readJsonFile<Record<string, unknown>>(path);
  const servers = parsed?.[key];
  return isRecord(servers) && name in servers;
}

function removeServer(path: string, key: string, name: string): Applied {
  const parsed = readJsonFile<Record<string, unknown>>(path);
  const servers = parsed?.[key];
  if (parsed === null || !isRecord(servers)) {
    return { state: "failed", says: `${path} did not parse; remove ${name} by hand` };
  }
  const { [name]: _ours, ...rest } = servers;
  writeFileAtomic(path, `${JSON.stringify({ ...parsed, [key]: rest }, null, 2)}\n`);
  return { state: "done", says: `removed from ${tilde(path)}` };
}

function ourRules(name: string): string[] {
  return TOOL_NAMES.map((tool) => `mcp__${name}__${tool}`);
}

function allowedRules(name: string): string[] {
  const parsed = readJsonFile<{ permissions?: { allow?: unknown } }>(claudeSettingsPath());
  const allow = stringList(parsed?.permissions?.allow);
  return ourRules(name).filter((rule) => allow.includes(rule));
}

function removeRules(name: string): Applied {
  const path = claudeSettingsPath();
  const parsed = readJsonFile<Record<string, unknown>>(path);
  if (parsed === null) return { state: "failed", says: `${path} did not parse; remove by hand` };
  const permissions = isRecord(parsed.permissions) ? parsed.permissions : {};
  const ours = new Set(ourRules(name));
  const allow = stringList(permissions.allow).filter((rule) => !ours.has(rule));
  const next = { ...parsed, permissions: { ...permissions, allow } };
  writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
  return { state: "done", says: `removed from ${tilde(path)}` };
}

export function leftovers(probe: CliProbe = cliHas): Leftover[] {
  const found: Leftover[] = [];
  const claudeServers = readJsonFile<{ mcpServers?: unknown }>(claudeJsonPath())?.mcpServers;
  for (const { name, tag } of SERVERS) {
    if (isRecord(claudeServers) && name in claudeServers) {
      const line = `claude mcp remove --scope user ${name}`;
      found.push({
        id: `claude:${name}`,
        label: `Claude Code${tag}`,
        hint: "user scope",
        detail: `Runs ${line}`,
        remove: () =>
          runCli(claudeAvailable(), "claude", line.split(" ").slice(1), "removed", line),
      });
    }
  }
  for (const { name, tag } of SERVERS) {
    const rules = allowedRules(name);
    if (rules.length === 0) continue;
    found.push({
      id: `allow:${name}`,
      label: `…its allowed tools${tag}`,
      hint: tilde(claudeSettingsPath()),
      detail: `Removes ${rules.join(", ")} from permissions.allow. Every other rule stays.`,
      remove: () => removeRules(name),
    });
  }
  if (existsSync(claudeSettingsPath()) && statusLineOurs(claudeSettingsPath())) {
    found.push({
      id: "statusline",
      label: "…its status line",
      hint: tilde(claudeSettingsPath()),
      detail:
        "Puts back the status line you had before connect, or removes ours if there was none. Nothing else in the file changes.",
      remove: () => unwireStatusLine(claudeSettingsPath()),
    });
  }
  for (const target of jsonTargets()) {
    for (const { name, tag } of SERVERS) {
      if (!hasServer(target.path, target.key, name)) continue;
      found.push({
        id: `${target.id}:${name}`,
        label: `${target.label}${tag}`,
        hint: tilde(target.path),
        detail: `Removes the ${name} entry. Every other server in that file stays.`,
        remove: () => removeServer(target.path, target.key, name),
      });
    }
  }
  for (const { name, tag } of SERVERS) {
    if (!probe("codex", name)) continue;
    const line = `codex mcp remove ${name}`;
    found.push({
      id: `codex:${name}`,
      label: `Codex${tag}`,
      hint: "codex mcp remove",
      detail: `Runs ${line}`,
      remove: () => runCli(true, "codex", line.split(" ").slice(1), "removed", line),
    });
  }
  return found;
}
