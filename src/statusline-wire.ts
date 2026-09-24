import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { configPath, isAlpha } from "./config.js";
import type { Applied } from "./connect.js";
import { ensureDir, writeFileAtomic } from "./files.js";
import { isRecord } from "./types.js";

const OURS = /\batomicreps\b[^\n|]*\bstatusline\b/;

function quoted(path: string): string {
  return `"${path.replaceAll('"', '\\"')}"`;
}

export function statusLineCommand(
  node = process.execPath,
  cli = resolve(process.argv[1] ?? "cli.js"),
): string {
  const flag = isAlpha() ? " --alpha" : "";
  return `${quoted(node)} ${quoted(cli)} statusline${flag} 2>/dev/null || npx -y atomicreps statusline${flag}`;
}

export function statusLineWrapperPath(): string {
  return join(dirname(configPath()), "statusline.sh");
}

function wrapperScript(original: string, ours: string): string {
  return [
    "#!/bin/sh",
    "input=$(cat)",
    `first=$(printf '%s' "$input" | ${original})`,
    `[ -n "$first" ] && printf '%s\\n' "$first"`,
    `printf '%s' "$input" | ${ours}`,
    "",
  ].join("\n");
}

type Settings = Record<string, unknown>;

function readSettings(path: string): { settings: Settings } | { failed: string } {
  if (!existsSync(path)) return { settings: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { failed: "could not parse the file; add the status line by hand" };
  }
  return isRecord(raw) ? { settings: raw } : { failed: "settings.json is not an object" };
}

function commandOf(settings: Settings): string | undefined {
  const line = settings.statusLine;
  return isRecord(line) && typeof line.command === "string" ? line.command : undefined;
}

function isOurs(command: string): boolean {
  const wrapper = statusLineWrapperPath();
  return OURS.test(command) || (command.includes(wrapper) && existsSync(wrapper));
}

function writeSettings(path: string, settings: Settings): void {
  writeFileAtomic(path, `${JSON.stringify(settings, null, 2)}\n`);
}

export function statusLineWired(path: string): boolean {
  const read = readSettings(path);
  if ("failed" in read) return false;
  const command = commandOf(read.settings);
  return command !== undefined && isOurs(command);
}

export function statusLineOurs(path: string): boolean {
  const read = readSettings(path);
  if ("failed" in read) return false;
  const command = commandOf(read.settings);
  return command !== undefined && OURS.test(command);
}

function wrapperOf(command: string): string | undefined {
  const match = /^sh "(.+)"$/.exec(command);
  return match?.[1]?.replaceAll('\\"', '"');
}

function originalIn(wrapper: string): string | undefined {
  const prefix = `first=$(printf '%s' "$input" | `;
  const line = readFileSync(wrapper, "utf8")
    .split("\n")
    .find((row) => row.startsWith(prefix) && row.endsWith(")"));
  return line?.slice(prefix.length, -1);
}

export function unwireStatusLine(path: string): Applied {
  const read = readSettings(path);
  if ("failed" in read) return { state: "failed", says: read.failed };
  const { settings } = read;
  const command = commandOf(settings);
  if (command === undefined || !OURS.test(command)) return { state: "done", says: "already gone" };
  const line = isRecord(settings.statusLine) ? settings.statusLine : {};
  const wrapper = wrapperOf(command);
  const original = wrapper !== undefined && existsSync(wrapper) ? originalIn(wrapper) : undefined;
  if (original !== undefined && wrapper !== undefined) {
    writeSettings(path, { ...settings, statusLine: { ...line, command: original } });
    rmSync(wrapper, { force: true });
    return { state: "done", says: `your own status line is back (${original})` };
  }
  const { statusLine: _ours, ...rest } = settings;
  writeSettings(path, rest);
  return { state: "done", says: `removed from ${path}` };
}

export function wireStatusLine(path: string, ours = statusLineCommand()): Applied {
  const read = readSettings(path);
  if ("failed" in read) return { state: "failed", says: read.failed };
  const { settings } = read;
  const line = isRecord(settings.statusLine) ? settings.statusLine : undefined;
  const original = commandOf(settings);
  const wrapper = statusLineWrapperPath();
  const wrapperGone = original?.includes(wrapper) === true && !existsSync(wrapper);
  if (line === undefined || wrapperGone) {
    writeSettings(path, { ...settings, statusLine: { ...line, type: "command", command: ours } });
    return { state: "done", says: `set in ${path}` };
  }
  if (original === undefined || line.type !== "command") {
    return { state: "noted", says: `your statusLine is not a command; add by hand: ${ours}` };
  }
  if (isOurs(original)) return { state: "done", says: "already in place" };
  if (original.includes("ccstatusline")) {
    return {
      state: "noted",
      says: `you run ccstatusline: add a Custom Command widget in its menu with the command ${ours} and a timeout of 2000`,
    };
  }
  if (process.platform === "win32") {
    return { state: "noted", says: `add a second row to your status line by hand: ${ours}` };
  }
  ensureDir(dirname(wrapper));
  writeFileAtomic(wrapper, wrapperScript(original, ours), 0o755);
  writeSettings(path, { ...settings, statusLine: { ...line, command: `sh ${quoted(wrapper)}` } });
  return { state: "done", says: `yours prints first, ours on a second row (${wrapper})` };
}
