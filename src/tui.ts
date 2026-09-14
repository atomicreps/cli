import { paint, stripAnsi } from "./ansi.js";
import * as api from "./api.js";
import { paintBlock } from "./block.js";
import * as clock from "./clock.js";
import {
  apiOrigin,
  channelOf,
  clientLabel,
  hostLabel,
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
  codexAddCommand,
  cursorConfig,
  cursorMcpPath,
  windsurfMcpPath,
} from "./connect.js";
import {
  CLEAR,
  ENV,
  LOGIN_DEADLINE_MS,
  QUICK_MUTE_MINUTES,
  QUICK_MUTE_MS,
  TOKEN_PREFIX_CHARS,
  TOUCHED_SHOWN,
  TUI_INFER_BUDGET_MS,
} from "./constants.js";
import { inferHints } from "./infer.js";
import { CADENCES, draftOf, gateScreen, install, levelsScreen, scopeScreen } from "./install.js";
import { pickMany, pickOne } from "./pick.js";
import {
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
import { ensureGrammar, observeRep, observeVerdict, offerOf } from "./store.js";
import {
  asPick,
  type ApiResult,
  type Intensity,
  type LocalHints,
  type LoopPose,
  type OfferEntry,
  type Pick,
  type ToolReply,
} from "./types.js";

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
  name: string;
  isPro: boolean;
  intensity: string;
  cap: number | null;
  gapMinutes: number;
  answeredToday: number;
  askedToday: number;
  askedCap: number;
  weekReps: number;
  currentStreak: number;
  longestStreak: number;
  mutedUntil?: number;
  quietUntil?: number;
  nextEligibleAt: number;
  prefer: string[];
  muteCount: number;
  upgradeUrl: string | null;
  topics?: string[];
  strict?: boolean;
  levels?: { min: number; max: number };
};

async function fetchSummary(): Promise<Summary | null> {
  const result = await api.me("summary", LOGIN_DEADLINE_MS);
  if (!result.ok || !result.value.data) return null;
  return result.value.data as unknown as Summary;
}

function summaryLines(s: Summary): string[] {
  const plan = s.isPro ? paint("Pro", "gold", "bold") : paint("Free", "soft", "bold");
  const muted = s.mutedUntil && s.mutedUntil > clock.now();
  return [
    `${title(`Hey ${s.name}.`)}  ${plan}`,
    "",
    `Today: ${paint(String(s.answeredToday), "bold")} answered${s.cap === null ? "" : ` of ${s.cap}`}, ${s.askedToday} asked of ${s.askedCap}. This week ${s.weekReps}.`,
    `Streak: ${paint(String(s.currentStreak), "bold")} day${s.currentStreak === 1 ? "" : "s"} (best ${s.longestStreak}).`,
    `Rate: ${paint(s.intensity, "bold")} (${s.gapMinutes} min between reps)${muted ? paint("  muted", "faint") : ""}`,
    `Areas: ${s.prefer.length > 0 ? s.prefer.join(", ") : "the whole catalog"}${s.strict ? paint("  · only these", "faint") : ""}${s.muteCount > 0 ? paint(`  · ${s.muteCount} mute${s.muteCount === 1 ? "" : "s"}`, "faint") : ""}`,
  ];
}

type RepData = {
  kind: "question" | "insight" | "quiet";
  id?: string;
  reason?: string;
};

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
  const data = (served.data ?? {}) as RepData;
  observeRep(served.data ?? {}, served.text, now);
  if (data.kind !== "question" || !data.id) {
    const why =
      data.reason === "spent"
        ? "Today's asked reps are done."
        : data.reason === "off"
          ? "The door is off. Set an intensity to open it."
          : "Nothing to serve right now.";
    out(withLoop("sleeping", [title("Quiet."), why]));
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
  const answered = await fetched(await api.answer(data.id, pick), "Could not grade that.");
  if (!answered) return;
  const verdict = answered.data ?? {};
  observeVerdict(data.id, verdict, answered.text, now);
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

type MuteRow = { key: string; name: string; until?: number };

async function mutesScreen(): Promise<void> {
  const shown = await fetched(await api.me("mutes", LOGIN_DEADLINE_MS));
  if (!shown) return;
  const mutes = ((shown.data as { mutes?: MuteRow[] } | null)?.mutes ?? []).slice(0, 9);
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
        label: "quiet for two hours",
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

export async function doctor(): Promise<number> {
  const config = readConfig();
  const lines: string[] = [`channel: ${channelOf()}`, `door: ${apiOrigin()}`];
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
      const version = ping.value.data?.grammarVersion;
      const grammar = await ensureGrammar(
        clock.now(),
        typeof version === "string" ? version : undefined,
      );
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
      ? `quiet until: ${clock.iso(config.nextEligibleAt)}`
      : "quiet until: now (eligible)",
  );
  lines.push(
    config.lastFailure
      ? `last failure: ${config.lastFailure} at ${config.lastFailureAt ? clock.iso(config.lastFailureAt) : "?"}`
      : "last failure: none",
  );
  lines.push(
    config.lastQuiet
      ? `last quiet: ${config.lastQuiet} at ${config.lastQuietAt ? clock.iso(config.lastQuietAt) : "?"}`
      : "last quiet: none",
  );
  const missing = allowlistMissing();
  lines.push(
    missing.length === 0
      ? "claude allowlist: complete"
      : `claude allowlist: missing ${missing.join(", ")} (run npx atomicreps connect)`,
  );
  lines.push(claudeAvailable() ? "claude cli: found" : "claude cli: not found");
  plain(lines);
  return failures === 0 ? 0 : 1;
}

type MenuItem = { key: string; label: string; run: (summary: Summary) => Promise<void> };

const MENU: readonly MenuItem[] = [
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
];

function menuItem(key: string): MenuItem | undefined {
  const pressed = isEnter(key) ? "enter" : key;
  return MENU.find((item) => item.key === pressed);
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
      ...withLoop(summary.answeredToday > 0 ? "impressed" : "idle", summaryLines(summary)),
      "",
      rule(),
      keyHint(MENU.slice(0, 6).map((item) => [item.key, item.label])),
      keyHint([
        ...MENU.slice(6).map((item): [string, string] => [item.key, item.label]),
        ["o", "sign out"],
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
    const key = await readKey();
    if (isBack(key)) return;
    if (key === "o") {
      writeConfig({});
      out(withLoop("sleeping", [title("Signed out."), "Run npx atomicreps to sign in again."]));
      return;
    }
    await menuItem(key)?.run(summary);
  }
}
