import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { setTheme, tint, type Theme } from "./ansi.js";
import * as api from "./api.js";
import { paintBlock } from "./block.js";
import * as clock from "./clock.js";
import { readConfig, updateConfig } from "./config.js";
import { claudeSettingsPath } from "./connect.js";
import {
  DEGRADED_BACKOFF_MS,
  HOOK_DEADLINE_MS,
  INFER_BUDGET_MS,
  MAX_SHORT_PROMPT_CHARS,
  REMIND_LIMIT,
} from "./constants.js";
import { isRepBlock } from "./format.js";
import { inferSession } from "./infer.js";
import {
  cachedGrammar,
  cachedGrammarVersion,
  cachedMuteKeys,
  ensureGrammar,
  noteReprinted,
  noteResolvedElsewhere,
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
  type ClientState,
  type HookInput,
  type HookOutput,
  type OfferEntry,
  type Pick,
  type StoredRep,
  type ToolReply,
} from "./types.js";
import { isBehind } from "./version.js";
import { record, str } from "./wire.js";

const LETTER = /^\s*([A-Da-d])([!?])?(?:[.):]|\s|$)/;
const DIGIT = /^\s*([1-3])(?:[.):]|\s|$)/;
const OUR_COMMAND = /^\s*\/(?:mcp__atomicreps[\w-]*__rep|atomicreps:rep)(?:\s|$)/;

export function isInsightSlot(slot: number): boolean {
  return slot % 2 === 0;
}

export const QUIET_CONTEXT =
  "Atomic Reps: no rep this turn. Write no rep block and say nothing about this. A rep exists only as text the hook, the rep tool or the rep prompt hands you; never compose, complete or paraphrase one.";

export const RESOLVED_CONTEXT =
  "Atomic Reps: the rep the user just answered was already answered elsewhere (the web link or another editor), so there is nothing to grade and no rep is open. Say that in one line. Do not call any Atomic Reps tool and write no rep block.";

export const VERDICT_ETIQUETTE =
  "The user just answered their pending rep and the verdict is below. Relay the block verbatim as your whole reply, nothing before or after.";

export const ASKED_ETIQUETTE =
  "The user asked for another rep by number and it is below. Relay the block verbatim as your whole reply, nothing before or after. If their next message is a single letter, the hook grades it.";

function context(text: string): HookOutput {
  return {
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text },
  };
}

function quiet(): HookOutput {
  return context(QUIET_CONTEXT);
}

function parseInput(raw: string): HookInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const input = record(parsed);
  if (input === undefined) return {};
  const event = str(input.hook_event_name);
  const prompt = str(input.prompt);
  const cwd = str(input.cwd);
  const last = str(input.last_assistant_message);
  return {
    ...(event === undefined ? {} : { hook_event_name: event }),
    ...(prompt === undefined ? {} : { prompt }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(last === undefined ? {} : { last_assistant_message: last }),
  };
}

export function letterOf(prompt: string): { pick: Pick; sure?: boolean } | null {
  if (prompt.length > MAX_SHORT_PROMPT_CHARS) return null;
  const match = LETTER.exec(prompt);
  const pick = asPick(match?.[1]);
  if (!pick) return null;
  const suffix = match?.[2];
  return suffix === undefined ? { pick } : { pick, sure: suffix === "!" };
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

function themeStringFrom(path: string): string | undefined {
  try {
    return str(record(JSON.parse(readFileSync(path, "utf8")) as unknown)?.theme);
  } catch {
    return undefined;
  }
}

export function claudeTheme(): Theme {
  const raw =
    themeStringFrom(claudeSettingsPath()) ?? themeStringFrom(join(homedir(), ".claude.json"));
  return raw?.startsWith("light") === true ? "light" : "dark";
}

export function messageBlock(text: string): string {
  setTheme(claudeTheme());
  return `\n${paintBlock(text, tint, { chrome: true }).join("\n")}`;
}

const HOST_MESSAGE_CAP = 10_000;

export function hostSystemMessage(block: string, upgrade: string): string {
  const painted = messageBlock(block) + upgrade;
  if (painted.length <= HOST_MESSAGE_CAP) return painted;
  return `\n${paintBlock(block, (line) => line, { chrome: true }).join("\n")}${upgrade}`;
}

async function gradeLetter(
  pick: Pick,
  id: string,
  now: clock.EpochMs,
  sure?: boolean,
): Promise<HookOutput | null> {
  const result = await api.answer(id, pick, sure);
  if (!result.ok) return quiet();
  const data = result.value.data ?? {};
  observeClient(result.value.client, now);
  observeVerdict(id, data, result.value.text, now);
  if (data.status === "not_served") {
    noteResolvedElsewhere(id, now);
    return context(RESOLVED_CONTEXT);
  }
  if (data.status === "rate_limited") return quiet();
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

function upgradeLine(client: ClientState | undefined): string {
  const latest = client?.release?.version;
  const running = readConfig().bridgeVersion;
  if (typeof latest !== "string" || typeof running !== "string") return "";
  if (!isBehind(running, latest)) return "";
  updateConfig({ bridgeVersion: undefined });
  const notes = client?.release?.notes;
  const where = typeof notes === "string" && notes !== "" ? `\n  ${notes}` : "";
  return `\n\n${tint(`  atomicreps ${running} → ${latest}. Restart your editor to pick it up.${where}`, "dim")}`;
}

function printServed(
  result: ApiResult<ToolReply>,
  mark: string | null,
  now: clock.EpochMs,
): HookOutput | null {
  const block = servedBlock(result, now);
  if (block === null) return null;
  if (mark !== null) updateConfig({ lastPushTouch: mark });
  return {
    systemMessage: hostSystemMessage(
      block,
      upgradeLine(result.ok ? result.value.client : undefined),
    ),
  };
}

async function fetchRep(cwd: string, now: clock.EpochMs): Promise<HookOutput | null> {
  const { hints, mark } = await inferSession(cwd, INFER_BUDGET_MS, cachedGrammar());
  if (mark !== null && mark === readConfig().lastPushTouch) return null;
  if (allMuted(hints.touched, cachedMuteKeys(now))) return null;
  const result = await api.rep({ hints, kind: "auto" }, HOOK_DEADLINE_MS);
  if (!result.ok) updateConfig({ nextEligibleAt: now + DEGRADED_BACKOFF_MS });
  return printServed(result, mark, now);
}

async function remindRep(
  rep: StoredRep,
  cwd: string,
  now: clock.EpochMs,
): Promise<HookOutput | null> {
  const { hints, mark } = await inferSession(cwd, INFER_BUDGET_MS, cachedGrammar());
  const slot = rep.shown ?? 0;
  const result = await api.rep(
    { hints, kind: "auto", pending: rep.id, reminders: slot },
    HOOK_DEADLINE_MS,
  );
  if (!result.ok) {
    updateConfig({ nextEligibleAt: now + DEGRADED_BACKOFF_MS });
    return null;
  }
  const data = result.value.data ?? {};
  if (data.kind === "open") {
    observeClient(result.value.client, now);
    noteReprinted(rep.id, now, isInsightSlot(slot) ? 2 : 1);
    return { systemMessage: hostSystemMessage(rep.text, "") };
  }
  if (data.kind === "insight") {
    const printed = printServed(result, null, now);
    if (printed === null) return null;
    noteReprinted(rep.id, now);
    return printed;
  }
  noteResolvedElsewhere(rep.id, now);
  return printServed(result, mark, now);
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
  | { kind: "grade"; id: string; pick: Pick; sure?: boolean }
  | { kind: "take"; handle: string }
  | { kind: "remind"; rep: StoredRep; cwd: string }
  | { kind: "push"; cwd: string };

function decideStop(input: HookInput, state: HookState, now: clock.EpochMs): HookAction {
  if (!state.hasToken) return { kind: "ignore" };
  if (endsOnQuestion(input.last_assistant_message)) return { kind: "ignore" };
  if (state.nextEligibleAt !== undefined && clock.locallyQuiet(state.nextEligibleAt, now)) {
    return { kind: "ignore" };
  }
  const cwd = input.cwd ?? process.cwd();
  const pending = state.pending;
  if (pending && (pending.shown ?? 0) < REMIND_LIMIT) return { kind: "remind", rep: pending, cwd };
  return { kind: "push", cwd };
}

export function decide(input: HookInput, state: HookState, now: clock.EpochMs): HookAction {
  const event = input.hook_event_name ?? "UserPromptSubmit";
  if (event === "Stop") return decideStop(input, state, now);
  if (event !== "UserPromptSubmit") return { kind: "ignore" };
  const prompt = input.prompt ?? "";
  if (OUR_COMMAND.test(prompt)) return { kind: "ignore" };
  if (!state.hasToken) return { kind: "quiet" };

  const letter = letterOf(prompt);
  if (letter && state.pending) return { kind: "grade", id: state.pending.id, ...letter };

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
      return await gradeLetter(action.pick, action.id, now, action.sure);
    case "remind":
      return await remindRep(action.rep, action.cwd, now);
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
