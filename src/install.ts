import { paint, wrap } from "./ansi.js";
import * as api from "./api.js";
import * as clock from "./clock.js";
import { readConfig, updateConfig } from "./config.js";
import { FREE_MAX_LEVEL, TOUCHED_SHOWN, TUI_INFER_BUDGET_MS } from "./constants.js";
import { inferHints } from "./infer.js";
import { pickBand, pickOne, pickTree, type PickResult, type Rung } from "./pick.js";
import {
  COPY_WIDTH,
  hiddenCursor,
  isBack,
  isEnter,
  keyHint,
  out,
  pause,
  readKey,
  rule,
  step,
  TEXT_WIDTH,
  title,
  withLoop,
} from "./screen.js";
import { domainCatalog, ensureGrammar, topicCatalog } from "./store.js";
import { draftFrom, pickedFrom, selectionLine, type TreeGroup } from "./tree.js";
import type {
  ApiResult,
  DomainEntry,
  Draft,
  Intensity,
  LevelBand,
  SettingsPatch,
  ToolReply,
  TopicEntry,
} from "./types.js";

export const DEFAULT_DRAFT = {
  prefer: [],
  topics: [],
  strict: false,
  intensity: "regular",
  levels: { min: 1, max: 5 },
} as const satisfies Draft;

export const CADENCES = [
  { value: "off", name: "off", says: "never; set it up now, turn it on when you want" },
  { value: "light", name: "light", says: "when you finish a task, at most once an hour" },
  { value: "regular", name: "regular", says: "when you finish a task, at most every 20 minutes" },
  { value: "intense", name: "intense", says: "every time you finish a task" },
] as const satisfies readonly Cadence[];

type Cadence = { value: Intensity; name: string; says: string };

export function draftOf(summary: {
  readonly prefer?: readonly string[];
  readonly topics?: readonly string[];
  readonly strict?: boolean;
  readonly intensity?: string;
  readonly levels?: LevelBand;
}): Draft {
  const intensity = CADENCES.find((c) => c.value === summary.intensity)?.value;
  return {
    prefer: [...(summary.prefer ?? DEFAULT_DRAFT.prefer)],
    topics: [...(summary.topics ?? DEFAULT_DRAFT.topics)],
    strict: summary.strict ?? DEFAULT_DRAFT.strict,
    intensity: intensity ?? DEFAULT_DRAFT.intensity,
    levels: summary.levels ?? DEFAULT_DRAFT.levels,
  };
}

export const LEVELS = [
  { level: 1, name: "foundations", says: "what a thing is, and what it is for" },
  { level: 2, name: "working", says: "what an option does, and how two of them differ" },
  { level: 3, name: "deep", says: "a realistic setup, and what happens when it runs" },
  { level: 4, name: "hard", says: "two mechanisms interacting, and which one takes precedence" },
  { level: 5, name: "brutal", says: "the trade-off, and where the simple explanation is wrong" },
] as const satisfies readonly Rung[];

export const WELCOME = [
  "One short question about the thing you just built, while you still remember it. Your agent never writes it. Every question is authored and reviewed long before it reaches you.",
  "This machine sends only the topic and sub-skill names the question is chosen from, with small weights, and the names of packages, file extensions and folders the public catalog already knows. Anything it does not know stays here, as does every line of your code and every word of your prompts.",
  "AI makes the work faster. How the work feels is part of the evidence too: atomicreps.com/research/the-human-cost",
] as const;

export const SENT_NOTE =
  "We send nothing else. We choose the question from those names and the settings you pick next. More at atomicreps.com/docs/data-flows";

export const FREE_LEVEL_NOTE =
  "A tagged level is stored, never refused: set the level range you want and it applies from the day a paid Pro, team or school seat starts. On Free you get level 1 questions until then.";

function paragraph(text: string, width: number = TEXT_WIDTH): string[] {
  return wrap(text, width).map((line) => paint(line, "faint"));
}

async function sentScreen(): Promise<void> {
  out(withLoop("thinking", [title("Reading this working tree\u2026")]));
  const grammar = await ensureGrammar();
  const hints = await inferHints(process.cwd(), TUI_INFER_BUDGET_MS, grammar);
  const touched = hints.touched.slice(0, TOUCHED_SHOWN);
  const rows =
    touched.length > 0
      ? touched.map((t) => `    ${t.key.padEnd(30)} ${paint(`\u00b7${t.weight}`, "gold")}`)
      : paragraph(
          grammar === null
            ? "    Topic names resolve after you sign in; the rest below is read here on your machine."
            : "    Nothing changed yet, so a rep would be chosen from your settings instead.",
        );
  const line = (label: string, values: readonly string[]): string[] => {
    if (values.length === 0) return [];
    const wrapped = wrap(values.join(", "), TEXT_WIDTH - 16);
    return wrapped.map(
      (part, i) => `    ${paint((i === 0 ? label : "").padEnd(12), "faint")}${part}`,
    );
  };
  out([
    ...withLoop("idle", [
      title("What gets sent."),
      "",
      ...paragraph(
        "Everything below is what this repo would send right now, and it is only names the catalog already knows. Shapes are file extensions and top-level folder names.",
        COPY_WIDTH,
      ),
      "",
    ]),
    ...rows,
    "",
    ...line("packages", hints.packages.slice(0, 8)),
    ...line("shapes", hints.extensions.slice(0, 10)),
    ...(hints.packages.length === 0 && hints.extensions.length === 0
      ? paragraph("    Nothing else here is in the catalog, so nothing else would be sent.")
      : []),
    "",
    ...paragraph(SENT_NOTE),
  ]);
  await pause();
}

export function catalogTree(
  domains: readonly DomainEntry[],
  topics: readonly TopicEntry[],
): TreeGroup[] {
  return domains
    .map((domain) => ({
      slug: domain.slug,
      name: domain.name,
      children: topics
        .filter((topic) => topic.domain === domain.slug)
        .map((topic) => ({ slug: topic.slug, name: topic.name })),
    }))
    .filter((group) => group.children.length > 0);
}

const SCOPE_INTRO =
  "Take a whole area, or open one and pick the topics inside it. Type any letters to search all of them at once. What you are building still comes first; these topics are used when your working tree has no recent changes.";

export async function scopeScreen(draft: Draft, stepLine?: string): Promise<PickResult<Draft>> {
  const groups = catalogTree(await domainCatalog(), await topicCatalog());
  if (groups.length === 0) {
    out(
      withLoop("facepalm", [
        title("Could not load the catalog."),
        "Check your connection and run npx atomicreps again.",
      ]),
    );
    await pause();
    return { ok: false, why: "quit" };
  }
  const picked = await pickTree({
    groups,
    picked: pickedFrom(groups, draft.prefer, draft.topics),
    heading: "What are you working on?",
    intro: SCOPE_INTRO,
    stepLine,
    summary: (ticks) => selectionLine(groups, ticks),
  });
  if (!picked.ok) return picked;
  return { ok: true, value: { ...draft, ...draftFrom(groups, picked.value) } };
}

export async function gateScreen(draft: Draft, stepLine?: string): Promise<PickResult<Draft>> {
  if (draft.prefer.length === 0) return { ok: true, value: draft };
  const picked = await pickOne<boolean>({
    choices: [
      {
        value: false,
        label: "These first",
        hint: "Questions can come from anything you touch; what you picked comes first.",
      },
      {
        value: true,
        label: "Only these",
        hint: "Touch something outside them and no rep arrives at all.",
      },
    ],
    current: draft.strict,
    heading: "What about everything else?",
    intro:
      "A rep is chosen from what you changed, so if you work in a language you did not pick, you can still get questions about it. Choose whether you want that.",
    stepLine,
  });
  if (!picked.ok) return picked;
  return { ok: true, value: { ...draft, strict: picked.value } };
}

export async function cadenceScreen(draft: Draft, stepLine?: string): Promise<PickResult<Draft>> {
  const picked = await pickOne<Intensity>({
    choices: CADENCES.map((cadence) => ({
      value: cadence.value,
      label: cadence.name,
      hint: cadence.says,
    })),
    current: draft.intensity,
    heading: "How often should a rep arrive?",
    intro:
      "A rep appears after a task finishes, never while you type. Each option is the most often a rep can appear.",
    stepLine,
  });
  if (!picked.ok) return picked;
  return { ok: true, value: { ...draft, intensity: picked.value } };
}

export async function levelsScreen(draft: Draft, stepLine?: string): Promise<PickResult<Draft>> {
  const picked = await pickBand({
    rungs: LEVELS.map((rung) => ({
      ...rung,
      ...(rung.level > FREE_MAX_LEVEL ? { tag: "PRO" } : {}),
    })),
    band: draft.levels,
    heading: "How hard?",
    intro:
      "Space the easiest level you want, then the hardest. Questions can come from every level between them.",
    stepLine,
    note: FREE_LEVEL_NOTE,
  });
  if (!picked.ok) return picked;
  return { ok: true, value: { ...draft, levels: picked.value } };
}

const DIALOG_INTRO =
  "Your editor can pop up its own box for the letter and read the answer back, so neither the question nor your answer passes through the chat. Off leaves it in the chat, the way it works today.";

export async function dialogScreen(draft: Draft, stepLine?: string): Promise<PickResult<Draft>> {
  const picked = await pickOne<boolean>({
    choices: [
      {
        value: false,
        label: "In the chat",
        hint: "The letter shows up in the conversation, same as now.",
      },
      {
        value: true,
        label: "In a native dialog",
        hint: "Your editor asks for the letter its own way; it blocks the turn until answered.",
      },
    ],
    current: draft.dialog ?? false,
    heading: "Where should the answer go?",
    intro: DIALOG_INTRO,
    stepLine,
  });
  if (!picked.ok) return picked;
  return { ok: true, value: { ...draft, dialog: picked.value } };
}

export function patchOf(draft: Draft): SettingsPatch {
  return {
    prefer: draft.prefer,
    topics: draft.topics,
    strict: draft.strict,
    intensity: draft.intensity,
    levels: draft.levels,
    ...(draft.dialog === undefined ? {} : { dialog: draft.dialog }),
  };
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function draftLines(draft: Draft, names: ReadonlyMap<string, string> = new Map()): string[] {
  const cadence = CADENCES.find((c) => c.value === draft.intensity);
  const areas = draft.prefer.map((slug) => names.get(slug) ?? slug).join(", ");
  const gate = draft.strict ? " · only these" : "";
  const scope =
    draft.prefer.length === 0
      ? "the whole catalog"
      : draft.topics.length === 0
        ? `${areas}, whole${gate}`
        : `${areas} · ${count(draft.topics.length, "topic")} pinned${gate}`;
  const { min, max } = draft.levels;
  const band = min === max ? `level ${min}` : `levels ${min} to ${max}`;
  return [
    `Areas: ${scope}.`,
    `Rate: ${cadence?.says ?? draft.intensity}.`,
    `Depth: ${band}.`,
    ...(draft.dialog === undefined ? [] : [`Answer: ${draft.dialog ? "native dialog" : "chat"}.`]),
  ];
}

export async function runInstall(deps: {
  login: () => Promise<boolean>;
  connect: () => Promise<void>;
  save: (patch: SettingsPatch) => Promise<ApiResult<ToolReply>>;
  hasToken: () => boolean;
}): Promise<boolean> {
  using _cursor = hiddenCursor();
  for (;;) {
    out([
      ...withLoop("idle", [
        title("Atomic Reps, in your coding agent."),
        "",
        ...paragraph(WELCOME[0] ?? "", COPY_WIDTH),
      ]),
      "",
      ...paragraph(WELCOME[1] ?? ""),
      "",
      ...paragraph(WELCOME[2] ?? ""),
      "",
      rule(),
      keyHint([
        ["enter", "set it up"],
        ["w", "what gets sent"],
        ["esc", "quit"],
      ]),
    ]);
    const key = await readKey();
    if (isBack(key)) return false;
    if (isEnter(key)) break;
    if (key === "w") await sentScreen();
  }

  let draft: Draft = DEFAULT_DRAFT;
  const screens = [
    scopeScreen,
    gateScreen,
    cadenceScreen,
    levelsScreen,
    ...(readConfig().elicitationCapable ? [dialogScreen] : []),
  ];
  const steps = screens.length + 1;
  for (let i = 0; i < screens.length;) {
    const screen = screens[i];
    if (screen === undefined) break;
    const next = await screen(draft, step(i + 1, steps));
    if (!next.ok) {
      if (next.why === "quit" || i === 0) return false;
      i -= 1;
      continue;
    }
    draft = next.value;
    i += 1;
  }

  out(
    withLoop("impressed", [
      `${title("That is the setup.")}   ${step(steps, steps)}`,
      "",
      ...draftLines(draft, new Map((await domainCatalog()).map((d) => [d.slug, d.name]))).map(
        (line) => paint(line, "soft"),
      ),
      "",
      ...paragraph(
        "Signing in saves it to your account, so a second machine starts here.",
        COPY_WIDTH,
      ),
      "",
      keyHint([["enter", "sign in"]]),
    ]),
  );
  await readKey();

  if (!deps.hasToken() && !(await deps.login())) return false;

  const saved = await deps.save(patchOf(draft));
  out(
    withLoop(saved.ok ? "celebrating" : "facepalm", [
      title(saved.ok ? "Saved." : `Could not save (${saved.reason}).`),
      "",
      ...(saved.ok
        ? paragraph(saved.value.text, COPY_WIDTH)
        : paragraph("Run npx atomicreps to set it again.", COPY_WIDTH)),
      "",
      keyHint([["enter", "connect an editor"]]),
    ]),
  );
  await readKey();
  updateConfig({ setupAt: clock.now() });
  await deps.connect();
  return true;
}

export function needsSetup(): boolean {
  const config = readConfig();
  return config.setupAt === undefined && config.token === undefined;
}

export async function install(): Promise<boolean> {
  const { connect, login } = await import("./tui.js");
  return await runInstall({
    login: () => login(true),
    connect: () => connect(true),
    save: (patch) => api.settings(patch),
    hasToken: () => readConfig().token !== undefined,
  });
}
