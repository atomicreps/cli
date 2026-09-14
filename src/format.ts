export const REP_MARK = "⚛";
export const REP_RULE = "─".repeat(26);
export const REP_FOOTER = "_From memory. Reply with a letter._";
export const REP_FOOTER_TAP =
  "_From memory. Reply with a letter; add ! if you are sure, ? if you are not._";

export function plainBlock(text: string): string[] {
  const out: string[] = [];
  for (const token of tokenizeBlock(text)) {
    switch (token.kind) {
      case "rule":
      case "footer":
        continue;
      case "blank":
        out.push("");
        continue;
      case "fence":
        out.push("```");
        continue;
      case "code":
      case "header":
      case "note":
        out.push(token.text);
        continue;
      case "option":
        out.push(`${token.letter}. ${plainSpans(token.text)}`);
        continue;
      case "text":
        out.push(plainSpans(token.text));
        continue;
    }
  }
  return out;
}

export const FALLBACK_INSTRUCTIONS = [
  "Atomic Reps serves one short retrieval question about what the user just built, for the person at the keyboard, never for you.",
  "- If `rep` is not callable, this client is holding tool schemas back and listed it by name only: load this server's tools through your tool-discovery step before the first call.",
  "- After you finish a task, call `rep` once with `touched` (short phrases for what changed). An empty result is quiet: say nothing.",
  "- Reproduce a rep, a verdict or a `me` block verbatim after your own answer; never solve, hint or comment; never write one yourself.",
  "- A single letter A-D is the user's answer: call `answer` with `pick`. A digit 1-3 after a verdict: call `rep` with `ask` set to that offer entry's handle.",
].join("\n");

export const MAX_BLOCK_BYTES = 8 * 1024;

const BLOCK_HEADER = `${REP_MARK} **Atomic Reps · `;

const FENCE_LINE = /^```/;
const HEADER_LINE = /^⚛ \*\*(.*)\*\*$/;
const OPTION_ROW = /^([A-D])\.\s+(.*)$/;
const NOTE_LINE = /^_(.+)_$/;
const SPAN = /\*\*(.+?)\*\*|`([^`]+)`/g;

export type Span = { kind: "text" | "bold" | "code"; text: string };

export type BlockToken =
  | { kind: "header"; text: string }
  | { kind: "rule" }
  | { kind: "blank" }
  | { kind: "fence" }
  | { kind: "code"; text: string }
  | { kind: "option"; letter: string; text: string }
  | { kind: "note"; text: string }
  | { kind: "footer"; text: string }
  | { kind: "text"; text: string };

export function tokenizeBlock(text: string): BlockToken[] {
  const tokens: BlockToken[] = [];
  let inCode = false;
  for (const line of text.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inCode = !inCode;
      tokens.push({ kind: "fence" });
      continue;
    }
    if (inCode) {
      tokens.push({ kind: "code", text: line });
      continue;
    }
    if (line === "") {
      tokens.push({ kind: "blank" });
      continue;
    }
    if (line === REP_RULE) {
      tokens.push({ kind: "rule" });
      continue;
    }
    if (line === REP_FOOTER || line === REP_FOOTER_TAP) {
      tokens.push({ kind: "footer", text: line.slice(1, -1) });
      continue;
    }
    const header = HEADER_LINE.exec(line);
    if (header?.[1] !== undefined) {
      tokens.push({ kind: "header", text: header[1] });
      continue;
    }
    const option = OPTION_ROW.exec(line);
    if (option?.[1] !== undefined && option[2] !== undefined) {
      tokens.push({ kind: "option", letter: option[1], text: option[2] });
      continue;
    }
    const note = NOTE_LINE.exec(line);
    if (note?.[1] !== undefined) {
      tokens.push({ kind: "note", text: note[1] });
      continue;
    }
    tokens.push({ kind: "text", text: line });
  }
  return tokens;
}

export function spans(text: string): Span[] {
  const out: Span[] = [];
  let last = 0;
  for (const match of text.matchAll(SPAN)) {
    if (match.index > last) out.push({ kind: "text", text: text.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ kind: "bold", text: match[1] });
    else if (match[2] !== undefined) out.push({ kind: "code", text: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

function plainSpans(text: string): string {
  return spans(text)
    .map((span) =>
      span.kind === "bold" ? span.text : span.kind === "code" ? `\`${span.text}\`` : span.text,
    )
    .join("");
}

export function isRepBlock(text: unknown): text is string {
  if (typeof text !== "string" || text.length > MAX_BLOCK_BYTES) return false;
  const lines = text.split("\n");
  const [header, rule] = lines;
  if (header === undefined || !header.startsWith(BLOCK_HEADER)) return false;
  if (rule !== REP_RULE) return false;
  return lines.length >= 3;
}

export const FALLBACK_TOOLS: ReadonlyArray<Record<string, unknown>> = [
  {
    name: "rep",
    title: "One rep about what was just built",
    description:
      "One rep about what was just built, or the one the person asked for by handle. Returns a block to print verbatim, or quiet.",
    inputSchema: {
      type: "object",
      properties: {
        touched: { type: "array", items: { type: "string" } },
        ask: { type: "string" },
        lane: { type: "string", enum: ["asked"] },
        topic: { type: "string" },
        kind: { type: "string" },
        exclude: { type: "string" },
      },
    },
  },
  {
    name: "answer",
    title: "Answer the open rep",
    description: "Grade the person's pick for the open rep and return the verdict block.",
    inputSchema: {
      type: "object",
      properties: {
        pick: { type: "string" },
        sure: { type: "boolean" },
        id: { type: "string" },
      },
      required: ["pick"],
    },
  },
  {
    name: "me",
    title: "How the person is doing",
    description: "How the person is doing: summary, skills, reps, streak or mutes, as a block.",
    inputSchema: { type: "object", properties: { show: { type: "string" } } },
  },
  {
    name: "settings",
    title: "Intensity, mutes, preferences",
    description:
      "Intensity, a timed mute, a topic mute for days or forever, an unmute, preferred domains, strict, or the dialog.",
    inputSchema: {
      type: "object",
      properties: {
        intensity: { type: "string" },
        confidencePrompt: { type: "string" },
        muteMinutes: { type: "number" },
        mute: { type: "string" },
        days: { type: "number" },
        unmute: { type: "string" },
        prefer: { type: "array", items: { type: "string" } },
        dialog: { type: "boolean" },
        strict: { type: "boolean" },
      },
    },
  },
];
