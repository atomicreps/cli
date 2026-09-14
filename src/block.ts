import { visibleWidth } from "./ansi.js";
import { REP_MARK, REP_RULE, type Span, spans, tokenizeBlock } from "./format.js";
import type { Tone } from "./types.js";

export type Painter = (text: string, ...tones: Tone[]) => string;

type Word = { text: string; kind: Span["kind"]; spaceBefore: boolean };

function wordsOf(text: string): Word[] {
  const words: Word[] = [];
  let spaceBefore = false;
  for (const span of spans(text)) {
    for (const part of span.text.split(/(\s+)/)) {
      if (part === "") continue;
      if (/^\s+$/.test(part)) {
        spaceBefore = true;
        continue;
      }
      words.push({ text: part, kind: span.kind, spaceBefore });
      spaceBefore = false;
    }
  }
  return words;
}

function unitsOf(words: Word[]): Array<{ words: Word[]; width: number }> {
  const units: Array<{ words: Word[]; width: number }> = [];
  let current: Word[] = [];
  const flush = () => {
    if (current.length === 0) return;
    units.push({ words: current, width: current.reduce((n, w) => n + visibleWidth(w.text), 0) });
    current = [];
  };
  for (const word of words) {
    if (current.length > 0 && word.spaceBefore) flush();
    current.push(word);
  }
  flush();
  return units;
}

function wrapWords(words: Word[], width: number): Word[][] {
  const lines: Word[][] = [];
  let line: Word[] = [];
  let lineWidth = 0;
  for (const unit of unitsOf(words)) {
    const extra = line.length === 0 ? unit.width : lineWidth + 1 + unit.width;
    if (line.length > 0 && extra > width) {
      lines.push(line);
      line = [];
      lineWidth = 0;
    }
    lineWidth = line.length === 0 ? unit.width : lineWidth + 1 + unit.width;
    line.push(...unit.words);
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

function paintRun(kind: Span["kind"], text: string, painter: Painter, baseTone: Tone): string {
  if (kind === "code") return painter(text, "gold");
  if (kind === "bold") return painter(text, baseTone, "bold");
  return painter(text, baseTone);
}

function renderWords(words: Word[], painter: Painter, baseTone: Tone): string {
  let out = "";
  let i = 0;
  while (i < words.length) {
    const first = words[i];
    if (first === undefined) break;
    const kind = first.kind;
    let text = first.text;
    let j = i + 1;
    for (let word = words[j]; word !== undefined && word.kind === kind; word = words[j]) {
      text += (word.spaceBefore ? " " : "") + word.text;
      j += 1;
    }
    out += paintRun(kind, text, painter, baseTone);
    const next = words[j];
    if (next !== undefined) out += next.spaceBefore ? " " : "";
    i = j;
  }
  return out;
}

function renderSpans(text: string, painter: Painter, baseTone: Tone, width?: number): string[] {
  if (width === undefined) {
    return [
      spans(text)
        .map((span) => paintRun(span.kind, span.text, painter, baseTone))
        .join(""),
    ];
  }
  return wrapWords(wordsOf(text), width).map((line) => renderWords(line, painter, baseTone));
}

export function paintBlock(
  text: string,
  painter: Painter,
  opts: { chrome: boolean; width?: number },
): string[] {
  const { chrome, width } = opts;
  const out: string[] = [];
  for (const token of tokenizeBlock(text)) {
    switch (token.kind) {
      case "header":
        out.push(`${chrome ? `${REP_MARK} ` : ""}${painter(token.text, "bold", "coral")}`);
        break;
      case "rule":
        if (chrome) out.push(painter(REP_RULE, "faint"));
        break;
      case "footer":
        if (chrome) out.push(painter(token.text, "soft"));
        break;
      case "blank":
        out.push("");
        break;
      case "fence":
        break;
      case "code":
        out.push(token.text === "" ? "" : `  ${painter(token.text, "soft")}`);
        break;
      case "text":
        out.push(...renderSpans(token.text, painter, "ink", width));
        break;
      case "note":
        out.push(...renderSpans(token.text, painter, "soft", width));
        break;
      case "option": {
        const letter = `${painter(`${token.letter}.`, "bold", "coral")} `;
        const bodyWidth = width === undefined ? undefined : Math.max(1, width - 3);
        const lines = renderSpans(token.text, painter, "ink", bodyWidth);
        lines.forEach((line, i) => out.push(i === 0 ? `${letter}${line}` : `   ${line}`));
        break;
      }
    }
  }
  return out;
}
