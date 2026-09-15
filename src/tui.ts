import { dirname, join } from "node:path";

import { padTo, paint, stripAnsi } from "./ansi.js";
import * as api from "./api.js";
import { paintBlock } from "./block.js";
import * as clock from "./clock.js";
import {
  apiOrigin,
  channelFollowedSignIn,
  channelOf,
  clientLabel,
  hostLabel,
  configPath,
  readConfig,
  rejectedOverrides,
  siteOrigin,
  updateConfig,
  writeConfig,
} from "./config.js";
import {
  allowlistMissing,
  connectOffers,
  claudeAvailable,
  claudeAddCommand,
  claudeSettingsPath,
  codexAddCommand,
  cursorConfig,
  cursorMcpPath,
  windsurfMcpPath,
} from "./connect.js";
import {
  ART_GUTTER_WIDE,
  CLEAR,
  ENV,
  STAT_LABEL,
  STREAK_DOTS,
  LOGIN_DEADLINE_MS,
  QUICK_MUTE_MINUTES,
  QUICK_MUTE_MS,
  TOKEN_PREFIX_CHARS,
  TOUCHED_SHOWN,
  TUI_INFER_BUDGET_MS,
} from "./constants.js";
import { readJsonFile } from "./files.js";
import { inferHints } from "./infer.js";
import { CADENCES, draftOf, gateScreen, install, levelsScreen, scopeScreen } from "./install.js";
import { loopRows } from "./loop.js";
import { pickMany, pickOne } from "./pick.js";
import {
  beside,
  copyToClipboard,
  hiddenCursor,
  isBack,
  isEnter,
  isInteractive,
  keyHint,
  openBrowser,
  out,
  pause,
  plain,
  readKey,
  rule,
  TEXT_WIDTH,
  title,
  withLoop,
} from "./screen.js";
import { ensureGrammar, observeRep, observeVerdict, offerOf, pendingRep } from "./store.js";
import {
  asPick,
  stringList,
  type ApiResult,
  type Intensity,
  type LevelBand,
  type LocalHints,
  type LoopPose,
  type OfferEntry,
  type Pick,
  type ToolReply,
} from "./types.js";
import { isBehind, SERVER_VERSION } from "./version.js";
import { bool, list, num, record, str } from "./wire.js";

async function fetched<T>(
  result: ApiResult<T>,
  failTitle = "Could not reach the server.",
): Promise<T | null> {
  if (result.ok) return result.value;
  out(withLoop("facepalm", [title(failTitle), `(${result.reason})`]));
  await pause();
  return null;
}

async function confirmSaved(result: ApiResult<ToolReply>, pose: LoopPose = "impressed") {
  out(
    withLoop(pose, [title(result.ok ? result.value.text : `Could not save (${result.reason}).`)]),
  );
  await pause();
}

function humanize(key: string): string {
  const [topic, sub] = key.split(".");
  const words = (s: string) => s.replace(/_/g, " ");
  return sub ? `${words(topic ?? "")} · ${words(sub)}` : words(topic ?? key);
}

export async function login(interactive = isInteractive()): Promise<boolean> {
  const started = await api.startDeviceLogin(clientLabel(), hostLabel());
  if (!started.ok) {
    plain([`Could not reach ${siteOrigin()} (${started.reason}). Try again in a moment.`]);
    return false;
  }
  const { userCode, deviceSecret, verifyUrl, expiresAt, intervalMs } = started.value;
  const copied = interactive && copyToClipboard(userCode);
  const copy = [
    title("Sign in from your browser."),
    "",
    `Open ${paint(verifyUrl, "coral", "bold")} and type this code:`,
    "",
    `      ${paint(` ${userCode} `, "bold", "ink")}${copied ? paint("   (copied)", "faint") : ""}`,
    "",
    paint("The code never travels in a link. Only approve a code you see here.", "faint"),
  ];
  if (interactive) out(withLoop("thinking", copy));
  else plain(copy);
  openBrowser(verifyUrl);

  while (clock.now() < expiresAt) {
    await clock.sleep(intervalMs);
    const polled = await api.pollDeviceLogin(deviceSecret);
    if (!polled.ok) continue;
    if (polled.value.status === "approved") {
      writeConfig({
        token: polled.value.token,
        tokenPrefix: polled.value.token.slice(0, TOKEN_PREFIX_CHARS),
        connectedAt: clock.now(),
      });
      return true;
    }
    if (polled.value.status === "expired") break;
  }
  plain(["That code expired. Run npx atomicreps again for a fresh one."]);
  return false;
}

type Summary = {
  readonly name: string;
  readonly isPro: boolean;
  readonly intensity: string;
  readonly cap: number | null;
  readonly gapMinutes: number;
  readonly answeredToday: number;
  readonly askedToday: number;
  readonly askedCap: number;
  readonly weekReps: number;
  readonly currentStreak: number;
  readonly longestStreak: number;
  readonly mutedUntil?: number;
  readonly prefer: readonly string[];
  readonly muteCount: number;
  readonly upgradeUrl: string | null;
  readonly topics?: readonly string[];
  readonly strict?: boolean;
  readonly levels?: LevelBand;
};

function parseBand(value: unknown): LevelBand | undefined {
  const raw = record(value);
  if (raw === undefined) return undefined;
  const min = num(raw.min);
  const max = num(raw.max);
  return min === undefined || max === undefined ? undefined : { min, max };
}

function parseSummary(value: unknown): Summary {
  const raw = record(value) ?? {};
  const mutedUntil = num(raw.mutedUntil);
  const strict = bool(raw.strict);
  const levels = parseBand(raw.levels);
  return {
    name: str(raw.name) ?? "",
    isPro: bool(raw.isPro) ?? false,
    intensity: str(raw.intensity) ?? "",
    cap: num(raw.cap) ?? null,
    gapMinutes: num(raw.gapMinutes) ?? 0,
    answeredToday: num(raw.answeredToday) ?? 0,
    askedToday: num(raw.askedToday) ?? 0,
    askedCap: num(raw.askedCap) ?? 0,
    weekReps: num(raw.weekReps) ?? 0,
    currentStreak: num(raw.currentStreak) ?? 0,
    longestStreak: num(raw.longestStreak) ?? 0,
    prefer: stringList(raw.prefer),
    muteCount: num(raw.muteCount) ?? 0,
    upgradeUrl: str(raw.upgradeUrl) ?? null,
    ...(mutedUntil === undefined ? {} : { mutedUntil }),
    ...(Array.isArray(raw.topics) ? { topics: stringList(raw.topics) } : {}),
    ...(strict === undefined ? {} : { strict }),
    ...(levels === undefined ? {} : { levels }),
  };
}

async function fetchSummary(): Promise<Summary | null> {
  const result = await api.me("summary", LOGIN_DEADLINE_MS);
  if (!result.ok || !result.value.data) return null;
  return parseSummary(result.value.data);
}

function streakDots(streak: number): string {
  const on = Math.min(STREAK_DOTS, streak);
  return `${paint("●".repeat(on), "coral")}${paint("○".repeat(STREAK_DOTS - on), "faint")}`;
}

function meter(done: number, cap: number, cells = 10): string {
  if (cap <= 0) return "";
  const on = Math.min(cells, Math.round((done / cap) * cells));
  const tone = done >= cap ? "green" : "coral";
  return `${paint("▰".repeat(on), tone)}${paint("▱".repeat(cells - on), "faint")} `;
}

function statRow(label: string, value: string): string {
  return `${padTo(paint(label, "faint"), STAT_LABEL)}${value}`;
}

function summaryLines(s: Summary): string[] {
  const plan = s.isPro ? paint("Pro", "gold", "bold") : paint("Free", "soft", "bold");
  const muted = s.mutedUntil !== undefined && s.mutedUntil > clock.now();
  const width = TEXT_WIDTH - ART_GUTTER_WIDE;
  const areas = s.prefer.length > 0 ? s.prefer : ["the whole catalog"];
  return [
    `${title(`Hey ${s.name}.`)}   ${plan}`,
    "",
    `${streakDots(s.currentStreak)}  ${paint(`${s.currentStreak}-day streak`, "ink")}${paint(`, best ${s.longestStreak}`, "faint")}`,
    "",
    statRow(
      "answered",
      `${s.cap === null ? "" : meter(s.answeredToday, s.cap, 8)}${paint(String(s.answeredToday), "ink")} ${paint("today", "soft")}${paint(" · ", "faint")}${paint(String(s.weekReps), "ink")} ${paint("this week", "soft")}`,
    ),
    statRow(
      "asked",
      `${meter(s.askedToday, s.askedCap, 8)}${paint(String(s.askedToday), "ink")}${paint(`/${s.askedCap}`, "faint")}`,
    ),
    statRow(
      "rate",
      `${paint(muted ? "muted" : s.intensity, "ink")}${paint(`, ${s.gapMinutes} min between reps`, "soft")}`,
    ),
    statRow("areas", paint(clipList(areas, width - STAT_LABEL, s), "soft")),
  ];
}

function clipList(names: readonly string[], width: number, s: Summary): string {
  const tail = `${s.strict ? " · only these" : ""}${s.muteCount > 0 ? ` · ${s.muteCount} muted` : ""}`;
  const room = width - tail.length;
  let shown = names.length;
  while (
    shown > 1 &&
    `${names.slice(0, shown).join(", ")} +${names.length - shown}`.length > room
  ) {
    shown -= 1;
  }
  const more = names.length - shown;
  return `${names.slice(0, shown).join(", ")}${more > 0 ? ` +${more}` : ""}${tail}`;
}

async function localHints(): Promise<LocalHints> {
  return await inferHints(process.cwd(), TUI_INFER_BUDGET_MS, await ensureGrammar());
}

async function repScreen(ask?: string): Promise<void> {
  const now = clock.now();
  const served = await fetched(
    await api.rep(
      ask === undefined
        ? { hints: await localHints(), lane: "asked", kind: "question" }
        : { ask, kind: "question" },
      LOGIN_DEADLINE_MS,
    ),
  );
  if (!served) return;
  const data = served.data ?? {};
  observeRep(data, served.text, now);
  const id = str(data.id);
  if (data.kind !== "question" || id === undefined) {
    const reason = str(data.reason);
    const why =
      reason === "spent"
        ? "Today's requested reps are done."
        : reason === "off"
          ? "Reps are off. Set an intensity to turn them on."
          : "Nothing to serve right now.";
    out(withLoop("sleeping", [title("No rep."), why]));
    await pause();
    return;
  }
  const body = paintBlock(served.text, paint, { chrome: false, width: TEXT_WIDTH });
  out([
    ...withLoop("thinking", [title("One rep. From memory."), "", ...body.slice(0, 3)]),
    ...body.slice(3),
    "",
    keyHint([
      ["A-D", "answer"],
      ["esc", "skip"],
    ]),
  ]);
  let pick: Pick | null = null;
  while (pick === null) {
    const key = await readKey();
    if (isBack(key)) return;
    pick = asPick(key);
  }
  const answered = await fetched(await api.answer(id, pick), "Could not grade that.");
  if (!answered) return;
  const verdict = answered.data ?? {};
  observeVerdict(id, verdict, answered.text, now);
  const offer: OfferEntry[] = offerOf(verdict);
  const correct = verdict.correct === true;
  const graded = verdict.status === "answered";
  const lines = paintBlock(answered.text, paint, { chrome: false, width: TEXT_WIDTH }).filter(
    (line) => !stripAnsi(line).startsWith("Also touched:"),
  );
  out([
    ...withLoop(correct ? "celebrating" : graded ? "facepalm" : "idle", [
      title(correct ? "Yes." : graded ? "Not this time." : "Hm."),
      "",
      ...lines.slice(0, 3),
    ]),
    ...lines.slice(3),
    "",
    ...(offer.length > 0
      ? [paint("Also touched:", "faint"), keyHint(offer.map((o, i) => [String(i + 1), o.name])), ""]
      : []),
    keyHint([["any other key", "back"]]),
  ]);
  const next = offer[Number(await readKey()) - 1];
  if (next) await repScreen(next.handle);
}

async function sessionScreen(): Promise<void> {
  out(withLoop("thinking", [title("Reading the working tree…")]));
  const { touched } = await localHints();
  if (touched.length === 0) {
    out(
      withLoop("idle", [
        title("Nothing touched yet."),
        "Change a file, or ask for any rep from the home screen.",
      ]),
    );
    await pause();
    return;
  }
  const shown = touched.slice(0, TOUCHED_SHOWN);
  out([
    ...withLoop("impressed", [title("This session touched:"), ""]),
    ...shown.map(
      (entry, i) =>
        `${paint(String(i + 1), "coral", "bold")} ${humanize(entry.key)}  ${paint(`·${entry.weight}`, "faint")}`,
    ),
    "",
    keyHint([
      ["1-8", "a rep on that"],
      ["esc", "back"],
    ]),
  ]);
  const key = await readKey();
  const entry = shown[Number(key) - 1];
  if (entry) await repScreen(entry.key);
}

async function skillsScreen(): Promise<void> {
  const skills = await fetched(await api.me("skills", LOGIN_DEADLINE_MS));
  if (!skills) return;
  const lines = paintBlock(skills.text, paint, { chrome: false, width: TEXT_WIDTH });
  out([...withLoop("impressed", [lines[0] ?? title("Skills"), ""]), ...lines.slice(1)]);
  await pause();
}

type MuteRow = { readonly key: string; readonly name: string; readonly until?: number };

function parseMuteRow(value: unknown): MuteRow | null {
  const raw = record(value);
  if (raw === undefined) return null;
  const key = str(raw.key);
  const name = str(raw.name);
  if (key === undefined || name === undefined) return null;
  const until = num(raw.until);
  return { key, name, ...(until === undefined ? {} : { until }) };
}

async function mutesScreen(): Promise<void> {
  const shown = await fetched(await api.me("mutes", LOGIN_DEADLINE_MS));
  if (!shown) return;
  const mutes = list(shown.data?.mutes, parseMuteRow).slice(0, 9);
  if (mutes.length === 0) {
    out(
      withLoop("idle", [
        title("No mutes."),
        'Tell your agent "never X" or "not this topic" and it lands here.',
      ]),
    );
    await pause();
    return;
  }
  out([
    ...withLoop("idle", [title("Muted."), "A number lifts one.", ""]),
    ...mutes.map(
      (m, i) =>
        `${paint(String(i + 1), "coral", "bold")} ${m.name}  ${paint(
          m.until === undefined ? "forever" : `until ${clock.localDate(m.until)}`,
          "faint",
        )}`,
    ),
    "",
    keyHint([
      ["1-9", "unmute"],
      ["esc", "back"],
    ]),
  ]);
  const key = await readKey();
  const target = mutes[Number(key) - 1];
  if (target) await confirmSaved(await api.settings({ unmute: target.key }));
}

async function areasScreen(summary: Summary): Promise<void> {
  const scoped = await scopeScreen(draftOf(summary));
  if (!scoped.ok) return;
  const gated = await gateScreen(scoped.value);
  if (!gated.ok) return;
  const { prefer, topics, strict } = gated.value;
  await confirmSaved(await api.settings({ prefer, topics, strict }));
}

async function rateScreen(summary: Summary): Promise<void> {
  const picked = await pickOne<Intensity | "quiet">({
    choices: [
      ...CADENCES.map((c) => ({ value: c.value, label: c.name, hint: c.says })),
      {
        value: "quiet",
        label: "pause for two hours",
        hint: "The rate stays; nothing arrives until then.",
      },
    ],
    current: draftOf(summary).intensity,
    heading: "How often should a rep arrive?",
    intro:
      "A rep waits for a finished task, never for a keystroke. The gap is the most it will ever ask.",
    ...(summary.isPro
      ? {}
      : { note: "Regular and intense are Pro; picking one is stored and arrives with the seat." }),
  });
  if (!picked.ok) return;
  if (picked.value === "quiet") {
    const result = await api.settings({ muteMinutes: QUICK_MUTE_MINUTES });
    if (result.ok) updateConfig({ nextEligibleAt: clock.now() + QUICK_MUTE_MS });
    await confirmSaved(result, "sleeping");
    return;
  }
  await confirmSaved(await api.settings({ intensity: picked.value }), "idle");
}

async function depthScreen(summary: Summary): Promise<void> {
  const picked = await levelsScreen(draftOf(summary));
  if (!picked.ok) return;
  await confirmSaved(await api.settings({ levels: picked.value.levels }));
}

function manualLines(): string[] {
  return [
    "Server entry, for any MCP client:",
    ...JSON.stringify(cursorConfig(), null, 2)
      .split("\n")
      .map((line) => `  ${line}`),
    "",
    `Claude Code:  ${claudeAddCommand()}`,
    `Codex:        ${codexAddCommand()}`,
    `Cursor:       ${cursorMcpPath()}`,
    `Windsurf:     ${windsurfMcpPath()}`,
    "",
    `Anything else: ${siteOrigin()}/mcp with a token from ${siteOrigin()}/account.`,
  ];
}

function connectSummary(picked: ReadonlySet<string>): {
  text: string;
  ready: boolean;
  focus?: string;
} {
  if (picked.size === 0) {
    return {
      text: "Pick the ones you want, or this row to do it yourself.",
      ready: false,
      focus: "manual",
    };
  }
  const writes = [...picked].filter((id) => id !== "manual").length;
  if (writes === 0)
    return { text: "Nothing will be written; the config is printed below.", ready: true };
  const rows = writes === 1 ? "1 row" : `${writes} rows`;
  return { text: `${rows} on enter; the config is printed for anything else.`, ready: true };
}

export async function connect(interactive = isInteractive()): Promise<void> {
  if (!interactive) {
    plain([title("Connect your coding agent."), "", ...manualLines()]);
    return;
  }
  const offers = connectOffers();
  const picked = await pickMany({
    items: offers.map(({ target, found }) => ({
      id: target.id,
      label: target.label,
      hint: target.hint,
      detail:
        found || target.id === "manual"
          ? target.detail
          : `Not on this machine yet. ${target.detail}`,
      status: target.id === "manual" ? "" : found ? "found" : "not here",
      known: found,
    })),
    heading: "Connect your coding agent.",
    intro:
      "Nothing on this screen has happened yet. Enter does exactly the rows you tick, and nothing else on this machine changes.",
    confirm: "wire these up",
    pose: "idle",
    summary: connectSummary,
  });
  if (!picked.ok) return;
  const chosen = offers.filter(({ target }) => picked.value.has(target.id));
  if (chosen.length === 0) {
    out([
      ...withLoop("idle", [
        title("Nothing wired up."),
        "",
        "Run npx atomicreps connect whenever you want to.",
      ]),
      "",
      ...manualLines().map((line) => paint(line, "faint")),
    ]);
    await pause();
    return;
  }
  const done = chosen.map((offer) => ({ target: offer.target, ...offer.apply() }));
  const worst = done.some((entry) => entry.state === "failed")
    ? "failed"
    : done.some((entry) => entry.state === "noted")
      ? "noted"
      : "done";
  const row = (entry: (typeof done)[number]): string => {
    const glyph =
      entry.state === "done"
        ? paint("\u2713", "green")
        : entry.state === "noted"
          ? paint("\u00b7", "gold")
          : paint("\u00d7", "red");
    return `${glyph} ${entry.target.label}: ${entry.says}`;
  };
  out([
    ...withLoop(worst === "failed" ? "thinking" : worst === "noted" ? "idle" : "celebrating", [
      title(
        worst === "failed"
          ? "Some of it went through."
          : worst === "noted"
            ? "Done, with one to finish by hand."
            : "Wired up.",
      ),
      "",
      ...done.slice(0, 3).map(row),
    ]),
    ...done.slice(3).map(row),
    ...(picked.value.has("manual")
      ? ["", ...manualLines().map((line) => paint(line, "faint"))]
      : []),
  ]);
  await pause();
}

function claudePluginLine(): string {
  const registry = readJsonFile<{ plugins?: Record<string, unknown> }>(
    join(dirname(claudeSettingsPath()), "plugins", "installed_plugins.json"),
  );
  const names = Object.keys(registry?.plugins ?? {}).filter((name) =>
    name.startsWith("atomicreps"),
  );
  return names.length > 0
    ? `claude plugin: ${names.join(", ")}`
    : "claude plugin: not installed (the Stop hook that sends an automatic rep after a turn comes with it)";
}

export async function doctor(): Promise<number> {
  const config = readConfig();
  const pending = pendingRep();
  const lines: string[] = [
    `atomicreps: ${SERVER_VERSION} on node ${process.version}`,
    `channel: ${channelOf()}${channelFollowedSignIn() ? " (followed the sign-in; no --alpha given)" : ""}`,
    `api: ${apiOrigin()}`,
    `config: ${configPath()}`,
  ];
  for (const { name, value } of rejectedOverrides()) {
    lines.push(
      `${name} ignored: ${value} is not an Atomic Reps origin. Set ${ENV.unsafeOrigin}=1 for local development.`,
    );
  }
  let failures = 0;
  if (!config.token) {
    lines.push("token: none. Run npx atomicreps to sign in.");
    failures += 1;
  } else {
    lines.push(
      `token: ${config.tokenPrefix ?? config.token.slice(0, TOKEN_PREFIX_CHARS)}… connected ${config.connectedAt ? clock.iso(config.connectedAt) : "unknown"}`,
    );
    const ping = await api.me("summary", LOGIN_DEADLINE_MS);
    if (ping.ok) {
      lines.push(`server: ok in ${ping.ms}ms`);
      const latest = ping.value.client?.release?.version;
      if (typeof latest === "string" && isBehind(SERVER_VERSION, latest)) {
        lines.push(`latest: ${latest} (npx picks it up on the next launch; restart your editor)`);
      }
      const grammar = await ensureGrammar(clock.now(), str(ping.value.data?.grammarVersion));
      lines.push(
        grammar
          ? `grammar: ${grammar.version} (${grammar.words.length} phrases, ${grammar.paths.length} paths)`
          : "grammar: none cached",
      );
    } else {
      lines.push(
        `server: ${ping.reason}${ping.detail ? ` (${ping.detail})` : ""} after ${ping.ms}ms`,
      );
      failures += 1;
    }
  }
  lines.push(
    config.nextEligibleAt && config.nextEligibleAt > clock.now()
      ? `next rep after: ${clock.iso(config.nextEligibleAt)}`
      : "next rep: now (eligible)",
  );
  lines.push(
    pending
      ? `pending rep: ${pending.handle ?? pending.topicSlug} served ${clock.iso(pending.servedAt)} (a letter answers it; no push until it is answered or expires)`
      : "pending rep: none",
  );
  lines.push(
    config.lastFailure
      ? `last failure: ${config.lastFailure} at ${config.lastFailureAt ? clock.iso(config.lastFailureAt) : "?"}`
      : "last failure: none",
  );
  lines.push(
    config.lastQuiet
      ? `last no rep: ${config.lastQuiet} at ${config.lastQuietAt ? clock.iso(config.lastQuietAt) : "?"}`
      : "last no rep: none",
  );
  const missing = allowlistMissing();
  lines.push(
    missing.length === 0
      ? "claude allowlist: complete"
      : `claude allowlist: missing ${missing.join(", ")} (run npx atomicreps connect)`,
  );
  lines.push(claudePluginLine());
  lines.push(claudeAvailable() ? "claude cli: found" : "claude cli: not found");
  plain(lines);
  return failures === 0 ? 0 : 1;
}

type MenuItem = {
  readonly key: string;
  readonly label: string;
  readonly run: (summary: Summary) => Promise<void>;
};

const MENU = [
  { key: "enter", label: "one rep now", run: () => repScreen() },
  { key: "t", label: "this session", run: () => sessionScreen() },
  { key: "s", label: "skills", run: () => skillsScreen() },
  { key: "m", label: "mutes", run: () => mutesScreen() },
  { key: "p", label: "areas", run: (summary) => areasScreen(summary) },
  { key: "i", label: "rate", run: (summary) => rateScreen(summary) },
  { key: "l", label: "depth", run: (summary) => depthScreen(summary) },
  { key: "c", label: "connect an editor", run: () => connect(true) },
  {
    key: "d",
    label: "doctor",
    run: async () => {
      process.stdout.write(CLEAR);
      await doctor();
      await pause();
    },
  },
  {
    key: "w",
    label: "set up again",
    run: async () => {
      await install();
    },
  },
] as const satisfies readonly MenuItem[];

function menuItem(key: string): MenuItem | undefined {
  const pressed = isEnter(key) ? "enter" : key;
  return MENU.find((item) => item.key === pressed);
}

type Group = { readonly title: string; readonly keys: readonly string[] };
const GROUPS: readonly Group[] = [
  { title: "YOUR REPS", keys: ["t", "s"] },
  { title: "HOW OFTEN", keys: ["i", "p", "l", "m"] },
  { title: "SETUP", keys: ["c", "d", "w"] },
];

function noteFor(key: string, s: Summary): string {
  switch (key) {
    case "t":
      return "what you were asked since you opened the editor";
    case "s":
      return "where you are strong, where you are not";
    case "i":
      return `now: ${s.intensity}, ${s.gapMinutes} min apart`;
    case "p":
      return s.prefer.length > 0 ? `now: ${s.prefer.length} areas` : "now: the whole catalog";
    case "l":
      return "how hard the questions get";
    case "m":
      return s.muteCount === 0 ? "none" : `${s.muteCount} muted`;
    case "c":
      return "Claude Code, Cursor, Codex, Windsurf";
    case "d":
      return "check the connection";
    case "w":
      return "the wizard, from the top";
    default:
      return "";
  }
}

async function moreScreen(summary: Summary): Promise<string | null> {
  const lines: string[] = [
    ...withLoop("idle", [title("Everything else."), "", "One key, then you are back here."]),
    "",
  ];
  for (const group of GROUPS) {
    lines.push(paint(group.title, "faint"));
    for (const key of group.keys) {
      const item = MENU.find((m) => m.key === key);
      if (!item) continue;
      lines.push(
        `  ${padTo(paint(key, "coral", "bold"), 5)}${padTo(paint(item.label, "ink"), 20)}${paint(noteFor(key, summary), "faint")}`,
      );
    }
    lines.push("");
  }
  lines.push(
    `  ${padTo(paint("o", "coral", "bold"), 5)}${padTo(paint("sign out", "ink"), 20)}`,
    "",
    rule(),
    keyHint([["esc", "back"]]),
  );
  out(lines);
  const key = await readKey();
  return isBack(key) ? null : key;
}

export async function home(): Promise<void> {
  using _cursor = hiddenCursor();
  if (!readConfig().token) {
    out(
      withLoop("idle", [
        title("Atomic Reps, in your terminal."),
        "One short question about the thing you just built.",
        "",
        keyHint([
          ["enter", "sign in"],
          ["q", "quit"],
        ]),
      ]),
    );
    const key = await readKey();
    if (isBack(key)) return;
    const ok = await login();
    if (!ok) return;
  }
  for (;;) {
    const summary = await fetchSummary();
    if (!summary) {
      out(
        withLoop("facepalm", [
          title("Could not reach the server."),
          "Check your connection, or run: npx atomicreps doctor",
          "",
          keyHint([
            ["r", "retry"],
            ["q", "quit"],
          ]),
        ]),
      );
      const key = await readKey();
      if (key === "r") continue;
      return;
    }
    out([
      ...beside(
        loopRows(summary.answeredToday > 0 ? "impressed" : "idle", "home"),
        summaryLines(summary),
        ART_GUTTER_WIDE,
      ),
      "",
      rule(),
      keyHint([
        ["enter", "one rep now"],
        ["?", "more"],
        ["q", "quit"],
      ]),
      ...(summary.isPro || !summary.upgradeUrl
        ? []
        : [
            "",
            paint(
              `Pro asks the hard ones, on the stack you actually run. ${summary.upgradeUrl}`,
              "faint",
            ),
          ]),
    ]);
    let key = await readKey();
    if (key === "?") {
      const picked = await moreScreen(summary);
      if (picked === null) continue;
      key = picked;
    }
    if (isBack(key)) return;
    if (key === "o") {
      writeConfig({});
      out(withLoop("sleeping", [title("Signed out."), "Run npx atomicreps to sign in again."]));
      return;
    }
    await menuItem(key)?.run(summary);
  }
}
