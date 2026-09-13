import { appendFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

import * as clock from "./clock.js";
import {
  ALPHA_API,
  ALPHA_SITE,
  CONFIG_DIR_NAME,
  DEFAULT_API,
  DEFAULT_SITE,
  ENV,
  FILE_MODE,
  FILES,
  MAX_ERROR_LOG_BYTES,
  MAX_NOTE_CHARS,
} from "./constants.js";
import { ensureDir, readJsonFile, writeJsonAtomic } from "./files.js";
import type { Channel, Config } from "./types.js";

let channel: Channel = "default";

export function setChannel(next: Channel): void {
  channel = next;
}

export function channelOf(): Channel {
  return channel;
}

export function isAlpha(): boolean {
  return channel === "alpha";
}

function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const root = join(base, CONFIG_DIR_NAME);
  return isAlpha() ? join(root, "alpha") : root;
}

export function configPath(): string {
  return join(configDir(), FILES.config);
}

export function errorLogPath(): string {
  return join(configDir(), FILES.errorLog);
}

export function readConfig(): Config {
  return readJsonFile<Config>(configPath()) ?? {};
}

function ensureConfigDir(): string {
  const dir = configDir();
  ensureDir(dir);
  return dir;
}

export function writeConfig(config: Config): void {
  ensureConfigDir();
  writeJsonAtomic(configPath(), config, FILE_MODE);
}

export function updateConfig(patch: Partial<Config>): Config {
  const next = { ...readConfig(), ...patch };
  writeConfig(next);
  return next;
}

export function noteFailure(message: string, now: clock.EpochMs): void {
  ensureConfigDir();
  const line = `${clock.iso(now)} ${message.slice(0, MAX_NOTE_CHARS)}\n`;
  try {
    const path = errorLogPath();
    if (existsSync(path) && statSync(path).size > MAX_ERROR_LOG_BYTES) {
      writeFileSync(path, "", { mode: FILE_MODE });
    }
    appendFileSync(path, line, { mode: FILE_MODE });
  } catch {
  }
  updateConfig({ lastFailureAt: now, lastFailure: message.slice(0, MAX_NOTE_CHARS) });
}

export function noteQuiet(reason: string, detail: string | undefined, now: clock.EpochMs): void {
  const message = detail ? `${reason}: ${detail}` : reason;
  updateConfig({ lastQuietAt: now, lastQuiet: message.slice(0, MAX_NOTE_CHARS) });
}

export function apiOrigin(): string {
  const fallback = isAlpha() ? ALPHA_API : DEFAULT_API;
  return (process.env[ENV.api] || fallback).replace(/\/+$/, "");
}

export function siteOrigin(): string {
  const fallback = isAlpha() ? ALPHA_SITE : DEFAULT_SITE;
  return (process.env[ENV.site] || fallback).replace(/\/+$/, "");
}

export function clientLabel(): string {
  const client = process.env[ENV.client] || "npx atomicreps";
  return `${client} on ${hostname()}`;
}

export function hostLabel(): string {
  return hostname();
}
