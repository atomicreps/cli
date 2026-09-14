# Changelog

## 0.0.5

- The areas you pick can now decide what arrives, not just what comes first. Until today a rep followed whatever the session touched and your areas only broke the tie, so a day in Postgres could ask you about Postgres even if you had only picked Frontend. Setup now asks which you want. "These first" is what you already had and stays the default; "Only these" means a session spent outside your areas gets no rep at all rather than one you did not ask for.
- `npx atomicreps` says when that silence was the setting doing its job, and how many reps it cost today, so a quiet afternoon has an answer rather than a suspicion.
- Say "only ask me about my areas" to your agent to turn it on later, or "ask me about everything I touch" to go back.
- Picking no areas leaves the setting inert. An empty list already means the whole catalog everywhere else, so gating on it would have silenced the door for good.

## 0.0.4

- The words your agent writes in `touched` no longer leave your machine. They are matched against the published catalog here, and only the handle they resolve to is sent. A phrase that matches nothing is dropped.
- Package names, file extensions and folder names are sent only where the public catalog already knows them. A private package name resolves to its public alias word (`@acme/react-internal` becomes `react`) or is dropped, and the free-text `topic` an editor may pass is reduced to catalog words. Everything else an MCP host puts in a `rep` call is dropped rather than forwarded.
- Answering with `A!` or `B?` works. The door asks for the letter and, optionally, `!` when you were sure and `?` when you were not; the hook did not recognise the suffix and the answer was read as ordinary prose and lost.
- `ATOMICREPS_API` and `ATOMICREPS_SITE` are honoured only for an Atomic Reps origin or a loopback address, since your token is attached to whatever the first names and your browser is sent to the second. Anything else is ignored and `npx atomicreps doctor` says so; `ATOMICREPS_UNSAFE_ORIGIN=1` restores the old behaviour for local development.
- `npx atomicreps logout --purge` also deletes the reps, the status and the error log this machine cached. For a shared machine.
- SECURITY.md says what the trust boundary is and where to report a vulnerability.
- Tells you when the bridge your editor is running has fallen behind. The hook is respawned through npx every turn, so it is current; the bridge is started once by your editor and keeps whatever it resolved then, for as long as the editor stays open. When the two differ, one line under the rep says so, links these notes, and asks you to restart. Said once per bridge start, not every turn.
- Fixes `permission denied` on upgrade. The published `dist/cli.js` shipped without its executable bit. A first install still worked, because npm sets the bit when it creates the link, but an npx cache that already held an older copy replaced the file in place and kept the old link, so the next run refused to start. Anyone who ran 0.0.1 or 0.0.2 before 0.0.3 hit this; a clear npx cache was the only way out.

## 0.0.3

Three themes: a rep arrives when your turn is actually over, the door stops changing your pace behind your back, and it stops failing silently.

### When a rep arrives

- In Claude Code, the `Stop` hook prints the rep when Claude's turn ends, instead of handing it to Claude to append after its answer. Claude never sees it, spends no tokens on it, and cannot forget to relay it.
- No rep while Claude is asking you something. A turn that ends on a question is not finished; the answer is your next message.
- No rep until something has changed in your working tree since the last one. A turn that only read files and gave an opinion has nothing to ask about.
- No rep about something else. When nothing you touched has a fresh question, the door stays quiet for your gap instead of asking about a topic from your path. Asking for one by number still draws from your path and says so.

### Pace

- Nothing widens your gap or shrinks your day on its own. The skip ramp and the next-day cap taper are both gone, and neither ever told you it had happened.
- After five skips, and every fifth after, a rep offers a lighter pace instead of imposing one.
- Pro has no daily ceiling: you pay for a pace, not a quota. Free keeps three a day. Off still means off.

### Reaching the door

- A wrong `ATOMICREPS_API` now names itself. It used to read as a bad minute, so the bridge served no tools and looked healthy for weeks.
- An outage no longer costs a session its tools. Clients ask once, so the bridge keeps offering the four names.
- `rep` speaks up when the door is unreachable for good, instead of retrying in silence.
- A ledger the old two-strikes rule shut stayed shut for a day. Nothing reads that field now, and a migration clears it.
- This machine stops trusting its own cached clock past an hour, so a client cannot outlive a fix.
- The instructions say how to reach `rep` when a client lists tools by name only.

### Setup

- The connect screen shows the command it really runs. On the alpha channel it printed one server name and registered another.
- `npx atomicreps doctor` follows `CLAUDE_CONFIG_DIR` instead of always reading `~/.claude`.
- Text beside Loop fits the terminal instead of running off the right edge.

### Wizard

- One tree instead of two letter-keyed screens. Arrows move, space picks, right opens an area, and typing searches all 141 topics at once.
- The first screen needs an area. Empty used to read as "all of it", which drew reps from every topic whenever your tree was quiet.
- The difficulty band is picked on the ladder: space the easiest rung you want, then the hardest. Each rung says what shape of question it asks rather than how hard it feels.
- Rungs above the free one carry a PRO tag.
- Every screen takes the same four keys: arrows move, space picks, enter continues, escape goes back.
- `npx atomicreps connect` asks before it touches anything. It lists Claude Code, Cursor, Windsurf and Codex, ticks nothing, and does only the rows you pick. "I'll set it up myself" prints the entry and writes nothing.
- Ctrl-C leaves a wizard screen. Raw mode had been swallowing it.
- An area you pick is sent as an area, so topics added to it later reach you.

## 0.0.2

- `npx atomicreps` no longer stops at "Could not load the catalog." on a fresh machine. The setup wizard reads the catalog before you sign in, and the server was asking for a token you cannot have yet.
- The wizard waits up to eight seconds for the catalog rather than 1.2. Someone is at the keyboard on that screen, so the budget is theirs and not a build's.

## 0.0.1

First public release. `rep`, `answer`, `me` and `settings` over stdio or HTTP, the setup wizard, the loop, the status line and the prompt hook.
