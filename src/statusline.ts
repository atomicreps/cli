import * as clock from "./clock.js";
import { readConfig } from "./config.js";
import { pendingRep, streakForStatus } from "./store.js";

const FACE_READY = "(•‿•)";
const FACE_PENDING = "(•_•)?";
const FACE_QUIET = "(-_-)";

export function statusLine(now = clock.now()): string {
  const config = readConfig();
  if (!config.token) return `${FACE_QUIET} atomicreps: not signed in`;
  const streak = streakForStatus(now);
  const streakPart = streak === null ? "" : `  streak ${streak}`;
  const pending = pendingRep(now);
  if (pending) return `${FACE_PENDING} rep pending, answer with a letter${streakPart}`;
  if (config.nextEligibleAt !== undefined && config.nextEligibleAt > now) {
    return `${FACE_QUIET} next rep at ${clock.hhmm(config.nextEligibleAt)}${streakPart}`;
  }
  return `${FACE_READY} rep ready${streakPart}`;
}
