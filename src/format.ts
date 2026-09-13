export const REP_MARK = "⚛";
export const REP_RULE = "─".repeat(26);
export const REP_FOOTER = "_From memory. Reply with a letter._";
export const REP_FOOTER_TAP =
  "_From memory. Reply with a letter; add ! if you are sure, ? if you are not._";

export function plainBlock(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line !== REP_RULE && line !== REP_FOOTER && line !== REP_FOOTER_TAP)
    .map((line) =>
      line
        .replace(/^```\w+$/, "```")
        .replace(/^⚛ \*\*(.*)\*\*$/, "$1")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/^_(.+)_$/, "$1"),
    );
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
      "Intensity, a timed mute, a topic mute for days or forever, an unmute, preferred domains, or the dialog.",
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
      },
    },
  },
];
