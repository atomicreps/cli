# Changelog

## 0.0.10

- Loop's face is redrawn. Much bigger eyes, each with a catchlight in it rather than a flat dark slot, and a mouth about half the width it was. His cheeks show now. He has brows, so the face he pulls when you break something is a face and not a pair of dashes. Asleep, his eyes land on his head instead of hovering above it.

## 0.0.9

- Loop is drawn by the mascot himself now, in colour, instead of the box glyphs that stood in for him. A terminal without colour still gets a drawn Loop, redrawn so he reads as an animal rather than a box with a face.
- The home screen leads with one thing: do a rep. The other nine keys moved behind `?`, grouped and each saying what it is set to; they all still work from the home screen, so nothing you had learned has moved.
- Your day reads as figures rather than sentences: a week of streak dots, and a meter on the reps you have asked for against the day's ceiling.
- The list of areas no longer runs off the side of the screen. It is cut to the width it actually has.
- Every rep now carries a link to answer it in a browser. Answering with a letter wakes your agent for a whole turn, which is the expensive part of a rep; the link costs nothing but the click. It opens for you and nobody else, and it does not expire.

## 0.0.8

- `hook`, `mcp`, `statusline` and `doctor` now follow whichever channel you signed in with, when none is named; production wins if both are signed in. `login`, `connect` and `logout` still need an explicit channel; `doctor` says when it picked one automatically.

## 0.0.7

- The rep your agent prints after a turn is readable again. Every line now sets its own colour: question and answers in full contrast, letters and header in coral, code in its own tone, inline code in gold with the backticks removed.
- A light terminal now gets dark text instead of assuming a dark background.
- Code samples on the `npx atomicreps` screen keep their indentation; long answers wrap under their letter.
- A block too long for Claude Code to print in colour (over 10,000 characters) now prints in plain text instead.

## 0.0.6

- An automatic rep no longer re-asks something from another day's work; it only re-asks a topic inside what the current session touched. Asking for a rep with nothing named still serves whatever is pending.
- `npx atomicreps` can now run setup again: press `w` on the home screen.
- Areas, rate, and difficulty on the home screen now use the wizard's own pickers (arrows, space, enter, Esc), with the topic tree, search, and current values already set. The two-hour quiet option moved to the rate screen.
- The server's `me` summary now includes your pinned topics and difficulty range, so a picker opens showing what's already set.

## 0.0.5

- The areas you pick can now decide what arrives, not just break a tie. Setup now asks: "These first" (the old default) or "Only these" (no rep for a session spent outside your chosen areas).
- `npx atomicreps` now says when a quiet stretch was caused by this setting, and how many reps it skipped today.
- Say "only ask me about my areas" to turn this on, or "ask me about everything I touch" to turn it off.
- Picking no areas leaves the setting inactive, same as everywhere else in the catalog.

## 0.0.4

- The words your agent writes in `touched` no longer leave your machine; only the matching catalog handle is sent.
- Package names, file extensions, and folder names are sent only when the public catalog already knows them. A private package name resolves to its public alias (`@acme/react-internal` becomes `react`) or is dropped.
- Answering with `A!` or `B?` now works: the server accepts a letter plus an optional `!` (sure) or `?` (not sure) suffix.
- `ATOMICREPS_API` and `ATOMICREPS_SITE` are now honoured only for an Atomic Reps address or a loopback address. Anything else is ignored and reported by `npx atomicreps doctor`; set `ATOMICREPS_UNSAFE_ORIGIN=1` to restore the old behaviour.
- `npx atomicreps logout --purge` now also deletes the reps, status, and error log this machine cached.
- SECURITY.md now states the trust boundary and where to report a vulnerability.
- `doctor` now tells you when the MCP server process your editor is running has fallen behind, and asks you to restart. Shown once per server start, not every turn.
- Fixed `permission denied` on upgrade, caused by `dist/cli.js` shipping without its executable bit. Anyone who ran 0.0.1 or 0.0.2 before 0.0.3 needed to clear the npx cache; this is now fixed at the source.

## 0.0.3

Three themes: a rep arrives only when your turn is actually over, the server stops changing your pace behind your back, and failures stop being silent.

### When a rep arrives

- In Claude Code, the `Stop` hook now prints the rep when Claude's turn ends, instead of handing it to Claude to append after its answer.
- No rep while Claude is asking you something; your answer is the next message.
- No rep until something has changed in your working tree since the last one.
- No rep about something unrelated. Asking for one by number still draws from your history and says so.

### Pace

- Nothing widens your gap or shrinks your day automatically anymore.
- After five skips, and every fifth after that, a rep offers a lighter pace instead of imposing one.
- Pro has no daily ceiling: you pay for a pace, not a quota. Free keeps three a day; off still means off.

### Reaching the server

- A wrong `ATOMICREPS_API` now names itself as the problem instead of reading as a bad minute.
- An outage no longer costs a session its tools; the MCP server process keeps offering the four tool names.
- `rep` now speaks up when the server is unreachable for good, instead of retrying silently.
- A status the old two-strikes rule had shut stayed shut for a day; a migration now clears it.
- This machine now stops trusting its own cached clock past an hour.
- The setup instructions explain how to reach `rep` when a client lists tools by name only.

### Setup

- The connect screen now shows the command it actually runs.
- `npx atomicreps doctor` now follows `CLAUDE_CONFIG_DIR` instead of always reading `~/.claude`.
- Text beside Loop now fits the terminal instead of running off the right edge.

### Wizard

- One tree instead of two letter-keyed screens. Arrows move, space picks, right opens an area, and typing searches all 141 topics at once.
- The first screen now requires an area, instead of treating empty as "all of it."
- The difficulty range is now picked on a ladder: space the easiest level, then the hardest. Levels above the free one carry a PRO tag.
- Every screen uses the same four keys: arrows move, space picks, enter continues, escape goes back.
- `npx atomicreps connect` now asks before changing anything. It lists Claude Code, Cursor, Windsurf, and Codex, ticks nothing, and only edits the rows you pick.
- Ctrl-C now leaves a wizard screen.
- An area you pick is now sent as an area, so topics added to it later reach you.

## 0.0.2

- `npx atomicreps` no longer stops at "Could not load the catalog" on a fresh machine; the wizard no longer requires a token you don't have yet.
- The wizard now waits up to eight seconds for the catalog, instead of 1.2.

## 0.0.1

First public release. `rep`, `answer`, `me`, and `settings` over stdio or HTTP, the setup wizard, the loop, the status line, and the prompt hook.
