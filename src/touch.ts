import {
  HEAD_LINES,
  MAX_ADDED_LINES,
  MAX_HITS_PER_PHRASE,
  MAX_PATTERN,
  MAX_RULES,
  MAX_WEIGHT,
  MIN_WEIGHT,
  TOUCHED_SENT,
} from "./constants.js";
import {
  isRecord,
  type PathRule,
  type TouchedEntry,
  type TouchGrammar,
  type TouchInput,
  type WordRule,
} from "./types.js";

const WORD_CHAR = /[a-z0-9_]/;

export function phraseRegExp(words: string): RegExp {
  const first = words[0] ?? "";
  const last = words[words.length - 1] ?? "";
  const lead = WORD_CHAR.test(first) ? "(?:^|[^a-z0-9_])" : "";
  const tail = WORD_CHAR.test(last) ? "(?:$|[^a-z0-9_])" : "";
  return new RegExp(`${lead}${RegExp.escape(words)}${tail}`);
}

export function phraseMatches(text: string, words: string): boolean {
  return phraseRegExp(words).test(text);
}

function compiles(pattern: string): boolean {
  try {
    return new RegExp(pattern, "i") instanceof RegExp;
  } catch {
    return false;
  }
}

function weightOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

export function parseGrammar(value: unknown): TouchGrammar | null {
  if (!isRecord(value) || typeof value.version !== "string") return null;
  if (value.version.length > 128) return null;
  if (!Array.isArray(value.paths) || !Array.isArray(value.words)) return null;
  const paths: PathRule[] = [];
  for (const rule of value.paths.slice(0, MAX_RULES)) {
    if (!isRecord(rule) || typeof rule.pattern !== "string" || typeof rule.key !== "string")
      continue;
    if (rule.pattern.length > MAX_PATTERN) continue;
    if (!compiles(rule.pattern)) continue;
    paths.push({ pattern: rule.pattern, key: rule.key, weight: weightOf(rule.weight) });
  }
  const words: WordRule[] = [];
  for (const rule of value.words.slice(0, MAX_RULES)) {
    if (!isRecord(rule) || typeof rule.words !== "string" || typeof rule.key !== "string") continue;
    if (rule.words.length === 0) continue;
    words.push({ words: rule.words, key: rule.key, weight: weightOf(rule.weight) });
  }
  return { version: value.version, paths, words };
}

type Compiled = {
  paths: Array<{ rule: PathRule; re: RegExp }>;
  words: Array<{ rule: WordRule; re: RegExp }>;
};

const compiledByVersion = new Map<string, Compiled>();

function compiled(grammar: TouchGrammar): Compiled {
  const cached = compiledByVersion.get(grammar.version);
  if (cached) return cached;
  const built: Compiled = {
    paths: grammar.paths.map((rule) => ({ rule, re: new RegExp(rule.pattern, "i") })),
    words: grammar.words.map((rule) => ({ rule, re: phraseRegExp(rule.words) })),
  };
  compiledByVersion.set(grammar.version, built);
  return built;
}

export function applyGrammar(grammar: TouchGrammar, input: TouchInput): TouchedEntry[] {
  const { paths, words } = compiled(grammar);
  const score = new Map<string, number>();
  const bump = (key: string, weight: number) => score.set(key, (score.get(key) ?? 0) + weight);
  for (const path of input.paths) {
    if (input.deadline.passed()) break;
    for (const { rule, re } of paths) if (re.test(path)) bump(rule.key, rule.weight);
  }
  const scan = (lines: readonly string[], factor: number) => {
    const hits = new Map<string, number>();
    for (const raw of lines) {
      if (input.deadline.passed()) return;
      const line = raw.toLowerCase();
      for (const { rule, re } of words) {
        if (!line.includes(rule.words) || !re.test(line)) continue;
        const seen = hits.get(rule.words) ?? 0;
        if (seen >= MAX_HITS_PER_PHRASE) continue;
        hits.set(rule.words, seen + 1);
        bump(rule.key, rule.weight * factor);
      }
    }
  };
  scan(input.addedLines.slice(0, MAX_ADDED_LINES), 1);
  scan(
    input.heads.flatMap((head) => head.split("\n").slice(0, HEAD_LINES)),
    0.5,
  );
  return [...score.entries()]
    .map(([key, weight]) => ({
      key,
      weight: Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, Math.round(weight))),
    }))
    .toSorted((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
    .slice(0, TOUCHED_SENT);
}

export function topicOf(key: string): string {
  const at = key.indexOf(".");
  return at < 0 ? key : key.slice(0, at);
}

export function allMuted(touched: readonly TouchedEntry[], muteKeys: readonly string[]): boolean {
  if (touched.length === 0 || muteKeys.length === 0) return false;
  const mutes = new Set(muteKeys);
  return touched.every((entry) => mutes.has(entry.key) || mutes.has(topicOf(entry.key)));
}
