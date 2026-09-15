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
let followed = false;

export function setChannel(next: Channel, opts: { followed?: boolean } = {}): void {
  channel = next;
  followed = opts.followed ?? false;
}

export function channelFollowedSignIn(): boolean {
  return followed;
}

export function channelOf(): Channel {
  return channel;
}

export function isAlpha(): boolean {
  return channel === "alpha";
}

function configDirFor(target: Channel): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const root = join(base, CONFIG_DIR_NAME);
  return target === "alpha" ? join(root, "alpha") : root;
}

function configDir(): string {
  return configDirFor(channel);
}

export function signedInOn(target: Channel): boolean {
  const config = readJsonFile<Config>(join(configDirFor(target), FILES.config)) ?? {};
  return typeof config.token === "string" && config.token !== "";
}

export const FOLLOWS_SIGN_IN: ReadonlySet<string> = new Set([
  "hook",
  "mcp",
  "statusline",
  "doctor",
]);

export function launchChannel(args: {
  command: string | undefined;
  flagged: boolean;
  env: string | undefined;
  signedIn: (target: Channel) => boolean;
}): { channel: Channel; followed: boolean } {
  if (args.flagged || args.env === "alpha") return { channel: "alpha", followed: false };
  if (!FOLLOWS_SIGN_IN.has(args.command ?? "")) return { channel: "default", followed: false };
  if (args.signedIn("default") || !args.signedIn("alpha")) {
    return { channel: "default", followed: false };
  }
  return { channel: "alpha", followed: true };
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
  updateConfig({
    lastQuietAt: now,
    lastQuiet: message.slice(0, MAX_NOTE_CHARS),
    quietReason: reason,
  });
}

const LOOPBACK = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/;

function envOrigin(
  name: string,
  ours: readonly string[],
  fallback: string,
): { origin: string; rejected: string | null } {
  const override = (process.env[name] ?? "").trim().replace(/\/+$/, "");
  if (override === "") return { origin: fallback, rejected: null };
  const allowed =
    ours.includes(override) || process.env[ENV.unsafeOrigin] === "1" || LOOPBACK.test(override);
  return allowed ? { origin: override, rejected: null } : { origin: fallback, rejected: override };
}

const DOORS = [DEFAULT_API, ALPHA_API] as const;
const SITES = [DEFAULT_SITE, ALPHA_SITE] as const;

export function apiOrigin(): string {
  return envOrigin(ENV.api, DOORS, isAlpha() ? ALPHA_API : DEFAULT_API).origin;
}

export function siteOrigin(): string {
  return envOrigin(ENV.site, SITES, isAlpha() ? ALPHA_SITE : DEFAULT_SITE).origin;
}

export function rejectedOverrides(): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const [name, ours] of [
    [ENV.api, DOORS],
    [ENV.site, SITES],
  ] as const) {
    const { rejected } = envOrigin(name, ours, "");
    if (rejected !== null) out.push({ name, value: rejected });
  }
  return out;
}

export function clientLabel(): string {
  const client = process.env[ENV.client] || "npx atomicreps";
  return `${client} on ${hostname()}`;
}

export function hostLabel(): string {
  return hostname();
}
