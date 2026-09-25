# Changelog

## 0.0.16

- On a Node version older than 24, every command now prints the Node version it needs and stops, instead of starting and then failing with a stack trace. The Claude Code hook prints nothing and exits cleanly, so your editor keeps working, and the status line reads "atomicreps needs Node 24+".
- The Claude Code plugin grades a letter only when the letter is your whole message (`!`, `?`, `.` or `)` after it is fine) and you send it right after the rep appeared. "a quick fix please" is no longer read as an answer of A. A letter you send after the conversation has moved on goes to your agent, which can still answer the rep through the MCP server.
- The plugin no longer adds a line to your agent's context on every message you send. A message that has nothing to do with reps now costs no tokens.
- The plugin no longer tells your agent that the verdict must be its whole reply.
- `doctor` no longer says the plugin is "not installed". The plugin is not in a public marketplace yet, and the MCP server is all you need.

## 0.0.15

- `npx atomicreps logout --purge` now offers to remove what `connect` set up. After signing you out, it lists every editor entry `connect` wrote on this machine, all ticked: the Claude Code server, its four allowed tools and its status line, and the entries for Codex, VS Code, Copilot CLI, Cursor and Windsurf. Enter removes the ticked ones, and a row you untick stays. If you had your own status line before, it comes back. Before this, signing out left every editor still starting the old server, and signing in again added a second server next to it.
- A letter answers the open rep only when your message is a single line. A message of several lines whose first line is a letter is no longer read as an answer.
- The setup wizard, `--help` and `doctor` say what they do in plainer words.

## 0.0.14

- You can now say how many insights you want. An insight is a short fact to read, with no question to answer, and until now you got three a day whether or not you wanted that many. Tell your agent "insights light" for one a day, "insights off" for none, or "insights more" on Pro for up to eight. Asking for one out loud still works at every setting, including off.

## 0.0.13

- A rep you did not get to is put back on the screen at the end of your next turn, twice, and is then replaced by a new one. Before this, one question you scrolled past blocked every later question for four hours. Before it shows a rep again, the hook checks with the server, so a rep you answered on the web link or in another editor is closed here too and the next rep is shown instead.
- The status line now shows the question waiting on you: the stem on one row and the four options under it, cut to the width your terminal reports, so a letter is one keystroke away however far the block has scrolled. After you answer, the status line shows the verdict for ten minutes, and with no open question it shows when the next rep is due and your counts for the day, or nothing at all.
- `npx atomicreps connect` offers to put that status line into Claude Code for you. A status line you already have keeps printing first and ours becomes a second row. The status line runs the installed copy directly rather than through npx, so it is fast enough for Claude Code's refresh.

## 0.0.12

- `npx atomicreps connect --pin` writes the launch args with the installed version spelled out (`atomicreps@0.0.12`, not bare `atomicreps`), so an organisation can commit one reviewed command instead of trusting npx to fetch the same thing twice. Plain `connect` is unchanged.
- The setup wizard now offers to answer through your editor's own dialog instead of the chat, once a real session has shown your editor supports it. Off by default, since it blocks the turn until you answer the popup.
- SECURITY.md now says what the server keeps against your account, how to export or delete it, and what a tutor running a class seat can see.

## 0.0.11

- Your agent is no longer offered a question it cannot have. While a rep is waiting for your letter, and while reps are off, muted, or the day's budget is used up, the tool is not on the list, and it reappears automatically when the wait is over. Before this, the agent would ask, get nothing, and you paid for the round trip.
- An editor can now follow your day's counts and streak as they change, instead of asking again and again.

## 0.0.10

- Loop's face is redrawn. Much bigger eyes, each with a catchlight in it rather than a flat dark slot, and a mouth about half the width it was. His cheeks show now. He has brows, so the face he pulls when you break something is a face and not a pair of dashes. Asleep, his eyes land on his head instead of hovering above it.

## 0.0.9

- Loop is drawn by the mascot himself now, in colour, instead of the box glyphs that stood in for him. A terminal without colour still gets a drawn Loop, redrawn so he looks like an animal rather than a box with a face.
- The home screen now shows one action first: do a rep. The other nine keys moved behind `?`, grouped and each saying what it is set to; they all still work from the home screen, so nothing you had learned has moved.
- Your day is shown as figures rather than sentences: a week of streak dots, and a meter of the reps you have asked for against the day's limit.
- The list of areas no longer extends past the side of the screen. It is cut to the screen's width.
- Every rep now carries a link to answer it in a browser. Answering with a letter starts a whole agent turn, which is the expensive part of a rep; the link costs only the click. It opens for you and nobody else, and it does not expire.

## 0.0.8

- `hook`, `mcp`, `statusline` and `doctor` now follow whichever channel you signed in with, when none is named; production is used if both are signed in. `login`, `connect` and `logout` still need an explicit channel; `doctor` says when it picked one automatically.

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

- The areas you pick can now decide which reps you get, not just break a tie. Setup now asks: "These first" (the old default) or "Only these" (no rep for a session spent outside your chosen areas).
- `npx atomicreps` now says when a period with no reps was caused by this setting, and how many reps it skipped today.
- Say "only ask me about my areas" to turn this on, or "ask me about everything I touch" to turn it off.
- Picking no areas leaves the setting inactive, same as everywhere else in the catalog.

## 0.0.4

- The words your agent writes in `touched` no longer leave your machine; only the matching catalog handle is sent.
- Package names, file extensions, and folder names are sent only when the public catalog already knows them. A private package name resolves to its public alias (`@acme/react-internal` becomes `react`) or is dropped.
- Answering with `A!` or `B?` now works: the server accepts a letter plus an optional `!` (sure) or `?` (not sure) suffix.
- `ATOMICREPS_API` and `ATOMICREPS_SITE` are now honoured only for an Atomic Reps address or a loopback address. Anything else is ignored and reported by `npx atomicreps doctor`; set `ATOMICREPS_UNSAFE_ORIGIN=1` to restore the old behaviour.
- `npx atomicreps logout --purge` now also deletes the reps, status, and error log this machine cached.
- SECURITY.md now states the trust boundary and where to report a vulnerability.
- `doctor` now tells you when the MCP server process your editor is running is an older version, and asks you to restart. Shown once per server start, not every turn.
- Fixed `permission denied` on upgrade, caused by `dist/cli.js` shipping without its executable bit. Anyone who ran 0.0.1 or 0.0.2 before 0.0.3 needed to clear the npx cache; this is now fixed at the source.

## 0.0.3

Three themes: a rep is shown only when your turn is over, the server no longer changes your pace without telling you, and failures are reported.

### When a rep is shown

- In Claude Code, the `Stop` hook now prints the rep when Claude's turn ends, instead of passing it to Claude to append after its answer.
- No rep while Claude is asking you something; your answer is the next message.
- No rep until something has changed in your working tree since the last one.
- No rep about something unrelated. Asking for one by number still draws from your history and says so.

### Pace

- Nothing lengthens the gap between reps or lowers your daily count automatically anymore.
- After five skips, and every fifth after that, a rep offers a lighter pace instead of imposing one.
- Pro has no daily limit: you pay for a pace, not a quota. Free keeps three a day; off still means off.

### Reaching the server

- A wrong `ATOMICREPS_API` is now reported as the problem instead of looking like a brief outage.
- An outage no longer removes the tools from a session; the MCP server process keeps offering the four tool names.
- `rep` now reports when the server stays unreachable, instead of retrying silently.
- A status the old two-strikes rule had shut stayed shut for a day; a migration now clears it.
- This machine now stops relying on its own cached clock after an hour.
- The setup instructions explain how to call `rep` when a client lists tools by name only.

### Setup

- The connect screen now shows the command it actually runs.
- `npx atomicreps doctor` now follows `CLAUDE_CONFIG_DIR` instead of always reading `~/.claude`.
- Text beside Loop now fits the terminal instead of extending past the right edge.

### Wizard

- One tree instead of two letter-keyed screens. Arrows move, space picks, right opens an area, and typing searches all 141 topics at once.
- The first screen now requires an area, instead of treating empty as "all of it."
- The difficulty range is now picked from a list of levels: space the easiest level, then the hardest. Levels above the free one carry a PRO tag.
- Every screen uses the same four keys: arrows move, space picks, enter continues, escape goes back.
- `npx atomicreps connect` now asks before changing anything. It lists Claude Code, Cursor, Windsurf, and Codex, ticks nothing, and only edits the rows you pick.
- Ctrl-C now leaves a wizard screen.
- An area you pick is now sent as an area, so topics added to it later are included.

## 0.0.2

- `npx atomicreps` no longer stops at "Could not load the catalog" on a fresh machine; the wizard no longer requires a token you don't have yet.
- The wizard now waits up to eight seconds for the catalog, instead of 1.2.

## 0.0.1

First public release. `rep`, `answer`, `me`, and `settings` over stdio or HTTP, the setup wizard, the loop, the status line, and the prompt hook.
