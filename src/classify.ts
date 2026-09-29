import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Deadline } from "./clock.js";
import { HEAD_FACTOR, HEAD_LINES, MAX_WEIGHT, MIN_WEIGHT, TOUCHED_SENT } from "./constants.js";
import { tokenize } from "./tokens.js";
import { extensionOf, scoreFiles } from "./touch.js";
import { type ChangedFile, isRecord, type TouchedEntry, type TouchGrammar } from "./types.js";

export type WordCounts = readonly [number, readonly number[], readonly number[]];

export type Classifier = {
  readonly version: string;
  readonly muSub: number;
  readonly muTopic: number;
  readonly lambda: number;
  readonly temperature: number;
  readonly topics: readonly string[];
  readonly classes: readonly string[];
  readonly classTopic: readonly number[];
  readonly classTokens: readonly number[];
  readonly topicTokens: readonly number[];
  readonly total: number;
  readonly words: Readonly<Record<string, WordCounts>>;
  readonly langs: Readonly<Record<string, readonly string[]>>;
};

export type Evidence = {
  readonly text: readonly string[];
  readonly weight: number;
  readonly allows: (topic: string) => boolean;
};

export type Posterior = { readonly key: string; readonly p: number }[];

export function wordKey(word: string): string {
  let h = 0x81_1c_9d_c5;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 0x01_00_01_93) >>> 0;
  }
  return h.toString(36);
}

function termFrequencies(lines: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    for (const token of tokenize(line)) {
      const key = wordKey(token);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

export function logLikelihoodRatios(
  classifier: Classifier,
  evidence: readonly Evidence[],
): Float64Array {
  const { classes, topics, lambda, muSub, muTopic } = classifier;
  const vocabulary = vocabularySize(classifier);
  const floor = Math.log(1 - lambda);
  const scores = new Float64Array(classes.length);
  const topicP = new Float64Array(topics.length);
  const allowed = new Uint8Array(topics.length);
  const classCount = new Float64Array(classes.length);
  const topicDenominator = Float64Array.from(
    topics,
    (_, t) => (classifier.topicTokens[t] ?? 0) + muTopic,
  );
  const classDenominator = Float64Array.from(
    classes,
    (_, c) => (classifier.classTokens[c] ?? 0) + muSub,
  );
  let unknown = 0;

  for (const body of evidence) {
    for (let t = 0; t < topics.length; t++) allowed[t] = body.allows(topics[t] ?? "") ? 1 : 0;
    for (const [key, n] of termFrequencies(body.text)) {
      const tf = body.weight * Math.log1p(n);
      const entry = classifier.words[key];
      if (entry === undefined) {
        unknown += tf * floor;
        continue;
      }
      const [corpusCount, topicPairs, classPairs] = entry;
      const background = (corpusCount + 1) / (classifier.total + vocabulary);
      for (let t = 0; t < topics.length; t++) {
        topicP[t] = (muTopic * background) / (topicDenominator[t] ?? muTopic);
      }
      for (let i = 0; i < topicPairs.length; i += 2) {
        const t = topicPairs[i] ?? 0;
        topicP[t] =
          ((topicPairs[i + 1] ?? 0) + muTopic * background) / (topicDenominator[t] ?? muTopic);
      }
      classCount.fill(0);
      for (let i = 0; i < classPairs.length; i += 2) {
        classCount[classPairs[i] ?? 0] = classPairs[i + 1] ?? 0;
      }
      for (let c = 0; c < classes.length; c++) {
        const t = classifier.classTopic[c] ?? 0;
        if (allowed[t] === 0) {
          scores[c] = (scores[c] ?? 0) + tf * floor;
          continue;
        }
        const p =
          ((classCount[c] ?? 0) + muSub * (topicP[t] ?? 0)) / (classDenominator[c] ?? muSub);
        scores[c] = (scores[c] ?? 0) + tf * Math.log(lambda * (p / background) + 1 - lambda);
      }
    }
  }
  if (unknown !== 0)
    for (let c = 0; c < classes.length; c++) scores[c] = (scores[c] ?? 0) + unknown;
  return scores;
}

const vocabularySizes = new WeakMap<Classifier, number>();

function vocabularySize(classifier: Classifier): number {
  const known = vocabularySizes.get(classifier);
  if (known !== undefined) return known;
  const size = Object.keys(classifier.words).length;
  vocabularySizes.set(classifier, size);
  return size;
}

export function posterior(
  classifier: Classifier,
  evidence: readonly Evidence[],
  limit = TOUCHED_SENT,
): Posterior {
  const scores = logLikelihoodRatios(classifier, evidence).map((s) => s / classifier.temperature);
  let max = -Infinity;
  for (const s of scores) if (s > max) max = s;
  if (!Number.isFinite(max)) return [];
  let sum = 0;
  const odds = Array.from(scores, (s) => {
    const e = Math.exp(s - max);
    sum += e;
    return e;
  });
  return odds
    .map((e, c) => ({ key: classifier.classes[c] ?? "", p: e / sum }))
    .toSorted((a, b) => b.p - a.p)
    .slice(0, limit);
}

export function evidenceOf(
  classifier: Classifier,
  files: readonly ChangedFile[],
  prose: readonly string[],
): Evidence[] {
  const { langs } = classifier;
  const present = files.filter((file) => file.status !== "deleted");
  const exts = new Set(present.map((file) => extensionOf(file.path)));
  const writtenIn = (ext: string) => (topic: string) => langs[topic]?.includes(ext) ?? true;
  const out: Evidence[] = [];
  for (const file of present) {
    const allows = writtenIn(extensionOf(file.path));
    out.push({ text: [file.path.replaceAll("/", " "), ...file.added], weight: 1, allows });
    if (file.status === "modified" && file.head !== undefined) {
      out.push({ text: file.head.slice(0, HEAD_LINES), weight: HEAD_FACTOR, allows });
    }
  }
  if (prose.length > 0) {
    out.push({
      text: prose,
      weight: 1,
      allows: (topic) => langs[topic]?.some((ext) => exts.has(ext)) ?? true,
    });
  }
  return out;
}

export function classifyTouched(
  classifier: Classifier,
  files: readonly ChangedFile[],
  prose: readonly string[],
): TouchedEntry[] {
  if (files.length === 0 && prose.length === 0) return [];
  const ranked = posterior(classifier, evidenceOf(classifier, files, prose));
  const top = ranked[0]?.p ?? 0;
  if (top <= 0) return [];
  return ranked
    .map(({ key, p }) => ({ key, weight: Math.round((p / top) * MAX_WEIGHT) }))
    .filter((entry) => entry.weight >= MIN_WEIGHT);
}

export function touchedFor(
  grammar: TouchGrammar,
  classifier: Classifier | null,
  files: readonly ChangedFile[],
  deadline: Deadline,
  prose: readonly string[] = [],
): TouchedEntry[] {
  return classifier === null
    ? scoreFiles(grammar, files, deadline, prose)
    : classifyTouched(classifier, files, prose);
}

export function strongestFile(
  classifier: Classifier,
  files: readonly ChangedFile[],
  handle: string,
): string | null {
  const isTarget = classifier.classes.map((key) => key === handle || key.startsWith(`${handle}.`));
  if (!isTarget.includes(true)) return null;
  let best: { path: string; margin: number } | null = null;
  for (const file of files) {
    if (file.status === "deleted") continue;
    const scores = logLikelihoodRatios(classifier, evidenceOf(classifier, [file], []));
    let target = -Infinity;
    let rest = -Infinity;
    scores.forEach((score, c) => {
      if (isTarget[c]) target = Math.max(target, score);
      else rest = Math.max(rest, score);
    });
    const margin = target - rest;
    if (margin > MARGIN_EPSILON && (best === null || margin > best.margin)) {
      best = { path: file.path, margin };
    }
  }
  return best?.path ?? null;
}

const MARGIN_EPSILON = 1e-9;

function countsPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "classifier", "counts.json");
}

let loaded: { classifier: Classifier | null } | undefined;

export function loadClassifier(): Classifier | null {
  if (loaded !== undefined) return loaded.classifier;
  let classifier: Classifier | null = null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(countsPath(), "utf8"));
    if (
      isRecord(parsed) &&
      typeof parsed.version === "string" &&
      Array.isArray(parsed.classes) &&
      isRecord(parsed.words)
    ) {
      classifier = parsed as Classifier;
    }
  } catch {
    classifier = null;
  }
  loaded = { classifier };
  return classifier;
}
