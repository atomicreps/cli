import { describe, expect, it } from "vitest";

import { REMIND_LIMIT } from "../src/constants.js";
import { decide, type HookAction, type HookState } from "../src/hook.js";
import type { HeldBlock, HookInput, OfferEntry, StoredRep } from "../src/types.js";

const NOW = 1_700_000_000_000;

const OFFER: readonly OfferEntry[] = [
  { handle: "css.grid", name: "CSS · Grid" },
  { handle: "docker.buildx", name: "Docker · Buildx" },
];

function served(id = "q1"): StoredRep {
  return { id, topicSlug: "react", text: "a block", servedAt: NOW - 10_000 };
}

function reprinted(shown: number): StoredRep {
  return { ...served(), shown };
}

function given(patch: Partial<HookState> = {}): HookState {
  return {
    hasToken: true,
    unattended: false,
    busy: false,
    held: undefined,
    nextEligibleAt: undefined,
    pending: undefined,
    armed: undefined,
    offer: [],
    ...patch,
  };
}

const VERDICT: HeldBlock = { text: "a verdict", at: NOW - 5_000 };

function onScreen(patch: Partial<HookState> = {}): HookState {
  return given({ pending: served(), armed: "q1", ...patch });
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
    "an event name the editor left out is a prompt, the older contract",
    { prompt: "done with the form", cwd: "/repo" },
    given(),
    { kind: "ignore" },
  ],
  [
    "a pull through the server's own prompt gets nothing from the hook",
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
    { kind: "ignore" },
  ],
  [
    "a Stop never grades, even one whose last message is a letter",
    stopped("B"),
    given({ pending: served() }),
    { kind: "remind", rep: served(), cwd: "/repo" },
  ],
  ["a Stop with no token is nothing", stopped(), given({ hasToken: false }), { kind: "ignore" }],
  [
    "no token is nothing, whatever the prompt looks like",
    typed("B"),
    given({ hasToken: false, pending: served(), armed: "q1" }),
    { kind: "ignore" },
  ],
  [
    "a letter right after the rep was printed grades that rep",
    typed("b)"),
    onScreen(),
    { kind: "grade", id: "q1", pick: "B", withMessage: false },
  ],
  [
    "a letter with a full stop is still the letter",
    typed("a."),
    onScreen(),
    { kind: "grade", id: "q1", pick: "A", withMessage: false },
  ],
  [
    "a letter with ! is that letter, and the user saying they were sure",
    typed("A!"),
    onScreen(),
    { kind: "grade", id: "q1", pick: "A", sure: true, withMessage: false },
  ],
  [
    "a letter with ? is that letter, and the user saying they were not",
    typed("b?"),
    onScreen(),
    { kind: "grade", id: "q1", pick: "B", sure: false, withMessage: false },
  ],
  [
    "no suffix says nothing about how sure they were, which is not the same as unsure",
    typed("A"),
    onScreen(),
    { kind: "grade", id: "q1", pick: "A", withMessage: false },
  ],
  [
    "a letter alone on the first line answers the rep, and the rest is a message for the agent",
    typed("A!\nAlso, rename the route to /reports."),
    onScreen(),
    { kind: "grade", id: "q1", pick: "A", sure: true, withMessage: true },
  ],
  [
    "a list of letters one per line is still prose, first line and all",
    typed("A\nB\nC"),
    onScreen(),
    { kind: "ignore" },
  ],
  [
    "a first-line letter with no rep on screen is the user talking to the agent",
    typed("A\nthe first option, please"),
    given({ pending: served() }),
    { kind: "ignore" },
  ],
  [
    "a digit while a verdict waits to be printed takes nothing: the offer is not on screen yet",
    typed("1"),
    given({ offer: OFFER, held: VERDICT }),
    { kind: "ignore" },
  ],
  [
    "a session nobody reads grades nothing, however bare the letter",
    typed("A"),
    onScreen({ unattended: true }),
    { kind: "ignore" },
  ],
  [
    "a short sentence that starts with a letter is a sentence",
    typed("a quick fix please"),
    onScreen(),
    { kind: "ignore" },
  ],
  [
    "a letter with a reason after it is a message for the agent",
    typed("B because it re-renders"),
    onScreen(),
    { kind: "ignore" },
  ],
  [
    "a pending rep the conversation has moved past is not graded, however bare the letter",
    typed("A"),
    given({ pending: served() }),
    { kind: "ignore" },
  ],
  [
    "a letter armed for another rep does not grade this one",
    typed("A"),
    given({ pending: served(), armed: "q0" }),
    { kind: "ignore" },
  ],
  [
    "a doubled suffix is not the footer's ask and grades nothing",
    typed("A!!"),
    onScreen(),
    { kind: "ignore" },
  ],
  [
    "a word that begins with a letter is still a word",
    typed("Absolutely"),
    onScreen(),
    { kind: "ignore" },
  ],
  [
    "a letter with nothing pending falls through to the clock",
    typed("B"),
    given({ nextEligibleAt: NOW + 60_000 }),
    { kind: "ignore" },
  ],
  [
    "a letter with nothing pending and the clock spent is an ordinary prompt",
    typed("B"),
    given(),
    { kind: "ignore" },
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
    { kind: "ignore" },
  ],
  [
    "a digit past the end of the offer falls through to the clock",
    typed("3"),
    given({ offer: OFFER, nextEligibleAt: NOW + 60_000 }),
    { kind: "ignore" },
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
    "an unanswered rep is said again rather than silencing the turn",
    stopped(),
    given({ pending: served() }),
    { kind: "remind", rep: served(), cwd: "/repo" },
  ],
  [
    "a rep is still reminded halfway through its slots",
    stopped(),
    given({ pending: reprinted(REMIND_LIMIT - 1) }),
    { kind: "remind", rep: reprinted(REMIND_LIMIT - 1), cwd: "/repo" },
  ],
  [
    "a rep that has spent every slot gives way to a fresh one, which the next letter grades",
    stopped(),
    given({ pending: reprinted(REMIND_LIMIT) }),
    { kind: "push", cwd: "/repo" },
  ],
  [
    "a reminder waits on the quiet clock like everything else",
    stopped(),
    given({ pending: served(), nextEligibleAt: NOW + 60_000 }),
    { kind: "ignore" },
  ],
  [
    "a reminder is not a grade: a Stop with no token still gets nothing",
    stopped(),
    given({ hasToken: false, pending: served() }),
    { kind: "ignore" },
  ],
  [
    "a turn that ended on a question is nothing: the user is about to answer it",
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
    "a subagent or a headless run is never pushed a rep",
    stopped(),
    given({ unattended: true }),
    { kind: "ignore" },
  ],
  [
    "background work still running holds the push back: the turn is the inside of the work",
    stopped(),
    given({ busy: true }),
    { kind: "ignore" },
  ],
  [
    "background work still running holds a reminder back too",
    stopped(),
    given({ busy: true, pending: served() }),
    { kind: "ignore" },
  ],
  [
    "a held verdict prints at the next Stop, before the clock, the question and the background work",
    stopped("Shall I apply the same to the other routes?"),
    given({ held: VERDICT, busy: true, nextEligibleAt: NOW + 60_000, pending: served() }),
    { kind: "show", held: VERDICT },
  ],
  [
    "a held verdict is not printed into a session nobody reads",
    stopped(),
    given({ held: VERDICT, unattended: true }),
    { kind: "ignore" },
  ],
  [
    "a finished turn with nothing in the way is a push, in the editor's directory",
    stopped(),
    given(),
    { kind: "push", cwd: "/repo" },
  ],
  [
    "an ordinary prompt with nothing in the way is nothing, never a push",
    typed("done with the form"),
    given(),
    { kind: "ignore" },
  ],
];

describe("what an event becomes", () => {
  for (const [name, input, state, expected] of CASES) {
    it(name, () => {
      expect(decide(input, state, NOW)).toEqual(expected);
    });
  }
});
