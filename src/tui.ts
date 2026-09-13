import { paint, wrap } from "./ansi.js";
import * as api from "./api.js";
import * as clock from "./clock.js";
import {
  apiOrigin,
  channelOf,
  clientLabel,
  hostLabel,
  readConfig,
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
  LOGIN_DEADLINE_MS,
  QUICK_MUTE_MINUTES,
  QUICK_MUTE_MS,
  TOGGLE_KEYS,
  TOKEN_PREFIX_CHARS,
  TOUCHED_SHOWN,
  TUI_INFER_BUDGET_MS,
} from "./constants.js";
import { plainBlock } from "./format.js";
import { inferHints } from "./infer.js";
import { CADENCES } from "./install.js";
import { pickMany } from "./pick.js";
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
import { domainCatalog, ensureGrammar, observeRep, observeVerdict, offerOf } from "./store.js";
import {
  asPick,
  type ApiResult,
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
  cap: number;
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
    `Today: ${paint(String(s.answeredToday), "bold")} answered of ${s.cap}, ${s.askedToday} asked of ${s.askedCap}. This week ${s.weekReps}.`,
    `Streak: ${paint(String(s.currentStreak), "bold")} day${s.currentStreak === 1 ? "" : "s"} (best ${s.longestStreak}).`,
    `Intensity: ${paint(s.intensity, "bold")} (${s.gapMinutes} min between reps)${muted ? paint("  muted", "faint") : ""}`,
    `Prefers: ${s.prefer.length > 0 ? s.prefer.join(", ") : "the whole catalog"}${s.muteCount > 0 ? paint(`  · ${s.muteCount} mute${s.muteCount === 1 ? "" : "s"}`, "faint") : ""}`,
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
  const body = plainBlock(served.text).flatMap((line) => wrap(line, TEXT_WIDTH));
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
  const lines = plainBlock(answered.text)
    .filter((line) => !line.startsWith("Also touched:"))
    .flatMap((line) => wrap(line, TEXT_WIDTH));
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
  const lines = plainBlock(skills.text).flatMap((line) => wrap(line, TEXT_WIDTH));
  out([...withLoop("impressed", [title(lines[0] ?? "Skills"), ""]), ...lines.slice(1)]);
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

const PREFER_KEYS = TOGGLE_KEYS.slice(0, 13);

async function preferScreen(current: string[]): Promise<void> {
  const domains = (await domainCatalog()).slice(0, PREFER_KEYS.length);
  if (domains.length === 0) {
    out(withLoop("facepalm", [title("Could not load the domains."), "Try again in a moment."]));
    await pause();
    return;
  }
  const chosen = new Set(current);
  for (;;) {
    out([
      ...withLoop("idle", [
        title("What the pushed rep prefers."),
        "The rep follows what you touched; among that, these domains come first.",
        "",
      ]),
      ...domains.map(
        (d, i) =>
          `${paint(PREFER_KEYS[i] ?? "", "coral", "bold")} ${chosen.has(d.slug) ? paint("●", "gold") : paint("·", "faint")} ${d.name}`,
      ),
      "",
      keyHint([
        ["a-m", "toggle"],
        ["enter", "save"],
        ["esc", "back"],
      ]),
    ]);
    const key = await readKey();
    if (isBack(key)) return;
    if (isEnter(key)) break;
    const index = PREFER_KEYS.indexOf(key.toLowerCase());
    const domain = domains[index];
    if (!domain) continue;
    if (chosen.has(domain.slug)) chosen.delete(domain.slug);
    else chosen.add(domain.slug);
  }
  const saved = await api.settings({ prefer: [...chosen] });
  out(
    withLoop("impressed", [
      title(saved.ok ? saved.value.text : `Could not save (${saved.reason}).`),
    ]),
  );
  await pause();
}

async function settingsScreen(status: Summary): Promise<void> {
  out(
    withLoop("idle", [
      title("Intensity."),
      `${paint("0", "coral", "bold")} off   ${paint("1", "coral", "bold")} light   ${paint("2", "coral", "bold")} regular${status.isPro ? "" : paint(" (Pro)", "faint")}   ${paint("3", "coral", "bold")} intense${status.isPro ? "" : paint(" (Pro)", "faint")}`,
      `${paint("m", "coral", "bold")} mute for two hours   ${paint("esc", "coral", "bold")} back`,
      "",
      paint(`Now: ${status.intensity}`, "faint"),
    ]),
  );
  const key = await readKey();
  const picked = CADENCES.find((c) => c.key === key);
  if (picked) await confirmSaved(await api.settings({ intensity: picked.value }), "idle");
  else if (key === "m") {
    const result = await api.settings({ muteMinutes: QUICK_MUTE_MINUTES });
    if (result.ok) updateConfig({ nextEligibleAt: clock.now() + QUICK_MUTE_MS });
    await confirmSaved(result, "sleeping");
  }
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
  { key: "p", label: "prefer", run: (summary) => preferScreen(summary.prefer) },
  { key: "i", label: "intensity", run: (summary) => settingsScreen(summary) },
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
