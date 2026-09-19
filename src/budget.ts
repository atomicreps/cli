import * as clock from "./clock.js";
import { readConfig, updateConfig } from "./config.js";
import {
  BUDGET_DEFAULT_PER_HOUR,
  BUDGET_PER_HOUR,
  BUDGET_PERIOD_MS,
  MAX_RETRY_AFTER_MS,
} from "./constants.js";
import type { Bucket } from "./types.js";

export type Spend = { ok: true } | { ok: false; reason: "budget" | "rate_limited" };

function rateOf(key: string): number {
  return BUDGET_PER_HOUR[key] ?? BUDGET_DEFAULT_PER_HOUR;
}

function refilled(bucket: Bucket | undefined, rate: number, now: clock.EpochMs): number {
  if (bucket === undefined) return rate;
  const earned = (Math.max(0, now - bucket.at) / BUDGET_PERIOD_MS) * rate;
  return Math.min(rate, bucket.tokens + earned);
}

export function spend(key: string, now: clock.EpochMs = clock.now()): Spend {
  const rate = rateOf(key);
  const buckets = readConfig().budget ?? {};
  const held = buckets[key];
  if (held?.until !== undefined && held.until > now) return { ok: false, reason: "rate_limited" };
  const tokens = refilled(held, rate, now);
  if (tokens < 1) return { ok: false, reason: "budget" };
  updateConfig({ budget: { ...buckets, [key]: { tokens: tokens - 1, at: now } } });
  return { ok: true };
}

export function cool(
  key: string,
  retryAfter: string | null,
  now: clock.EpochMs = clock.now(),
): void {
  const seconds = Number(retryAfter);
  const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : MAX_RETRY_AFTER_MS;
  const buckets = readConfig().budget ?? {};
  const held = buckets[key] ?? { tokens: rateOf(key), at: now };
  updateConfig({
    budget: { ...buckets, [key]: { ...held, until: now + Math.min(wait, MAX_RETRY_AFTER_MS) } },
  });
}
