import type { EpochMs } from "./clock.js";
import { BACKGROUND_SEEN_KEPT_MS, BACKGROUND_STALE_MS, ENV } from "./constants.js";
import { record, str } from "./wire.js";

export function unattended(agentId: string | undefined, env: NodeJS.ProcessEnv): boolean {
  if (agentId !== undefined) return true;
  return (env[ENV.claudeEntrypoint] ?? "").startsWith("sdk-");
}

export function backgroundTaskIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry: unknown) => {
    const id = str(record(entry)?.id);
    return id === undefined ? [] : [id];
  });
}

export function stillWorking(
  running: readonly string[],
  seen: Readonly<Record<string, EpochMs>>,
  now: EpochMs,
): { busy: boolean; seen: Record<string, EpochMs> } {
  const next: Record<string, EpochMs> = {};
  for (const [id, at] of Object.entries(seen)) {
    if (now - at < BACKGROUND_SEEN_KEPT_MS) next[id] = at;
  }
  for (const id of running) next[id] ??= now;
  const busy = running.some((id) => now - (next[id] ?? now) < BACKGROUND_STALE_MS);
  return { busy, seen: next };
}
