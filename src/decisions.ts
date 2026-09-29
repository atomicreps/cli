import { appendFileSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { loadClassifier, strongestFile } from "./classify.js";
import type { EpochMs } from "./clock.js";
import { configPath } from "./config.js";
import { FILE_MODE } from "./constants.js";
import { ensureDir } from "./files.js";
import type { Session } from "./infer.js";
import { notePushed } from "./store.js";
import type { TouchedEntry } from "./types.js";

const KEPT = 200;
const FILE = "decisions.log";

export type Outcome =
  | "shown"
  | "ended-on-question"
  | "gap"
  | "background-work"
  | "tree-unchanged"
  | "all-muted"
  | "server-quiet"
  | "server-unreachable";

export type Decision = {
  readonly at: EpochMs;
  readonly via: "hook" | "tool";
  readonly outcome: Outcome;
  readonly project?: string;
  readonly top?: readonly TouchedEntry[];
  readonly served?: string;
  readonly because?: string;
};

function logPath(): string {
  return join(dirname(configPath()), FILE);
}

export function noteDecision(decision: Decision): void {
  try {
    const path = logPath();
    ensureDir(dirname(path));
    const entry =
      decision.top === undefined ? decision : { ...decision, top: decision.top.slice(0, 3) };
    appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: FILE_MODE });
    chmodSync(path, FILE_MODE);
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    if (lines.length > KEPT * 2) writeFileSync(path, `${lines.slice(-KEPT).join("\n")}\n`);
  } catch {
  }
}

export function recentDecisions(count = 10): Decision[] {
  try {
    return readFileSync(logPath(), "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-count)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Decision];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

export function noteShown(shown: {
  readonly via: Decision["via"];
  readonly project: string;
  readonly session: Session | undefined;
  readonly handle: string | undefined;
  readonly now: EpochMs;
}): string | null {
  const { via, project, session, handle, now } = shown;
  if (session !== undefined) {
    notePushed(project, {
      ...(session.mark === null ? {} : { mark: session.mark }),
      snapshot: session.snapshot,
    });
  }
  const classifier = session === undefined || handle === undefined ? null : loadClassifier();
  const because =
    classifier === null || session === undefined || handle === undefined
      ? null
      : strongestFile(classifier, session.files, handle);
  noteDecision({
    at: now,
    via,
    outcome: "shown",
    project,
    ...(session === undefined ? {} : { top: session.hints.touched }),
    ...(handle === undefined ? {} : { served: handle }),
    ...(because === null ? {} : { because }),
  });
  return because;
}

const SAYS: Readonly<Record<Outcome, string>> = {
  shown: "asked",
  "ended-on-question": "stayed quiet: the agent ended by asking you something",
  gap: "stayed quiet: the gap since the last question was still running",
  "background-work": "stayed quiet: background work the agent started was still running",
  "tree-unchanged": "stayed quiet: no file changed since the last question",
  "all-muted": "stayed quiet: everything the turn touched is muted",
  "server-quiet": "stayed quiet: the server had nothing to send (daily cap, off, or no question)",
  "server-unreachable": "stayed quiet: the server did not answer in time",
};

export function describeDecision(decision: Decision): string {
  const when = new Date(decision.at).toISOString().replace("T", " ").slice(0, 19);
  const where = decision.project === undefined ? "" : ` in ${decision.project}`;
  const what = decision.served === undefined ? "" : ` about ${decision.served}`;
  const because = decision.because === undefined ? "" : `, because of ${decision.because}`;
  const top =
    decision.top === undefined || decision.top.length === 0
      ? ""
      : `\n    candidates: ${decision.top.map((e) => `${e.key} ${String(e.weight)}`).join(", ")}`;
  return `${when} ${decision.via}${where}: ${SAYS[decision.outcome]}${what}${because}${top}`;
}
