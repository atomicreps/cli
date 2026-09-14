import { describe, expect, it } from "vitest";

import { setTheme, themeFromEnv, tint } from "../src/ansi.js";
import { paintBlock } from "../src/block.js";
import { plainBlock, spans, tokenizeBlock } from "../src/format.js";

const ESC = String.fromCharCode(27);
const INK = `${ESC}[38;5;231m`;
const SOFT = `${ESC}[38;5;250m`;
const FAINT = `${ESC}[38;5;244m`;
const CORAL = `${ESC}[38;5;209m`;
const GOLD = `${ESC}[38;5;221m`;
const BOLD = `${ESC}[1m`;
const RESET = `${ESC}[0m`;

const SAMPLE = [
  "⚛ **Atomic Reps · TypeScript**",
  "──────────────────────────",
  "What is a **union type** in TypeScript?",
  "",
  "```ts",
  "function format(input: string) {}",
  "```",
  "",
  "A. A type that can be one of several types",
  "B. A type with only one member",
  "",
  "_Nothing fresh on that stack today, so this one is nearby._",
  "",
  "_From memory. Reply with a letter._",
  "──────────────────────────",
].join("\n");

describe("tokenizeBlock", () => {
  it("tells every line of the fixed shape apart", () => {
    const tokens = tokenizeBlock(SAMPLE);
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toEqual([
      "header",
      "rule",
      "text",
      "blank",
      "fence",
      "code",
      "fence",
      "blank",
      "option",
      "option",
      "blank",
      "note",
      "blank",
      "footer",
      "rule",
    ]);
    const header = tokens[0];
    expect(header).toMatchObject({ kind: "header", text: "Atomic Reps · TypeScript" });
    const code = tokens[5];
    expect(code).toMatchObject({ kind: "code", text: "function format(input: string) {}" });
    const optionA = tokens[8];
    expect(optionA).toMatchObject({
      kind: "option",
      letter: "A",
      text: "A type that can be one of several types",
    });
    const note = tokens[11];
    expect(note).toMatchObject({
      kind: "note",
      text: "Nothing fresh on that stack today, so this one is nearby.",
    });
    const footer = tokens[13];
    expect(footer).toMatchObject({ kind: "footer", text: "From memory. Reply with a letter." });
  });

  it("never matches a code line against header, option or note shapes", () => {
    const text = ["```ts", "A. not an option, this is code", "_not a note either_", "```"].join(
      "\n",
    );
    const kinds = tokenizeBlock(text).map((t) => t.kind);
    expect(kinds).toEqual(["fence", "code", "code", "fence"]);
  });
});

describe("spans", () => {
  it("splits bold and code, markers removed, in one pass", () => {
    expect(spans("a **b** `c` d")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", text: "b" },
      { kind: "text", text: " " },
      { kind: "code", text: "c" },
      { kind: "text", text: " d" },
    ]);
  });

  it("keeps a run of plain text as one span when there is nothing to split", () => {
    expect(spans("plain")).toEqual([{ kind: "text", text: "plain" }]);
  });
});

describe("plainBlock byte identity", () => {
  it("matches the hand-written expectation for the sample block", () => {
    expect(plainBlock(SAMPLE)).toEqual([
      "Atomic Reps · TypeScript",
      "What is a union type in TypeScript?",
      "",
      "```",
      "function format(input: string) {}",
      "```",
      "",
      "A. A type that can be one of several types",
      "B. A type with only one member",
      "",
      "Nothing fresh on that stack today, so this one is nearby.",
      "",
    ]);
  });

  it("keeps inline code's backticks, unlike bold", () => {
    expect(plainBlock("A. uses `useRef` for **DOM** access")).toEqual([
      "A. uses `useRef` for DOM access",
    ]);
  });
});

describe("paintBlock", () => {
  it("paints the question in ink, letters coral bold, code gold with backticks gone", () => {
    const text = [
      "⚛ **Atomic Reps · React**",
      "──────────────────────────",
      "Which hook holds a `ref`?",
      "",
      "A. useState",
      "",
      "_From memory. Reply with a letter._",
      "──────────────────────────",
    ].join("\n");
    const lines = paintBlock(text, tintForTest, { chrome: true });
    expect(lines[0]).toBe(`⚛ ${BOLD}${CORAL}Atomic Reps · React${RESET}`);
    expect(lines[1]).toBe(`${FAINT}──────────────────────────${RESET}`);
    expect(lines[2]).toBe(`${INK}Which hook holds a ${RESET}${GOLD}ref${RESET}${INK}?${RESET}`);
    expect(lines).toContain(`${BOLD}${CORAL}A.${RESET} ${INK}useState${RESET}`);
    expect(lines).toContain(`${SOFT}From memory. Reply with a letter.${RESET}`);
    expect(lines.at(-1)).toBe(`${FAINT}──────────────────────────${RESET}`);
  });

  it("indents a code line two spaces and never touches its own indentation", () => {
    const text = ["```ts", "    return x;", "```"].join("\n");
    const lines = paintBlock(text, tintForTest, { chrome: true });
    expect(lines).toEqual([`  ${SOFT}    return x;${RESET}`]);
  });

  it("chrome:false drops the mark, the rule and the footer but keeps the title", () => {
    const text = [
      "⚛ **Atomic Reps · React**",
      "──────────────────────────",
      "Which hook?",
      "",
      "_From memory. Reply with a letter._",
      "──────────────────────────",
    ].join("\n");
    const lines = paintBlock(text, tintForTest, { chrome: false });
    expect(lines).toEqual([
      `${BOLD}${CORAL}Atomic Reps · React${RESET}`,
      `${INK}Which hook?${RESET}`,
      "",
    ]);
  });

  it("wraps a long option with a 3-space continuation indent", () => {
    const text = "A. one two three four five six seven eight nine ten";
    const lines = paintBlock(text, plain, { chrome: false, width: 20 });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]?.startsWith("A. ")).toBe(true);
    for (const line of lines.slice(1)) expect(line.startsWith("   ")).toBe(true);
  });

  it("leaves a code line longer than width whole", () => {
    const long = "x".repeat(80);
    const text = ["```ts", long, "```"].join("\n");
    const lines = paintBlock(text, plain, { chrome: false, width: 20 });
    expect(lines).toEqual([`  ${long}`]);
  });
});

function tintForTest(text: string, ...tones: string[]): string {
  const codeFor = (tone: string): string =>
    tone === "ink"
      ? INK
      : tone === "soft"
        ? SOFT
        : tone === "faint"
          ? FAINT
          : tone === "coral"
            ? CORAL
            : tone === "gold"
              ? GOLD
              : tone === "bold"
                ? BOLD
                : "";
  if (tones.length === 0) return text;
  return `${tones.map(codeFor).join("")}${text}${RESET}`;
}

function plain(text: string, ..._tones: string[]): string {
  return text;
}

describe("theme", () => {
  it("moves ink to the light palette after setTheme", () => {
    const savedTerm = process.env.TERM;
    const savedNoColor = process.env.NO_COLOR;
    process.env.TERM = "xterm-256color";
    delete process.env.NO_COLOR;
    setTheme("light");
    try {
      expect(tint("x", "ink")).toBe(`${ESC}[38;5;235mx${ESC}[0m`);
    } finally {
      setTheme("dark");
      if (savedTerm === undefined) delete process.env.TERM;
      else process.env.TERM = savedTerm;
      if (savedNoColor !== undefined) process.env.NO_COLOR = savedNoColor;
    }
  });

  it("themeFromEnv reads COLORFGBG, the last number as the background", () => {
    const saved = process.env.COLORFGBG;
    try {
      process.env.COLORFGBG = "15;0";
      expect(themeFromEnv()).toBe("dark");
      process.env.COLORFGBG = "0;15";
      expect(themeFromEnv()).toBe("light");
      process.env.COLORFGBG = "0;7";
      expect(themeFromEnv()).toBe("light");
      delete process.env.COLORFGBG;
      expect(themeFromEnv()).toBe("dark");
    } finally {
      if (saved === undefined) delete process.env.COLORFGBG;
      else process.env.COLORFGBG = saved;
    }
  });
});
