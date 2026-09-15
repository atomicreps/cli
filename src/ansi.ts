import { ESC, MAX_LINE } from "./constants.js";
import type { Tone } from "./types.js";

export type Theme = "dark" | "light";

type ThemedTone = Extract<Tone, "ink" | "soft" | "faint" | "coral" | "gold" | "face">;
type StaticTone = Exclude<Tone, ThemedTone>;

const DARK = {
  ink: "38;5;231",
  soft: "38;5;250",
  faint: "38;5;244",
  coral: "38;5;209",
  gold: "38;5;221",
  face: "38;5;225",
} as const satisfies Record<ThemedTone, string>;

const LIGHT = {
  ink: "38;5;235",
  soft: "38;5;240",
  faint: "38;5;247",
  coral: "38;5;166",
  gold: "38;5;136",
  face: "38;5;53",
} as const satisfies Record<ThemedTone, string>;

const STATIC_CODES = {
  green: "38;5;114",
  red: "38;5;203",
  body: "38;5;218",
  gill: "38;5;211",
  blush: "38;5;205",
  bold: "1",
  dim: "2",
} as const satisfies Record<StaticTone, string>;

function codesFor(theme: Theme): Readonly<Record<Tone, string>> {
  return { ...STATIC_CODES, ...(theme === "light" ? LIGHT : DARK) };
}

export function themeFromEnv(): Theme {
  const raw = process.env.COLORFGBG;
  if (raw === undefined) return "dark";
  const parts = raw.split(";");
  const bg = parts[parts.length - 1];
  return bg === "7" || bg === "15" ? "light" : "dark";
}

let currentTheme: Theme = themeFromEnv();

export function setTheme(theme: Theme): void {
  currentTheme = theme;
}

function colourAllowed(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  if (process.env.TERM === "dumb") return false;
  return Boolean(process.stdout.isTTY);
}

export const COLOUR = colourAllowed();

export function deepColour(env = process.env): boolean {
  return COLOUR && (env.COLORTERM === "truecolor" || env.COLORTERM === "24bit");
}

export function to256(r: number, g: number, b: number): number {
  if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 24);
  }
  const step = (v: number) => Math.round((v / 255) * 5);
  return 16 + 36 * step(r) + 6 * step(g) + step(b);
}

export type Rgb = readonly [number, number, number];

export function cell(glyph: string, fg: Rgb | null, bg: Rgb | null, deep: boolean): string {
  if (!COLOUR) return glyph;
  const paintFg = (c: Rgb) =>
    deep ? `${ESC}[38;2;${c[0]};${c[1]};${c[2]}m` : `${ESC}[38;5;${to256(...c)}m`;
  const paintBg = (c: Rgb) =>
    deep ? `${ESC}[48;2;${c[0]};${c[1]};${c[2]}m` : `${ESC}[48;5;${to256(...c)}m`;
  if (fg === null && bg === null) return glyph;
  return `${bg === null ? "" : paintBg(bg)}${fg === null ? "" : paintFg(fg)}${glyph}${ESC}[0m`;
}

export function paint(text: string, ...tones: Tone[]): string {
  if (!COLOUR || tones.length === 0) return text;
  const codes = codesFor(currentTheme);
  const open = tones.map((t) => `[${codes[t]}m`).join("");
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
  if (text === "") return text;
  if (process.env.NO_COLOR !== undefined || process.env.TERM === "dumb") return text;
  if (tones.length === 0) return text;
  const codes = codesFor(currentTheme);
  const open = tones.map((t) => `${ESC}[${codes[t]}m`).join("");
  return `${open}${text}${ESC}[0m`;
}
