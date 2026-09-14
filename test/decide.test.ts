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

function stopped(last = "Done: the form validates on blur."): HookInput {
  return { hook_event_name: "Stop", last_assistant_message: last, cwd: "/repo" };
}

const CASES: ReadonlyArray<
  [name: string, input: HookInput, state: HookState, expected: HookAction]
> = [
  [
    "a foreign event gets nothing at all, token and pending rep and all",
    { hook_event_name: "SessionStart", prompt: "B" },
    given({ pending: served() }),
    { kind: "ignore" },
  ],
  [
    "an event name the host left out is a prompt, the older contract",
    { prompt: "done with the form", cwd: "/repo" },
    given(),
    { kind: "quiet" },
  ],
  [
    "a pull through the door's own prompt gets nothing from the hook, not even the quiet line",
    typed("/mcp__atomicreps-alpha__rep react"),
    given(),
    { kind: "ignore" },
  ],
  [
    "the plugin's own rep skill, the same",
    typed("/atomicreps:rep useEffect"),
    given({ pending: served() }),
    { kind: "ignore" },
  ],
  [
    "another server's prompt is an ordinary prompt",
    typed("/mcp__github__issue 12"),
    given(),
    { kind: "quiet" },
  ],
  [
    "a Stop never grades, even one whose last message is a letter",
    stopped("B"),
    given({ pending: served() }),
    { kind: "ignore" },
  ],
  [
    "a Stop with no token is nothing, never the quiet line",
    stopped(),
    given({ hasToken: false }),
    { kind: "ignore" },
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
    { kind: "quiet" },
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
    "a running clock is nothing",
    stopped(),
    given({ nextEligibleAt: NOW + 60_000 }),
    { kind: "ignore" },
  ],
  [
    "a clock that has just run out is a push",
    stopped(),
    given({ nextEligibleAt: NOW - 1 }),
    { kind: "push", cwd: "/repo" },
  ],
  [
    "an unanswered rep is nothing even with the clock spent",
    stopped(),
    given({ pending: served() }),
    { kind: "ignore" },
  ],
  [
    "a turn that ended on a question is nothing: the person is about to answer it",
    stopped("Shall I apply the same to the other routes?"),
    given(),
    { kind: "ignore" },
  ],
  [
    "a question mid-message does not hold the rep back",
    stopped("Why? Because the index was missing. Fixed and tested."),
    given(),
    { kind: "push", cwd: "/repo" },
  ],
  [
    "a finished turn with nothing in the way is a push, in the host's directory",
    stopped(),
    given(),
    { kind: "push", cwd: "/repo" },
  ],
  [
    "an ordinary prompt with nothing in the way is the quiet line, never a push",
    typed("done with the form"),
    given(),
    { kind: "quiet" },
  ],
];

describe("what an event becomes", () => {
  for (const [name, input, state, expected] of CASES) {
    it(name, () => {
      expect(decide(input, state, NOW)).toEqual(expected);
    });
  }
});
