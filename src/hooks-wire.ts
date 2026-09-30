import { dirname, join } from "node:path";

import { isAlpha } from "./config.js";
import type { Applied } from "./connect.js";
import { readJsonFile, readSettingsFile, type SettingsRead, writeSettingsFile } from "./files.js";
import { pinnedCommand } from "./statusline-wire.js";
import { isRecord } from "./types.js";

export const HOOK_EVENTS = ["Stop", "UserPromptSubmit"] as const;

const HOOK_TIMEOUT_S = 5;

export function hookCommand(): string {
  return pinnedCommand("hook");
}

const OURS = /\batomicreps\b[^\n|]*\bhook\b/;

function isOurs(command: string): boolean {
  return OURS.test(command);
}

function oursHere(command: string): boolean {
  return isOurs(command) && /\bhook --alpha\b/.test(command) === isAlpha();
}

type Settings = Record<string, unknown>;

function readSettings(path: string): SettingsRead {
  return readSettingsFile(path, "the hooks");
}

function commandsOf(settings: Settings, event: string): string[] {
  const hooks = isRecord(settings.hooks) ? settings.hooks : {};
  const groups = hooks[event];
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group) =>
    isRecord(group) && Array.isArray(group.hooks)
      ? group.hooks.flatMap((hook) =>
          isRecord(hook) && typeof hook.command === "string" ? [hook.command] : [],
        )
      : [],
  );
}

export function claudePluginNames(settingsPath: string): string[] {
  const registry = readJsonFile<{ plugins?: unknown }>(
    join(dirname(settingsPath), "plugins", "installed_plugins.json"),
  );
  const plugins = isRecord(registry?.plugins) ? registry.plugins : {};
  return Object.keys(plugins).filter((name) => name.startsWith("atomicreps"));
}

export function hooksWired(path: string): boolean {
  const read = readSettings(path);
  if ("failed" in read) return false;
  return HOOK_EVENTS.every((event) =>
    commandsOf(read.settings, event).some((c) => oursHere(c) && c.includes("|| npx")),
  );
}

export function hooksOurs(path: string): boolean {
  const read = readSettings(path);
  if ("failed" in read) return false;
  return HOOK_EVENTS.some((event) => commandsOf(read.settings, event).some(isOurs));
}

function withoutOurs(
  groups: readonly unknown[],
  mine: (command: string) => boolean,
): { kept: unknown[]; removed: number } {
  const kept: unknown[] = [];
  let removed = 0;
  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group.hooks)) {
      kept.push(group);
      continue;
    }
    const rest = group.hooks.filter(
      (hook) => !(isRecord(hook) && typeof hook.command === "string" && mine(hook.command)),
    );
    removed += group.hooks.length - rest.length;
    if (rest.length > 0)
      kept.push(rest.length === group.hooks.length ? group : { ...group, hooks: rest });
  }
  return { kept, removed };
}

export function wireHooks(path: string, command = hookCommand()): Applied {
  const plugins = claudePluginNames(path);
  if (plugins.length > 0) {
    return {
      state: "noted",
      says: `the ${plugins.join(", ")} plugin already runs these hooks, so nothing was written; a second copy would print every question twice`,
    };
  }
  const read = readSettings(path);
  if ("failed" in read) return { state: "failed", says: read.failed };
  const { settings } = read;
  const hooks = isRecord(settings.hooks) ? settings.hooks : {};
  const next: Settings = { ...hooks };
  let added = 0;
  for (const event of HOOK_EVENTS) {
    if (commandsOf(settings, event).includes(command)) continue;
    const groups = withoutOurs(Array.isArray(hooks[event]) ? hooks[event] : [], oursHere).kept;
    const ours = { hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_S }] };
    next[event] = [...groups, ours];
    added += 1;
  }
  if (added === 0) return { state: "done", says: "already in place" };
  writeSettingsFile(path, { ...settings, hooks: next });
  return { state: "done", says: `Stop and UserPromptSubmit hooks set in ${path}` };
}

export function unwireHooks(path: string): Applied {
  const read = readSettings(path);
  if ("failed" in read) return { state: "failed", says: read.failed };
  const { settings } = read;
  if (!isRecord(settings.hooks)) return { state: "done", says: "already gone" };
  const next: Settings = { ...settings.hooks };
  let removed = 0;
  for (const event of HOOK_EVENTS) {
    const groups = next[event];
    if (!Array.isArray(groups)) continue;
    const taken = withoutOurs(groups, isOurs);
    removed += taken.removed;
    const kept = taken.kept;
    if (kept.length > 0) next[event] = kept;
    else delete next[event];
  }
  if (removed === 0) return { state: "done", says: "already gone" };
  const { hooks: _ours, ...others } = settings;
  writeSettingsFile(path, Object.keys(next).length > 0 ? { ...settings, hooks: next } : others);
  return { state: "done", says: `removed from ${path}` };
}
