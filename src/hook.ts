import { tint } from "./ansi.js";
import * as api from "./api.js";
import * as clock from "./clock.js";
import { readConfig, updateConfig } from "./config.js";
import {
  DEGRADED_BACKOFF_MS,
  HOOK_DEADLINE_MS,
  INFER_BUDGET_MS,
  MAX_SHORT_PROMPT_CHARS,
} from "./constants.js";
import { isRepBlock, REP_FOOTER, REP_FOOTER_TAP, REP_MARK, REP_RULE } from "./format.js";
import { inferSession } from "./infer.js";
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
const OUR_COMMAND = /^\s*\/(?:mcp__atomicreps[\w-]*__rep|atomicreps:rep)(?:\s|$)/;

export const QUIET_CONTEXT =
  "Atomic Reps: no rep this turn. Write no rep block and say nothing about this. A rep exists only as text the hook, the rep tool or the rep prompt hands you; never compose, complete or paraphrase one.";

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

export function endsOnQuestion(text: string | undefined): boolean {
  if (typeof text !== "string") return false;
  return /\?[\s*_\u0060~\u0022\u0027)\]]*$/.test(text);
}

export function messageBlock(text: string): string {
  const lines: string[] = [];
  let inCode = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      lines.push(`  ${line}`);
      continue;
    }
    if (line === REP_RULE) {
      lines.push(tint(line, "faint"));
      continue;
    }
    const header = /^⚛ \*\*(.*)\*\*$/.exec(line);
    if (header?.[1] !== undefined) {
      lines.push(`${REP_MARK} ${tint(header[1], "bold", "coral")}`);
      continue;
    }
    if (line === REP_FOOTER || line === REP_FOOTER_TAP || /^_(.+)_$/.test(line)) {
      lines.push(tint(line.replace(/^_(.+)_$/, "$1"), "dim"));
      continue;
    }
    lines.push(line.replace(/\*\*(.+?)\*\*/g, (_, inner: string) => tint(inner, "bold")));
  }
  return `\n${lines.join("\n")}`;
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

function servedBlock(result: ApiResult<ToolReply>, now: clock.EpochMs): string | null {
  if (!result.ok) return null;
  const data = result.value.data ?? {};
  observeClient(result.value.client, now);
  observeRep(data, result.value.text, now);
  if (data.kind !== "question" && data.kind !== "insight") return null;
  if (!isRepBlock(result.value.text)) return null;
  return result.value.text;
}

async function handOver(
  result: ApiResult<ToolReply>,
  etiquette: string,
  now: clock.EpochMs,
): Promise<HookOutput> {
  const block = servedBlock(result, now);
  return block === null ? quiet() : context(`${etiquette}\n\n${block}`);
}

async function fetchRep(cwd: string, now: clock.EpochMs): Promise<HookOutput | null> {
  const { hints, mark } = await inferSession(cwd, INFER_BUDGET_MS, cachedGrammar());
  if (mark !== null && mark === readConfig().lastPushTouch) return null;
  if (allMuted(hints.touched, cachedMuteKeys(now))) return null;
  const result = await api.rep({ hints, kind: "auto" }, HOOK_DEADLINE_MS);
  if (!result.ok) updateConfig({ nextEligibleAt: now + DEGRADED_BACKOFF_MS });
  const block = servedBlock(result, now);
  if (block === null) return null;
  if (mark !== null) updateConfig({ lastPushTouch: mark });
  return { systemMessage: messageBlock(block) };
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

function decideStop(input: HookInput, state: HookState, now: clock.EpochMs): HookAction {
  if (!state.hasToken) return { kind: "ignore" };
  if (endsOnQuestion(input.last_assistant_message)) return { kind: "ignore" };
  if (state.nextEligibleAt !== undefined && clock.locallyQuiet(state.nextEligibleAt, now)) {
    return { kind: "ignore" };
  }
  if (state.pending) return { kind: "ignore" };
  return { kind: "push", cwd: input.cwd ?? process.cwd() };
}

export function decide(input: HookInput, state: HookState, now: clock.EpochMs): HookAction {
  const event = input.hook_event_name ?? "UserPromptSubmit";
  if (event === "Stop") return decideStop(input, state, now);
  if (event !== "UserPromptSubmit") return { kind: "ignore" };
  const prompt = input.prompt ?? "";
  if (OUR_COMMAND.test(prompt)) return { kind: "ignore" };
  if (!state.hasToken) return { kind: "quiet" };

  const letter = letterOf(prompt);
  if (letter && state.pending) return { kind: "grade", id: state.pending.id, pick: letter };

  const digit = digitOf(prompt);
  const entry = digit === null || state.pending ? undefined : state.offer[digit - 1];
  if (entry) return { kind: "take", handle: entry.handle };
  return { kind: "quiet" };
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
