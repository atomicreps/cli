import { rmSync, statSync } from "node:fs";
import { join } from "node:path";

import * as api from "./api.js";
import * as clock from "./clock.js";
import { configPath, noteQuiet, updateConfig } from "./config.js";
import {
  CATALOG_DEADLINE_MS,
  FILE_MODE,
  FILES,
  GRAMMAR_TTL_MS,
  OFFER_TTL_MS,
  PENDING_TTL_MS,
  REMIND_GAP_MS,
  REPS_KEPT,
  STATUS_TTL_MS,
  TOPICS_TTL_MS,
} from "./constants.js";
import { ensureDir, readJsonFile, writeJsonAtomic } from "./files.js";
import { parseGrammar } from "./touch.js";
import {
  isRecord,
  type ClientState,
  type DomainEntry,
  type OfferEntry,
  type StoredRep,
  type TopicEntry,
  type TouchGrammar,
  stringList,
} from "./types.js";

type TopicsFile = { fetchedAt: number; topics: TopicEntry[]; domains?: DomainEntry[] };
type GrammarFile = { fetchedAt: number; grammar: TouchGrammar };

type RepsFile = { reps: StoredRep[] };

function dir(): string {
  return join(configPath(), "..");
}

function readJson<T>(name: string): T | null {
  return readJsonFile<T>(join(dir(), name));
}

function writeJson(name: string, value: unknown): void {
  try {
    ensureDir(dir());
    writeJsonAtomic(join(dir(), name), value, FILE_MODE);
  } catch {
  }
}

export function purgeLocalData(): void {
  for (const name of [FILES.reps, FILES.status, FILES.errorLog]) {
    try {
      rmSync(join(dir(), name), { force: true });
    } catch {
    }
  }
}

async function refreshTopics(now: number): Promise<TopicsFile | null> {
  const fetched = await api.topics(CATALOG_DEADLINE_MS);
  if (!fetched.ok) return null;
  const file: TopicsFile = {
    fetchedAt: now,
    topics: fetched.value.topics,
    ...(fetched.value.domains ? { domains: fetched.value.domains } : {}),
  };
  writeJson(FILES.topics, file);
  return file;
}

export async function topicCatalog(now = clock.now()): Promise<TopicEntry[]> {
  const cached = readJson<TopicsFile>(FILES.topics);
  if (cached && now - cached.fetchedAt < TOPICS_TTL_MS) return cached.topics;
  const fresh = await refreshTopics(now);
  return fresh?.topics ?? cached?.topics ?? [];
}

export async function domainCatalog(now = clock.now()): Promise<DomainEntry[]> {
  const cached = readJson<TopicsFile>(FILES.topics);
  if (cached?.domains && now - cached.fetchedAt < TOPICS_TTL_MS) return cached.domains;
  const fresh = await refreshTopics(now);
  return fresh?.domains ?? cached?.domains ?? [];
}

let grammarMemo: { stamp: string; grammar: TouchGrammar | null } | null = null;

function grammarStamp(): string | null {
  try {
    const { mtimeMs, size } = statSync(join(dir(), FILES.grammar));
    return `${mtimeMs}:${size}`;
  } catch {
    return null;
  }
}

export function cachedGrammar(): TouchGrammar | null {
  const stamp = grammarStamp();
  if (stamp === null) return null;
  if (grammarMemo?.stamp !== stamp) {
    const file = readJson<GrammarFile>(FILES.grammar);
    grammarMemo = { stamp, grammar: file ? parseGrammar(file.grammar) : null };
  }
  return grammarMemo.grammar;
}

export async function ensureGrammar(
  now = clock.now(),
  expectedVersion?: string,
  deadlineMs?: number,
): Promise<TouchGrammar | null> {
  const file = readJson<GrammarFile>(FILES.grammar);
  const cached = file ? parseGrammar(file.grammar) : null;
  const fresh =
    cached !== null &&
    file !== null &&
    now - file.fetchedAt < GRAMMAR_TTL_MS &&
    (expectedVersion === undefined || expectedVersion === cached.version);
  if (fresh) return cached;
  const fetched = await api.grammar(cached?.version, deadlineMs);
  if (!fetched.ok) return cached;
  if (fetched.status === 304 && cached) {
    writeJson(FILES.grammar, { fetchedAt: now, grammar: cached });
    return cached;
  }
  const parsed = parseGrammar(fetched.value);
  if (!parsed) return cached;
  writeJson(FILES.grammar, { fetchedAt: now, grammar: parsed });
  return parsed;
}

export function listReps(): StoredRep[] {
  return readJson<RepsFile>(FILES.reps)?.reps ?? [];
}

function recordServed(rep: Omit<StoredRep, "answeredAt" | "correct" | "verdict" | "offer">): void {
  const reps = listReps().filter((r) => r.id !== rep.id);
  reps.push(rep);
  writeJson(FILES.reps, { reps: reps.slice(-REPS_KEPT) });
}

function recordAnswered(
  id: string,
  correct: boolean,
  verdict: string,
  now: number,
  offer: OfferEntry[],
): void {
  const reps = listReps().map((r) =>
    r.id === id ? { ...r, answeredAt: now, correct, verdict, offer } : r,
  );
  writeJson(FILES.reps, { reps });
}

export function offerOf(data: Record<string, unknown>): OfferEntry[] {
  if (!Array.isArray(data.offer)) return [];
  return data.offer.filter(
    (o): o is OfferEntry =>
      isRecord(o) && typeof o.handle === "string" && typeof o.name === "string",
  );
}

export function observeRep(data: Record<string, unknown>, text: string, now: number): void {
  if (data.kind === "verdict") {
    observeVerdict(undefined, data, text, now);
    return;
  }
  if (typeof data.nextEligibleAt === "number" && Number.isFinite(data.nextEligibleAt)) {
    updateConfig({ nextEligibleAt: clock.clampQuiet(data.nextEligibleAt, now) });
  }
  if (data.kind === "quiet" && typeof data.reason === "string")
    noteQuiet(data.reason, undefined, now);
  if (data.kind === "question") updateConfig({ quietReason: undefined });
  if (data.kind === "question" && typeof data.id === "string") {
    recordServed({
      id: data.id,
      topicSlug: typeof data.topicSlug === "string" ? data.topicSlug : "",
      ...(typeof data.handle === "string" ? { handle: data.handle } : {}),
      ...(data.lane === "asked" || data.lane === "pushed" ? { lane: data.lane } : {}),
      text,
      servedAt: now,
    });
  }
}

export function observeVerdict(
  id: string | undefined,
  data: Record<string, unknown>,
  text: string,
  now: number,
): void {
  const answered = data.status === "answered" || data.kind === "verdict";
  if (!answered || typeof data.correct !== "boolean") return;
  if (typeof data.currentStreak === "number")
    mergeStatus({ currentStreak: data.currentStreak, streakAt: now }, now);
  const target = id ?? listReps().at(-1)?.id;
  if (target !== undefined) recordAnswered(target, data.correct, text, now, offerOf(data));
}

export function noteReprinted(id: string, now: number, slots = 1): void {
  const reps = listReps().map((r) => (r.id === id ? { ...r, shown: (r.shown ?? 0) + slots } : r));
  writeJson(FILES.reps, { reps });
  updateConfig({ nextEligibleAt: now + REMIND_GAP_MS });
}

export function noteVerified(id: string, now: number): void {
  const reps = listReps().map((r) => (r.id === id ? { ...r, verifiedAt: now } : r));
  writeJson(FILES.reps, { reps });
}

export function noteResolvedElsewhere(id: string, now: number): void {
  const reps = listReps().map((r) =>
    r.id === id && r.answeredAt === undefined ? { ...r, answeredAt: now } : r,
  );
  writeJson(FILES.reps, { reps });
}

export function pendingRep(now = clock.now()): StoredRep | undefined {
  const last = listReps().at(-1);
  if (!last || last.answeredAt !== undefined) return undefined;
  return now - last.servedAt <= PENDING_TTL_MS ? last : undefined;
}

export function openOffer(now = clock.now()): readonly OfferEntry[] {
  const last = listReps().at(-1);
  if (!last?.answeredAt || !last.offer || last.offer.length === 0) return [];
  return now - last.answeredAt <= OFFER_TTL_MS ? last.offer : [];
}

type StatusCache = { fetchedAt: number; status: Record<string, unknown> };

function mergeStatus(fields: Record<string, unknown>, now: number): void {
  const cached = readJson<StatusCache>(FILES.status);
  const status = cached && now - cached.fetchedAt <= STATUS_TTL_MS ? cached.status : {};
  writeJson(FILES.status, { fetchedAt: now, status: { ...status, ...fields } });
}

export function writeStatusCache(status: Record<string, unknown>, now = clock.now()): void {
  writeJson(FILES.status, { fetchedAt: now, status: { ...status, streakAt: now } });
}

function readStatusCache(
  now = clock.now(),
  maxAgeMs = STATUS_TTL_MS,
): Record<string, unknown> | null {
  const cached = readJson<StatusCache>(FILES.status);
  if (!cached || now - cached.fetchedAt > maxAgeMs) return null;
  return cached.status;
}

export function observeClient(client: ClientState | undefined, now = clock.now()): void {
  const fields: Record<string, unknown> = {};
  if (Array.isArray(client?.muteKeys)) fields.muteKeys = client.muteKeys;
  if (typeof client?.grammarVersion === "string") fields.grammarVersion = client.grammarVersion;
  if (Object.keys(fields).length > 0) mergeStatus(fields, now);
}

export function streakForStatus(now = clock.now()): number | null {
  const status = readStatusCache(now);
  const at = status?.streakAt;
  const streak = status?.currentStreak;
  if (typeof at !== "number" || typeof streak !== "number") return null;
  return clock.sameLocalDay(at, now) ? streak : null;
}

export function cachedMuteKeys(now = clock.now()): string[] {
  const keys = readStatusCache(now)?.muteKeys;
  return stringList(keys);
}

export function cachedGrammarVersion(now = clock.now()): string | undefined {
  const version = readStatusCache(now)?.grammarVersion;
  return typeof version === "string" ? version : undefined;
}
