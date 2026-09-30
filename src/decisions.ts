import { appendFileSync, readFileSync } from "node:fs";

import { loadClassifier, strongestFile } from "./classify.js";
import type { EpochMs } from "./clock.js";
import { decisionsLogPath, ensureConfigDir } from "./config.js";
import { FILE_MODE } from "./constants.js";
import { writeFileAtomic } from "./files.js";
import type { Session } from "./infer.js";
import { notePushed } from "./store.js";
import type { TouchedEntry } from "./types.js";

const KEPT = 200;

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
  readonly via: "hook" | "tool" | "editor";
  readonly outcome: Outcome;
  readonly project?: string;
  readonly top?: readonly TouchedEntry[];
  readonly named?: readonly NamedPhrase[];
  readonly unmatched?: number;
  readonly served?: string;
  readonly because?: string;
};

export type NamedPhrase = { readonly match: string; readonly key: string; readonly weight: number };

export type Sent = {
  readonly touched: readonly TouchedEntry[];
  readonly named: readonly NamedPhrase[];
  readonly unmatched: number;
};

export function noteDecision(decision: Decision): void {
  try {
    ensureConfigDir();
    const path = decisionsLogPath();
    const entry =
      decision.top === undefined ? decision : { ...decision, top: decision.top.slice(0, 3) };
    appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: FILE_MODE });
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    if (lines.length > KEPT * 2) {
      writeFileAtomic(path, `${lines.slice(-KEPT).join("\n")}\n`, FILE_MODE);
    }
  } catch {
  }
}

export function sentFields(
  sent: Sent | undefined,
  session: Session | undefined,
): Pick<Decision, "top" | "named" | "unmatched"> {
  if (sent !== undefined) {
    return {
      top: sent.touched.toSorted((a, b) => b.weight - a.weight),
      ...(sent.named.length === 0 ? {} : { named: sent.named }),
      ...(sent.unmatched === 0 ? {} : { unmatched: sent.unmatched }),
    };
  }
  return session === undefined ? {} : { top: session.hints.touched };
}

export function recentDecisions(count = 10): Decision[] {
  try {
    return readFileSync(decisionsLogPath(), "utf8")
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
  readonly sent?: Sent;
}): string | null {
  const { via, project, session, handle, now, sent } = shown;
  if (session !== undefined) {
    notePushed(project, {
      ...(session.mark === null ? {} : { mark: session.mark }),
      snapshot: session.snapshot,
    });
  }
  let because: string | null = null;
  if (session !== undefined && handle !== undefined) {
    const classifier = loadClassifier();
    if (classifier !== null) because = strongestFile(classifier, session.files, handle);
  }
  noteDecision({
    at: now,
    via,
    outcome: "shown",
    project,
    ...sentFields(sent, session),
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
  const named =
    decision.named === undefined && decision.unmatched === undefined
      ? ""
      : `\n    agent named: ${[
          ...(decision.named ?? []).map((n) => `${n.match} → ${n.key} ${String(n.weight)}`),
          ...(decision.unmatched === undefined
            ? []
            : [`${String(decision.unmatched)} matched no catalog word`]),
        ].join(", ")}`;
  return `${when} ${decision.via}${where}: ${SAYS[decision.outcome]}${what}${because}${top}${named}`;
}
