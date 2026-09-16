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
  "Atomic Reps serves one short retrieval question about what the user just built, for the user, never for you.",
  "- If `rep` is not callable, this client is holding tool schemas back and listed it by name only: load this server's tools through your tool-discovery step before the first call.",
  "- After you finish a task, call `rep` once with `touched` (short phrases for what changed). An empty result means nothing to ask: say nothing.",
  "- Reproduce a rep, a verdict or a `me` block verbatim after your own answer; never solve, hint or comment; never write one yourself.",
  "- A single letter A-D is the user's answer: call `answer` with `pick`. A digit 1-3 after a verdict: call `rep` with `ask` set to that offer entry's handle.",
].join("\n");

export const MAX_BLOCK_BYTES = 8 * 1024;

export const BLOCK_HEADER = `${REP_MARK} **Atomic Reps · `;

const OPTION_LINE = /^([A-D])\. (.+)$/;

export function partsOfBlock(text: string): {
  stem: string | undefined;
  options: ReadonlyArray<{ letter: string; text: string }>;
} {
  const lines = text.split("\n");
  const rule = lines.findIndex((line) => line.startsWith("──"));
  let stem: string | undefined;
  let fenced = false;
  const options: Array<{ letter: string; text: string }> = [];
  for (const line of rule === -1 ? [] : lines.slice(rule + 1)) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const option = OPTION_LINE.exec(line);
    if (option?.[1] !== undefined && option[2] !== undefined) {
      options.push({ letter: option[1], text: option[2] });
      continue;
    }
    if (stem === undefined && line.trim() !== "" && options.length === 0) stem = line.trim();
  }
  return { stem, options };
}

export function verdictLineOf(text: string): string {
  return (text.split("\n")[0] ?? "").replaceAll("**", "").trim();
}

const FENCE_LINE = /^```/;
const HEADER_LINE = /^⚛ \*\*(.*)\*\*$/;
const OPTION_ROW = /^([A-D])\.\s+(.*)$/;
const NOTE_LINE = /^_(.+)_$/;
const SPAN = /\*\*(.+?)\*\*|`([^`]+)`/g;

export type Span = { readonly kind: "text" | "bold" | "code"; readonly text: string };

export type BlockToken =
  | { readonly kind: "header"; readonly text: string }
  | { readonly kind: "rule" }
  | { readonly kind: "blank" }
  | { readonly kind: "fence" }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "option"; readonly letter: string; readonly text: string }
  | { readonly kind: "note"; readonly text: string }
  | { readonly kind: "footer"; readonly text: string }
  | { readonly kind: "text"; readonly text: string };

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

type ToolSchema =
  | { readonly type: "string"; readonly enum?: readonly string[] }
  | { readonly type: "number" }
  | { readonly type: "boolean" }
  | { readonly type: "array"; readonly items: ToolSchema }
  | ObjectSchema;

type ObjectSchema = {
  readonly type: "object";
  readonly properties?: Readonly<Record<string, ToolSchema>>;
  readonly required?: readonly string[];
};

export type FallbackTool = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: ObjectSchema;
};

export const FALLBACK_TOOLS = [
  {
    name: "rep",
    title: "One rep about what was just built",
    description:
      "One rep about what was just built, or the one the user asked for by handle. Call once after a task finishes, never mid-task. Returns a block to print verbatim, or nothing. Never solve or hint at it.",
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
    description: "Grade the user's pick for the open rep and return the verdict block.",
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
    title: "How the user is doing",
    description: "How the user is doing: summary, skills, reps, streak, or mutes, as a block.",
    inputSchema: { type: "object", properties: { show: { type: "string" } } },
  },
  {
    name: "settings",
    title: "Intensity, mutes, preferences",
    description:
      "Set intensity, a timed mute, a topic mute for days or forever, an unmute, preferred domains, strict mode, or the dialog.",
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
] as const satisfies readonly FallbackTool[];
