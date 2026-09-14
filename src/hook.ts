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
} from "./constants.js";
import { isRepBlock } from "./format.js";
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

async function fetchRep(cwd: string, now: clock.EpochMs): Promise<HookOutput | null> {
  const { hints, mark } = await inferSession(cwd, INFER_BUDGET_MS, cachedGrammar());
  if (mark !== null && mark === readConfig().lastPushTouch) return null;
  if (allMuted(hints.touched, cachedMuteKeys(now))) return null;
  const result = await api.rep({ hints, kind: "auto" }, HOOK_DEADLINE_MS);
  if (!result.ok) updateConfig({ nextEligibleAt: now + DEGRADED_BACKOFF_MS });
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
