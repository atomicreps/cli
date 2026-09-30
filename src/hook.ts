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
  HELD_TTL_MS,
  HOOK_DEADLINE_MS,
  INFER_BUDGET_MS,
  MAX_SHORT_PROMPT_CHARS,
} from "./constants.js";
import { noteDecision, noteShown, type Outcome } from "./decisions.js";
import { isRepBlock, partsOfBlock } from "./format.js";
import { inferSession, type Session } from "./infer.js";
import { projectOf } from "./project.js";
import { backgroundTaskIds, stillWorking, unattended } from "./session.js";
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
  pushedIn,
  remindable,
  snapshotOnly,
} from "./store.js";
import { allMuted } from "./touch.js";
import {
  asPick,
  type ApiResult,
  type ClientState,
  type HeldBlock,
  type HookInput,
  type HookOutput,
  type OfferEntry,
  type Pick,
  type StoredRep,
  type ToolReply,
} from "./types.js";
import { isBehind } from "./version.js";
import { record, str } from "./wire.js";

const LETTER = /^\s*([A-Da-d])([!?])?[.):]?\s*$/;
const DIGIT = /^\s*([1-3])[.):]?\s*$/;
const OUR_COMMAND = /^\s*\/(?:mcp__atomicreps[\w-]*__rep|atomicreps:rep)(?:\s|$)/;

function answerLine(withMessage: boolean): string {
  return withMessage ? "the first line of the user's message" : "the user's message";
}

function carryOn(withMessage: boolean): string {
  return withMessage
    ? "Treat the rest of the message as the whole request."
    : 'If you were in the middle of work, carry on with it; otherwise reply with one short line, such as "Answer recorded."';
}

export function recordedContext(withMessage: boolean): string {
  return `Atomic Reps: ${answerLine(withMessage)} was their answer to the Atomic Reps question on screen. The hook has recorded it, and the verdict prints in their terminal when this turn ends. Do not grade, repeat or discuss it, and call no Atomic Reps tool. ${carryOn(withMessage)}`;
}

export function resolvedContext(withMessage: boolean): string {
  return `Atomic Reps: ${answerLine(withMessage)} answered a question that was already answered elsewhere (the web link or another editor), so there is nothing to grade and no rep is open. Say that in one short line, call no Atomic Reps tool and write no rep block. ${carryOn(withMessage)}`;
}

export const ASKED_CONTEXT =
  'Atomic Reps: the user\'s message asked for another Atomic Reps question by number. The hook has fetched it, and it prints in their terminal when this turn ends. Do not show or discuss it, and call no Atomic Reps tool. If you were in the middle of work, carry on with it; otherwise reply with one short line, such as "It prints below."';

function context(text: string): HookOutput {
  return {
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text },
  };
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
  const tasks = backgroundTaskIds(input.background_tasks);
  const agent = str(input.agent_id);
  return {
    ...(event === undefined ? {} : { hook_event_name: event }),
    ...(prompt === undefined ? {} : { prompt }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(last === undefined ? {} : { last_assistant_message: last }),
    ...(tasks === undefined ? {} : { background_tasks: tasks }),
    ...(agent === undefined ? {} : { agent_id: agent }),
  };
}

function isOneLine(prompt: string): boolean {
  return prompt.length <= MAX_SHORT_PROMPT_CHARS && !prompt.trim().includes("\n");
}

export function letterOf(prompt: string): { pick: Pick; sure?: boolean } | null {
  if (!isOneLine(prompt)) return null;
  const match = LETTER.exec(prompt);
  const pick = asPick(match?.[1]);
  if (!pick) return null;
  const suffix = match?.[2];
  return suffix === undefined ? { pick } : { pick, sure: suffix === "!" };
}

export function answerOf(
  prompt: string,
): { pick: Pick; sure?: boolean; withMessage: boolean } | null {
  const whole = letterOf(prompt);
  if (whole) return { ...whole, withMessage: false };
  const [first = "", ...rest] = prompt.trim().split("\n");
  const next = rest.find((line) => line.trim() !== "");
  if (next === undefined || letterOf(next)) return null;
  const letter = letterOf(first);
  return letter ? { ...letter, withMessage: true } : null;
}

export function digitOf(prompt: string): number | null {
  if (!isOneLine(prompt)) return null;
  const match = DIGIT.exec(prompt);
  return match?.[1] === undefined ? null : Number(match[1]);
}

export function showsRep(text: string | undefined, rep: StoredRep): boolean {
  if (typeof text !== "string") return false;
  if (text.includes(`/r/${rep.id}`)) return true;
  const { stem } = partsOfBlock(rep.text);
  return stem !== undefined && stem.length >= MIN_STEM_MATCH && text.includes(stem);
}

const MIN_STEM_MATCH = 24;

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
  action: Extract<HookAction, { kind: "grade" }>,
  now: clock.EpochMs,
): Promise<HookOutput | null> {
  const result = await api.answer(action.id, action.pick, action.sure);
  if (!result.ok) return null;
  const data = result.value.data ?? {};
  observeClient(result.value.client, now);
  observeVerdict(action.id, data, result.value.text, now);
  if (data.status === "not_served") {
    noteResolvedElsewhere(action.id, now);
    return context(resolvedContext(action.withMessage));
  }
  if (data.status === "rate_limited") return null;
  updateConfig({ held: { text: result.value.text, at: now } });
  return context(recordedContext(action.withMessage));
}

function servedBlock(
  result: ApiResult<ToolReply>,
  now: clock.EpochMs,
  project: string,
): string | null {
  if (!result.ok) return null;
  const data = result.value.data ?? {};
  observeClient(result.value.client, now);
  observeRep(data, result.value.text, now, project);
  if (data.kind !== "question" && data.kind !== "insight") return null;
  if (!isRepBlock(result.value.text)) return null;
  return result.value.text;
}

function questionId(result: ApiResult<ToolReply>): string | undefined {
  const data = result.ok ? (result.value.data ?? {}) : {};
  return data.kind === "question" && typeof data.id === "string" ? data.id : undefined;
}

function holdAsked(
  result: ApiResult<ToolReply>,
  now: clock.EpochMs,
  project: string,
): HookOutput | null {
  const block = servedBlock(result, now, project);
  if (block === null) return null;
  const arm = questionId(result);
  updateConfig({
    held: arm === undefined ? { text: block, at: now } : { text: block, at: now, arm },
  });
  return context(ASKED_CONTEXT);
}

function showHeld(held: HeldBlock): HookOutput {
  updateConfig({
    held: undefined,
    ...(held.arm === undefined ? {} : { armedRep: { id: held.arm } }),
  });
  return { systemMessage: hostSystemMessage(held.text, "") };
}

function upgradeLine(client: ClientState | undefined): string {
  const latest = client?.release?.version;
  const running = readConfig().bridgeVersion;
  if (typeof latest !== "string" || typeof running !== "string") return "";
  if (!isBehind(running, latest)) return "";
  updateConfig({ bridgeVersion: undefined });
  const notes = client?.release?.notes;
  const where = typeof notes === "string" && notes !== "" ? `\n  ${notes}` : "";
  return `\n\n${tint(`  atomicreps ${running} → ${latest}. Restart your editor to load it.${where}`, "dim")}`;
}

function printServed(
  result: ApiResult<ToolReply>,
  session: Session | undefined,
  now: clock.EpochMs,
  project: string,
): HookOutput | null {
  const block = servedBlock(result, now, project);
  if (block === null) {
    noteDecision({
      at: now,
      via: "hook",
      outcome: result.ok ? "server-quiet" : "server-unreachable",
      project,
      ...(session === undefined ? {} : { top: session.hints.touched }),
    });
    return null;
  }
  const armed = questionId(result);
  if (armed !== undefined) updateConfig({ armedRep: { id: armed } });
  const because = noteShown({ via: "hook", project, session, handle: servedHandle(result), now });
  return {
    systemMessage: hostSystemMessage(
      block,
      becauseLine(because) + upgradeLine(result.ok ? result.value.client : undefined),
    ),
  };
}

function servedHandle(result: ApiResult<ToolReply>): string | undefined {
  const data = result.ok ? (result.value.data ?? {}) : {};
  const handle = str(data.handle);
  if (handle !== undefined) return handle;
  return typeof data.topicSlug === "string" && data.topicSlug !== "" ? data.topicSlug : undefined;
}

function becauseLine(path: string | null): string {
  return path === null ? "" : `\n${tint(`  Because you edited ${path}.`, "dim")}`;
}

async function fetchRep(
  cwd: string,
  project: string,
  prose: readonly string[],
  now: clock.EpochMs,
): Promise<HookOutput | null> {
  const session = await inferSession(
    cwd,
    INFER_BUDGET_MS,
    cachedGrammar(),
    prose,
    pushedIn(project),
  );
  const { hints } = session;
  if (session.unchanged) {
    noteDecision({ at: now, via: "hook", outcome: "tree-unchanged", project });
    return null;
  }
  if (allMuted(hints.touched, cachedMuteKeys(now))) {
    noteDecision({ at: now, via: "hook", outcome: "all-muted", project, top: hints.touched });
    return null;
  }
  const result = await api.rep({ hints, kind: "auto" }, HOOK_DEADLINE_MS);
  if (!result.ok) updateConfig({ nextEligibleAt: now + DEGRADED_BACKOFF_MS });
  return printServed(result, session, now, project);
}

async function remindRep(
  rep: StoredRep,
  cwd: string,
  project: string,
  prose: readonly string[],
  now: clock.EpochMs,
): Promise<HookOutput | null> {
  const session = await inferSession(
    cwd,
    INFER_BUDGET_MS,
    cachedGrammar(),
    prose,
    snapshotOnly(pushedIn(project)),
  );
  const { hints } = session;
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
    noteReprinted(rep.id, now, result.value.client?.slotsSpent ?? 1);
    updateConfig({ armedRep: { id: rep.id } });
    return { systemMessage: hostSystemMessage(rep.text, "") };
  }
  if (data.kind === "insight") {
    const printed = printServed(result, undefined, now, project);
    if (printed === null) return null;
    noteReprinted(rep.id, now);
    return printed;
  }
  noteResolvedElsewhere(rep.id, now);
  return printServed(result, session, now, project);
}

export type HookState = {
  hasToken: boolean;
  unattended: boolean;
  project: string;
  busy: boolean;
  held: HeldBlock | undefined;
  nextEligibleAt: clock.EpochMs | undefined;
  pending: StoredRep | undefined;
  armed: string | undefined;
  offer: readonly OfferEntry[];
};

export type HookAction =
  | { kind: "ignore" }
  | { kind: "quiet"; reason: Outcome; project: string }
  | { kind: "grade"; id: string; pick: Pick; sure?: boolean; withMessage: boolean }
  | { kind: "take"; handle: string; project: string }
  | { kind: "remind"; rep: StoredRep; cwd: string; project: string; prose: readonly string[] }
  | { kind: "show"; held: HeldBlock }
  | { kind: "arm"; id: string }
  | { kind: "push"; cwd: string; project: string; prose: readonly string[] };

function decideStop(input: HookInput, state: HookState, now: clock.EpochMs): HookAction {
  if (!state.hasToken) return { kind: "ignore" };
  if (state.held) return { kind: "show", held: state.held };
  if (state.pending && showsRep(input.last_assistant_message, state.pending)) {
    return { kind: "arm", id: state.pending.id };
  }
  const { project } = state;
  if (endsOnQuestion(input.last_assistant_message)) {
    return { kind: "quiet", reason: "ended-on-question", project };
  }
  if (state.nextEligibleAt !== undefined && clock.locallyQuiet(state.nextEligibleAt, now)) {
    return { kind: "quiet", reason: "gap", project };
  }
  if (state.busy) return { kind: "quiet", reason: "background-work", project };
  const cwd = input.cwd ?? process.cwd();
  const prose = input.last_assistant_message === undefined ? [] : [input.last_assistant_message];
  const due = remindable(state.pending);
  if (due) return { kind: "remind", rep: due, cwd, project, prose };
  return { kind: "push", cwd, project, prose };
}

export function decide(input: HookInput, state: HookState, now: clock.EpochMs): HookAction {
  if (state.unattended) return { kind: "ignore" };
  const event = input.hook_event_name ?? "UserPromptSubmit";
  if (event === "Stop") return decideStop(input, state, now);
  if (event !== "UserPromptSubmit") return { kind: "ignore" };
  const prompt = input.prompt ?? "";
  if (OUR_COMMAND.test(prompt)) return { kind: "ignore" };
  if (!state.hasToken) return { kind: "ignore" };

  const answer = answerOf(prompt);
  if (answer && state.pending && state.pending.id === state.armed) {
    return { kind: "grade", id: state.pending.id, ...answer };
  }

  const digit = digitOf(prompt);
  const entry = digit === null || state.pending || state.held ? undefined : state.offer[digit - 1];
  if (entry) return { kind: "take", handle: entry.handle, project: state.project };
  return { kind: "ignore" };
}

function backgroundBusy(tasks: readonly string[] | undefined, now: clock.EpochMs): boolean {
  if (tasks === undefined) return false;
  const held = readConfig().backgroundSeen ?? {};
  const { busy, seen } = stillWorking(tasks, held, now);
  if (JSON.stringify(seen) !== JSON.stringify(held)) updateConfig({ backgroundSeen: seen });
  return busy;
}

export function readState(now: clock.EpochMs, input: HookInput = {}): HookState {
  const isUnattended = unattended(input.agent_id, process.env);
  const busy = !isUnattended && backgroundBusy(input.background_tasks, now);
  const config = readConfig();
  const held = config.held;
  const project = projectOf(input.cwd ?? process.cwd());
  return {
    hasToken: Boolean(config.token),
    unattended: isUnattended,
    project,
    busy,
    held: held !== undefined && now - held.at <= HELD_TTL_MS ? held : undefined,
    nextEligibleAt: config.nextEligibleAt,
    pending: pendingRep(now, project),
    armed: config.armedRep?.id,
    offer: openOffer(now),
  };
}

export async function perform(action: HookAction, now: clock.EpochMs): Promise<HookOutput | null> {
  switch (action.kind) {
    case "ignore":
      return null;
    case "quiet":
      noteDecision({ at: now, via: "hook", outcome: action.reason, project: action.project });
      return null;
    case "grade":
      return await gradeLetter(action, now);
    case "show":
      return showHeld(action.held);
    case "arm":
      updateConfig({ armedRep: { id: action.id } });
      return null;
    case "remind":
      return await remindRep(action.rep, action.cwd, action.project, action.prose, now);
    case "take":
      return holdAsked(
        await api.rep({ ask: action.handle }, HOOK_DEADLINE_MS),
        now,
        action.project,
      );
    case "push":
      return await fetchRep(action.cwd, action.project, action.prose, now);
  }
}

export async function runHook(raw: string, now = clock.now()): Promise<HookOutput | null> {
  const input = parseInput(raw);
  const state = readState(now, input);
  if (state.unattended) return null;
  const prompted = (input.hook_event_name ?? "UserPromptSubmit") === "UserPromptSubmit";
  if (state.armed !== undefined || prompted) {
    updateConfig({
      ...(state.armed === undefined ? {} : { armedRep: undefined }),
      ...(prompted ? { lastPromptAt: now } : {}),
    });
  }
  return await perform(decide(input, state, now), now);
}

export async function refreshGrammar(raw: string, now = clock.now()): Promise<void> {
  if (!readConfig().token) return;
  if (unattended(parseInput(raw).agent_id, process.env)) return;
  const held = cachedGrammar();
  const wanted = cachedGrammarVersion(now);
  if (held !== null && (wanted === undefined || held.version === wanted)) return;
  await ensureGrammar(now, wanted, HOOK_DEADLINE_MS);
}
