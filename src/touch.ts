import type { Deadline } from "./clock.js";
import {
  MAX_ADDED_LINES,
  MAX_HITS_PER_PHRASE,
  MAX_PATTERN,
  MAX_PHRASE_CHARS,
  MAX_PHRASES,
  MAX_RULES,
  MAX_TOPIC_CHARS,
  MAX_VOCABULARY,
  MAX_VOCABULARY_ENTRY,
  MAX_WEIGHT,
  MIN_WEIGHT,
  PHRASE_WEIGHT,
  HEAD_FACTOR,
  HEAD_LINES,
  TOUCHED_SENT,
} from "./constants.js";
import {
  type ChangedFile,
  isRecord,
  stringList,
  type PathRule,
  type TouchedEntry,
  type TouchGrammar,
  type TouchVocabulary,
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
    const langs = stringList(rule.langs).map((ext) => ext.toLowerCase());
    words.push({
      words: rule.words.toLowerCase(),
      key: rule.key,
      weight: weightOf(rule.weight),
      ...(langs.length > 0 ? { langs } : {}),
    });
  }
  return { version: value.version, paths, words, vocabulary: parseVocabulary(value.vocabulary) };
}

function vocabularyList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_VOCABULARY)
    .filter(
      (entry): entry is string =>
        typeof entry === "string" && entry.length > 0 && entry.length <= MAX_VOCABULARY_ENTRY,
    );
}

function parseVocabulary(value: unknown): TouchVocabulary {
  if (!isRecord(value)) return { handles: [], packages: [], extensions: [] };
  return {
    handles: vocabularyList(value.handles),
    packages: vocabularyList(value.packages),
    extensions: vocabularyList(value.extensions),
  };
}

export const EMPTY_GRAMMAR: TouchGrammar = {
  version: "",
  paths: [],
  words: [],
  vocabulary: { handles: [], packages: [], extensions: [] },
};

type Compiled = {
  paths: Array<{ rule: PathRule; re: RegExp }>;
  words: Array<{ rule: WordRule; re: RegExp }>;
  handles: ReadonlySet<string>;
  packages: ReadonlySet<string>;
  extensions: ReadonlySet<string>;
};

const compiledByGrammar = new WeakMap<TouchGrammar, Compiled>();

function compiled(grammar: TouchGrammar): Compiled {
  const cached = compiledByGrammar.get(grammar);
  if (cached) return cached;
  const built: Compiled = {
    paths: grammar.paths.map((rule) => ({ rule, re: new RegExp(rule.pattern, "i") })),
    words: grammar.words.map((rule) => ({ rule, re: phraseRegExp(rule.words) })),
    handles: new Set(grammar.vocabulary.handles),
    packages: new Set(grammar.vocabulary.packages),
    extensions: new Set(grammar.vocabulary.extensions),
  };
  compiledByGrammar.set(grammar, built);
  return built;
}

export function normalizeHint(hint: string): string {
  return hint.trim().toLowerCase().replace(/^\.+/, "");
}

export function knownHandle(grammar: TouchGrammar, value: string): string | undefined {
  const handle = normalizeHint(value);
  return compiled(grammar).handles.has(handle) ? handle : undefined;
}

function resolved(
  names: readonly unknown[],
  resolve: (name: string) => string | undefined,
): string[] {
  const kept = new Set<string>();
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const word = resolve(normalizeHint(raw));
    if (word !== undefined) kept.add(word);
  }
  return [...kept];
}

export function resolvePhrases(grammar: TouchGrammar, phrases: readonly unknown[]): TouchedEntry[] {
  const keys = new Set(matchPhrases(grammar, phrases).matches.map((m) => m.key));
  return [...keys].map((key) => ({ key, weight: PHRASE_WEIGHT }));
}

export type PhraseMatch = { readonly match: string; readonly key: string };

export function matchPhrases(
  grammar: TouchGrammar,
  phrases: readonly unknown[],
): { matches: PhraseMatch[]; unmatched: number } {
  const { words, handles } = compiled(grammar);
  const matches: PhraseMatch[] = [];
  let unmatched = 0;
  for (const raw of phrases.slice(0, MAX_PHRASES)) {
    if (typeof raw !== "string") continue;
    const text = normalizeHint(raw).slice(0, MAX_PHRASE_CHARS);
    if (text === "") continue;
    const hit = words.find(({ rule, re }) => text.includes(rule.words) && re.test(text));
    if (hit) matches.push({ match: hit.rule.words, key: hit.rule.key });
    else if (handles.has(text)) matches.push({ match: text, key: text });
    else unmatched += 1;
  }
  return { matches, unmatched };
}

export function weighNamed(
  named: readonly TouchedEntry[],
  inferred: readonly TouchedEntry[],
): TouchedEntry[] {
  const shown = new Set(inferred.map((e) => topicOf(e.key)));
  const top = Math.max(0, ...inferred.map((e) => e.weight));
  return named.map((entry) =>
    shown.has(topicOf(entry.key)) ? { ...entry, weight: Math.max(entry.weight, top) } : entry,
  );
}

export function resolveTopic(grammar: TouchGrammar, topic: string): string | undefined {
  const { packages } = compiled(grammar);
  const words = topic.slice(0, MAX_TOPIC_CHARS).split(/[^A-Za-z0-9@/._+-]+/);
  const kept = resolved(words, (word) => (packages.has(word) ? word : undefined));
  return kept.length > 0 ? kept.join(" ") : undefined;
}

export function knownPackages(grammar: TouchGrammar, names: readonly unknown[]): string[] {
  const { packages } = compiled(grammar);
  return resolved(names, (name) => {
    if (packages.has(name)) return name;
    const bare = name.startsWith("@") ? (name.split("/")[1] ?? name) : name;
    const [head] = bare.split(/[-_.]/);
    return head !== undefined && packages.has(head) ? head : undefined;
  });
}

export function knownExtensions(grammar: TouchGrammar, names: readonly unknown[]): string[] {
  const { extensions } = compiled(grammar);
  return resolved(names, (name) => (extensions.has(name) ? name : undefined));
}

export function extensionOf(path: string): string {
  const base = (path.split("/").at(-1) ?? path).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1);
}

export function scoreFiles(
  grammar: TouchGrammar,
  files: readonly ChangedFile[],
  deadline: Deadline,
  prose: readonly string[] = [],
): TouchedEntry[] {
  const { paths, words } = compiled(grammar);
  const score = new Map<string, number>();
  const bump = (key: string, weight: number) => score.set(key, (score.get(key) ?? 0) + weight);

  for (const file of files) {
    if (deadline.passed()) break;
    for (const { rule, re } of paths) if (re.test(file.path)) bump(rule.key, rule.weight);
  }

  const scan = (lines: readonly string[], allows: (rule: WordRule) => boolean, factor: number) => {
    const hits = new Map<WordRule, number>();
    for (const raw of lines.slice(0, MAX_ADDED_LINES)) {
      if (deadline.passed()) break;
      const line = raw.toLowerCase();
      for (const { rule, re } of words) {
        if (!line.includes(rule.words) || !allows(rule) || !re.test(line)) continue;
        hits.set(rule, (hits.get(rule) ?? 0) + 1);
      }
    }
    for (const [rule, count] of hits) {
      bump(rule.key, rule.weight * factor * (1 + Math.log2(Math.min(count, MAX_HITS_PER_PHRASE))));
    }
  };

  const exts = new Set<string>();
  for (const file of files) {
    if (file.status === "deleted") continue;
    const ext = extensionOf(file.path);
    exts.add(ext);
    const inFile = (rule: WordRule) => rule.langs === undefined || rule.langs.includes(ext);
    scan(file.added, inFile, 1);
    if (file.status === "modified" && file.head !== undefined) {
      scan(file.head.slice(0, HEAD_LINES), inFile, HEAD_FACTOR);
    }
  }
  const openOrWritten = (rule: WordRule) =>
    rule.langs === undefined || rule.langs.some((ext) => exts.has(ext));
  scan(
    prose.flatMap((text) => text.split("\n")),
    openOrWritten,
    1,
  );

  const ranked = [...score.entries()].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ranked[0]?.[1] ?? 0;
  return ranked.slice(0, TOUCHED_SENT).map(([key, weight]) => ({
    key,
    weight: Math.max(MIN_WEIGHT, Math.round((weight / top) * MAX_WEIGHT)),
  }));
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
