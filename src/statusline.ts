import { escapesRefused, visibleWidth } from "./ansi.js";
import * as clock from "./clock.js";
import { readConfig, siteOrigin } from "./config.js";
import { ESC } from "./constants.js";
import { topicOfBlock } from "./format.js";
import { pendingRep, streakForStatus } from "./store.js";

const FACE_READY = "(•‿•)";
const FACE_PENDING = "(•_•)?";
const FACE_QUIET = "(-_-)";

const DOT = " · ";
const GAP = "  ";
const BEL = "";

function hyperlink(url: string, text: string): string {
  return `${ESC}]8;;${url}${BEL}${text}${ESC}]8;;${BEL}`;
}

function columnsOf(): number | null {
  const columns = Number.parseInt(process.env.COLUMNS ?? "", 10);
  return Number.isInteger(columns) && columns > 0 ? columns : null;
}

function fit(segments: readonly string[], columns: number | null): string {
  const kept = [...segments];
  if (columns === null) return kept.join("");
  while (kept.length > 1 && visibleWidth(kept.join("")) > columns) kept.pop();
  return kept.join("");
}

export function statusLine(now = clock.now()): string {
  const config = readConfig();
  const columns = columnsOf();
  if (!config.token) return `${FACE_QUIET} atomicreps: not signed in`;
  const streak = streakForStatus(now);
  const streakPart = streak === null ? [] : [`${GAP}streak ${String(streak)}`];
  const pending = pendingRep(now);
  if (pending) {
    const topic = topicOfBlock(pending.text) ?? pending.handle ?? pending.topicSlug;
    const web = `${siteOrigin()}/r/${pending.id}`;
    return fit(
      [
        `${FACE_PENDING} rep open`,
        ...(topic === "" ? [] : [`${DOT}${topic}`]),
        ...(escapesRefused() ? [] : [`${GAP}${hyperlink(web, "answer on the web")}`]),
        `${DOT}reply A-D`,
        ...streakPart,
      ],
      columns,
    );
  }
  if (config.nextEligibleAt !== undefined && config.nextEligibleAt > now) {
    return fit(
      [`${FACE_QUIET} next rep at ${clock.hhmm(config.nextEligibleAt)}`, ...streakPart],
      columns,
    );
  }
  return fit([`${FACE_READY} rep ready`, ...streakPart], columns);
}
