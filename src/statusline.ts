import { visibleWidth } from "./ansi.js";
import * as clock from "./clock.js";
import { readConfig } from "./config.js";
import { VERDICT_SHOWN_MS } from "./constants.js";
import { partsOfBlock, verdictLineOf } from "./format.js";
import { listReps, pendingRep, streakForStatus } from "./store.js";

const MARK = "⚛";
const DOT = " · ";
const DEFAULT_COLUMNS = 100;
const MIN_OPTION_WIDTH = 8;
const FULL_ROW_OPTION_WIDTH = 24;

function columnsOf(): number {
  const columns = Number.parseInt(process.env.COLUMNS ?? "", 10);
  return Number.isInteger(columns) && columns > 0 ? columns : DEFAULT_COLUMNS;
}

function cut(text: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(text) <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1)).trimEnd()}…`;
}

function clause(text: string): string {
  const first = /^[^,;:(]+/.exec(text)?.[0] ?? text;
  return first.replaceAll("`", "").trim();
}

function sharedOpening(texts: readonly string[]): number {
  const words = texts.map((t) => t.split(" "));
  let shared = 0;
  while (words.every((w) => w.length > shared + 1 && w[shared] === words[0]?.[shared])) shared += 1;
  return shared;
}

function optionRows(
  options: ReadonlyArray<{ letter: string; text: string }>,
  columns: number,
): string[] {
  const clauses = options.map((o) => clause(o.text));
  const skip = sharedOpening(clauses);
  const texts = clauses.map((c) => c.split(" ").slice(skip).join(" "));
  const indent = "  ";
  const widthFor = (perRow: number): number =>
    Math.floor((columns - indent.length - DOT.length * (perRow - 1) - perRow * 2) / perRow);
  const perRow = widthFor(options.length) >= FULL_ROW_OPTION_WIDTH ? options.length : 2;
  const each = Math.max(MIN_OPTION_WIDTH, widthFor(perRow));
  const cells = options.map((o, i) => `${o.letter} ${cut(texts[i] ?? "", each)}`);
  const rows: string[] = [];
  for (let at = 0; at < cells.length; at += perRow) {
    rows.push(indent + cells.slice(at, at + perRow).join(DOT));
  }
  return rows;
}

function dayParts(now: clock.EpochMs, nextEligibleAt: clock.EpochMs | undefined): string[] {
  const today = listReps().filter((r) => clock.sameLocalDay(r.servedAt, now)).length;
  const streak = streakForStatus(now);
  return [
    ...(nextEligibleAt !== undefined && nextEligibleAt > now
      ? [`next rep ${clock.hhmm(nextEligibleAt)}`]
      : []),
    ...(today > 0 ? [`${String(today)} today`] : []),
    ...(streak === null ? [] : [`streak ${String(streak)}`]),
  ];
}

function row(parts: readonly string[], columns: number): string {
  return parts.length === 0 ? "" : cut(`${MARK} ${parts.join(DOT)}`, columns);
}

export function statusLine(now = clock.now()): string {
  const config = readConfig();
  if (!config.token) return `${MARK} atomicreps: not signed in`;
  const columns = columnsOf();
  const pending = pendingRep(now);
  if (pending) {
    const { stem, options } = partsOfBlock(pending.text);
    const rows = [cut(`${MARK} ${stem ?? pending.handle ?? pending.topicSlug}`, columns)];
    rows.push(...optionRows(options, columns));
    return rows.join("\n");
  }
  const day = dayParts(now, config.nextEligibleAt);
  const last = listReps().at(-1);
  const verdict =
    last?.answeredAt !== undefined &&
    last.verdict !== undefined &&
    now - last.answeredAt <= VERDICT_SHOWN_MS
      ? [verdictLineOf(last.verdict)]
      : [];
  return row([...verdict, ...day], columns);
}
