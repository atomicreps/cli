import { MAX_LOCAL_QUIET_MS } from "./constants.js";

export type EpochMs = number;

export function now(): EpochMs {
  return Date.now();
}

export function sameLocalDay(a: EpochMs, b: EpochMs): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function iso(at: EpochMs): string {
  return new Date(at).toISOString();
}

export function hhmm(at: EpochMs): string {
  const local = new Date(at);
  return `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`;
}

export function localDate(at: EpochMs): string {
  return new Date(at).toLocaleDateString();
}

export type Deadline = { readonly at: EpochMs; remaining(): number; passed(): boolean };

export function deadline(budgetMs: number, start: EpochMs = now()): Deadline {
  const at = start + budgetMs;
  return {
    at,
    remaining: () => Math.max(0, at - now()),
    passed: () => now() > at,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function within(ms: number, parent?: AbortSignal): AbortSignal {
  const deadlineSignal = AbortSignal.timeout(ms);
  return parent === undefined ? deadlineSignal : AbortSignal.any([deadlineSignal, parent]);
}

export function locallyQuiet(nextEligibleAt: number, at: EpochMs): boolean {
  return nextEligibleAt > at && nextEligibleAt - at <= MAX_LOCAL_QUIET_MS;
}

export function clampQuiet(nextEligibleAt: number, at: EpochMs): number {
  return Math.min(nextEligibleAt, at + MAX_LOCAL_QUIET_MS);
}
