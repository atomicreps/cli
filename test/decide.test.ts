import { describe, expect, it } from "vitest";

import { decide, type HookAction, type HookState } from "../src/hook.js";
import type { HookInput, OfferEntry, StoredRep } from "../src/types.js";

const NOW = 1_700_000_000_000;

const OFFER: readonly OfferEntry[] = [
  { handle: "css.grid", name: "CSS · Grid" },
  { handle: "docker.buildx", name: "Docker · Buildx" },
];

function served(id = "q1"): StoredRep {
  return { id, topicSlug: "react", text: "a block", servedAt: NOW - 10_000 };
}

function given(patch: Partial<HookState> = {}): HookState {
  return { hasToken: true, nextEligibleAt: undefined, pending: undefined, offer: [], ...patch };
}

function typed(text: string): HookInput {
  return { hook_event_name: "UserPromptSubmit", prompt: text, cwd: "/repo" };
}

const CASES: ReadonlyArray<
  [name: string, input: HookInput, state: HookState, expected: HookAction]
> = [
  [
    "a foreign event gets nothing at all, token and pending rep and all",
    { hook_event_name: "Stop", prompt: "B" },
    given({ pending: served() }),
    { kind: "ignore" },
  ],
  [
    "an event name the host left out is treated as ours",
    { prompt: "done with the form", cwd: "/repo" },
    given(),
    { kind: "push", cwd: "/repo" },
  ],
  [
    "no token is quiet, whatever the prompt looks like",
    typed("B"),
    given({ hasToken: false, pending: served() }),
    { kind: "quiet" },
  ],
  [
    "a letter with a rep pending grades that rep",
    typed("b) useRef"),
    given({ pending: served() }),
    { kind: "grade", id: "q1", pick: "B" },
  ],
  [
    "a letter with nothing pending falls through to the clock",
    typed("B"),
    given({ nextEligibleAt: NOW + 60_000 }),
    { kind: "quiet" },
  ],
  [
    "a letter with nothing pending and the clock spent is an ordinary prompt",
    typed("B"),
    given(),
    { kind: "push", cwd: "/repo" },
  ],
  [
    "a digit under an open offer takes that entry",
    typed("2"),
    given({ offer: OFFER }),
    { kind: "take", handle: "docker.buildx" },
  ],
  [
    "a digit while a rep is pending is not an offer digit",
    typed("2"),
    given({ pending: served(), offer: OFFER }),
    { kind: "quiet" },
  ],
  [
    "a digit past the end of the offer falls through to the clock",
    typed("3"),
    given({ offer: OFFER, nextEligibleAt: NOW + 60_000 }),
    { kind: "quiet" },
  ],
  [
    "a running clock is quiet",
    typed("ship the container"),
    given({ nextEligibleAt: NOW + 60_000 }),
    { kind: "quiet" },
  ],
  [
    "a clock that has just run out is not",
    typed("ship the container"),
    given({ nextEligibleAt: NOW - 1 }),
    { kind: "push", cwd: "/repo" },
  ],
  [
    "an unanswered rep is quiet even with the clock spent",
    typed("ship the container"),
    given({ pending: served() }),
    { kind: "quiet" },
  ],
  [
    "an ordinary prompt with nothing in the way is a push, in the host's directory",
    typed("done with the form"),
    given(),
    { kind: "push", cwd: "/repo" },
  ],
];

describe("what a prompt becomes", () => {
  for (const [name, input, state, expected] of CASES) {
    it(name, () => {
      expect(decide(input, state, NOW)).toEqual(expected);
    });
  }
});
