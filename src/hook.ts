import * as api from "./api.js";
import * as clock from "./clock.js";
import { readConfig, updateConfig } from "./config.js";
import {
  DEGRADED_BACKOFF_MS,
  HOOK_DEADLINE_MS,
  INFER_BUDGET_MS,
  MAX_SHORT_PROMPT_CHARS,
} from "./constants.js";
import { isRepBlock } from "./format.js";
import { inferHints } from "./infer.js";
import {
  cachedGrammar,
  cachedGrammarVersion,
  cachedMuteKeys,
  ensureGrammar,
  observeClient,
  observeRep,
  observeVerdict,
  openOffer,
  pendingRep,
} from "./store.js";
import { allMuted } from "./touch.js";
import {
  asPick,
  type ApiResult,
  type HookInput,
  type HookOutput,
  type OfferEntry,
  type Pick,
  type StoredRep,
  type ToolReply,
} from "./types.js";

const LETTER = /^\s*([A-Da-d])(?:[.):]|\s|$)/;
const DIGIT = /^\s*([1-3])(?:[.):]|\s|$)/;

export const REP_ETIQUETTE =
  "A rep for the person at the keyboard arrived from Atomic Reps. After you finish answering their message, append the block below verbatim as the last thing you write. Do not solve it, hint at it, or comment on it. If their next message is a single letter, the hook grades it. This block is the only rep this turn; never write one yourself.";

export const QUIET_CONTEXT =
  "Atomic Reps: no rep this turn. Write no rep block and say nothing about this. A rep exists only as text the hook or the rep tool hands you; never compose, complete or paraphrase one.";

export const VERDICT_ETIQUETTE =
  "The person just answered their pending rep and the verdict is below. Relay the block verbatim as your whole reply, nothing before or after.";

export const ASKED_ETIQUETTE =
  "The person asked for another rep by number and it is below. Relay the block verbatim as your whole reply, nothing before or after. If their next message is a single letter, the hook grades it.";

function context(text: string): HookOutput {
  return {
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text },
  };
}

function quiet(): HookOutput {
  return context(QUIET_CONTEXT);
}

function parseInput(raw: string): HookInput {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as HookInput) : {};
  } catch {
    return {};
  }
}

export function letterOf(prompt: string): Pick | null {
  if (prompt.length > MAX_SHORT_PROMPT_CHARS) return null;
  return asPick(LETTER.exec(prompt)?.[1]);
}

export function digitOf(prompt: string): number | null {
  if (prompt.length > MAX_SHORT_PROMPT_CHARS) return null;
  const match = DIGIT.exec(prompt);
  return match?.[1] === undefined ? null : Number(match[1]);
}

async function gradeLetter(pick: Pick, id: string, now: clock.EpochMs): Promise<HookOutput | null> {
  const result = await api.answer(id, pick);
  if (!result.ok) return quiet();
  const data = result.value.data ?? {};
  observeClient(result.value.client, now);
  observeVerdict(id, data, result.value.text, now);
  if (data.status === "not_served" || data.status === "rate_limited") return quiet();
  return context(`${VERDICT_ETIQUETTE}\n\n${result.value.text}`);
}

async function handOver(
  result: ApiResult<ToolReply>,
  etiquette: string,
  now: clock.EpochMs,
): Promise<HookOutput> {
  if (!result.ok) return quiet();
  const data = result.value.data ?? {};
  observeClient(result.value.client, now);
  observeRep(data, result.value.text, now);
  if (data.kind !== "question" && data.kind !== "insight") return quiet();
  if (!isRepBlock(result.value.text)) return quiet();
  return context(`${etiquette}\n\n${result.value.text}`);
}

async function fetchRep(cwd: string, now: clock.EpochMs): Promise<HookOutput | null> {
  const hints = await inferHints(cwd, INFER_BUDGET_MS, cachedGrammar());
  if (allMuted(hints.touched, cachedMuteKeys(now))) return quiet();
  const result = await api.rep({ hints, kind: "auto" }, HOOK_DEADLINE_MS);
  if (!result.ok) updateConfig({ nextEligibleAt: now + DEGRADED_BACKOFF_MS });
  return await handOver(result, REP_ETIQUETTE, now);
}

export type HookState = {
  hasToken: boolean;
  nextEligibleAt: clock.EpochMs | undefined;
  pending: StoredRep | undefined;
  offer: readonly OfferEntry[];
};

export type HookAction =
  | { kind: "ignore" }
  | { kind: "quiet" }
  | { kind: "grade"; id: string; pick: Pick }
  | { kind: "take"; handle: string }
  | { kind: "push"; cwd: string };

export function decide(input: HookInput, state: HookState, now: clock.EpochMs): HookAction {
  if (input.hook_event_name !== undefined && input.hook_event_name !== "UserPromptSubmit") {
    return { kind: "ignore" };
  }
  if (!state.hasToken) return { kind: "quiet" };

  const prompt = input.prompt ?? "";
  const letter = letterOf(prompt);
  if (letter && state.pending) return { kind: "grade", id: state.pending.id, pick: letter };

  const digit = digitOf(prompt);
  const entry = digit === null || state.pending ? undefined : state.offer[digit - 1];
  if (entry) return { kind: "take", handle: entry.handle };

  if (state.nextEligibleAt !== undefined && clock.locallyQuiet(state.nextEligibleAt, now)) {
    return { kind: "quiet" };
  }
  if (state.pending) return { kind: "quiet" };
  return { kind: "push", cwd: input.cwd ?? process.cwd() };
}

export function readState(now: clock.EpochMs): HookState {
  const config = readConfig();
  return {
    hasToken: Boolean(config.token),
    nextEligibleAt: config.nextEligibleAt,
    pending: pendingRep(now),
    offer: openOffer(now),
  };
}

export async function perform(action: HookAction, now: clock.EpochMs): Promise<HookOutput | null> {
  switch (action.kind) {
    case "ignore":
      return null;
    case "quiet":
      return quiet();
    case "grade":
      return await gradeLetter(action.pick, action.id, now);
    case "take":
      return await handOver(
        await api.rep({ ask: action.handle }, HOOK_DEADLINE_MS),
        ASKED_ETIQUETTE,
        now,
      );
    case "push":
      return await fetchRep(action.cwd, now);
  }
}

export async function runHook(raw: string, now = clock.now()): Promise<HookOutput | null> {
  return await perform(decide(parseInput(raw), readState(now), now), now);
}

export async function refreshGrammar(now = clock.now()): Promise<void> {
  if (!readConfig().token) return;
  const held = cachedGrammar();
  const wanted = cachedGrammarVersion(now);
  if (held !== null && (wanted === undefined || held.version === wanted)) return;
  await ensureGrammar(now, wanted, HOOK_DEADLINE_MS);
}
