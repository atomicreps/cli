import { ESC, MAX_LINE } from "./constants.js";
import type { Tone } from "./types.js";

const CODES: Record<Tone, string> = {
  ink: "38;5;231",
  soft: "38;5;250",
  faint: "38;5;244",
  coral: "38;5;209",
  gold: "38;5;221",
  green: "38;5;114",
  red: "38;5;203",
  body: "38;5;218",
  gill: "38;5;211",
  face: "38;5;53",
  blush: "38;5;205",
  bold: "1",
  dim: "2",
};

function colourAllowed(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  if (process.env.TERM === "dumb") return false;
  return Boolean(process.stdout.isTTY);
}

export const COLOUR = colourAllowed();

export function paint(text: string, ...tones: Tone[]): string {
  if (!COLOUR || tones.length === 0) return text;
  const open = tones.map((t) => `[${CODES[t]}m`).join("");
  return `${open}${text}[0m`;
}

const NOT_COLOUR = new RegExp(
  [
    `${ESC}\\][^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)?`,
    `${ESC}[P^_X][^${ESC}]*(?:${ESC}\\\\)?`,
    `${ESC}\\[[0-?]*[ -/]*[@-ln-~]`,
    `${ESC}[^\\[\\]P^_X]`,
  ].join("|"),
  "g",
);

const STRAY_ESC = new RegExp(`${ESC}(?!\\[[0-9;]*m)`, "g");

const COLOUR_SEQUENCE = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

const CONTROLS = /[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f-\u009f\u2028\u2029]/g;

export function sanitize(text: string, max = MAX_LINE): string {
  return text.replace(NOT_COLOUR, "").replace(STRAY_ESC, "").replace(CONTROLS, "").slice(0, max);
}

export function stripAnsi(text: string): string {
  return sanitize(text).replace(COLOUR_SEQUENCE, "");
}

export function visibleWidth(text: string): number {
  return [...stripAnsi(text)].length;
}

export function padTo(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line === "") line = word;
      else if (visibleWidth(line) + 1 + visibleWidth(word) <= width) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

export function tint(text: string, ...tones: Tone[]): string {
  if (process.env.NO_COLOR !== undefined || process.env.TERM === "dumb") return text;
  if (tones.length === 0) return text;
  const open = tones.map((t) => `${ESC}[${CODES[t]}m`).join("");
  return `${open}${text}${ESC}[0m`;
}
