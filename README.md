# atomicreps

One short question about the thing you just built. Works inside Claude Code, GitHub Copilot, Cursor, Codex, or any MCP client.

```
npx atomicreps            the terminal screen: you, this session, topics, mutes, rate
npx atomicreps setup      first-run wizard: areas, topics, how often, how hard
npx atomicreps login      sign in from a browser with a typed code
npx atomicreps connect    register the server with your editor
npx atomicreps connect --pin   pin the launch args to this installed version, for a command you can commit
npx atomicreps mcp        the stdio MCP server process (what the editor launches)
npx atomicreps doctor     token, server ping, version, when the next rep may come, allowlist
npx atomicreps logout     forget the token on this machine
npx atomicreps logout --purge   also forget your reps and status; for a shared machine
```

Add `--alpha` to any command to use staging. It keeps its own token and cache,
so you can be signed in to both staging and production at once.

Plain `connect` writes `npx -y atomicreps mcp`, which always resolves to
whatever is latest at launch. `connect --pin` writes `npx -y
atomicreps@<version> mcp` instead, the version this CLI is running, so an
organisation can review one exact command and commit it rather than trusting
npx to fetch the same thing twice.

## GitHub Copilot

`npx atomicreps connect` offers VS Code and Copilot CLI as rows. Without it:

```
code --add-mcp '{"name":"atomicreps","type":"stdio","command":"npx","args":["-y","atomicreps","mcp"]}'
copilot mcp add atomicreps -- npx -y atomicreps mcp
```

Copilot in JetBrains, Visual Studio, Xcode and Eclipse reads the same entry
from its own `mcp.json` (Settings, then MCP). A team can
commit it as `.vscode/mcp.json` so every clone has it:

```json
{
  "servers": {
    "atomicreps": { "type": "stdio", "command": "npx", "args": ["-y", "atomicreps", "mcp"] }
  }
}
```

Copilot reads the server's instructions and calls `rep` when a task ends,
the same as Cursor and Codex. Approve the four tools once and they stay
approved.

## How a rep arrives

When your coding agent finishes a task, it calls `rep` once with a few words
for what changed. The server picks one question, or nothing, and your agent
shows it to you as it came back. Reply with a letter, or ignore it.

Under the verdict, one line names up to three other things the session
touched. A number asks about one of them. "Never Swift" mutes a topic for
good. "Not this topic" rests it for thirty days. "Unmute Swift" lifts it.
"How am I doing" prints your summary.

The server enforces the pace, not the agent. It sets a minimum gap between
automatic reps, a daily cap, and mute and off. It refuses an answer typed
within seconds of the question. It never includes the answer key in a rep.
Every failure answers with no rep rather than an error; `doctor` says why.

## Tools

| tool | what it does |
| --- | --- |
| `rep({ touched?, ask?, topic?, kind?, exclude? })` | one question, one insight, or nothing; `ask` takes a handle from an offer |
| `answer({ pick, id? })` | the verdict, the why, and the offer line |
| `me({ show? })` | `summary`, `skills`, `reps`, `streak` or `mutes` |
| `settings({ intensity?, topics?, levels?, prefer?, mute?, muteMinutes?, days?, unmute?, dialog? })` | the rate, the pinned topics, the difficulty range, the preferred areas, mutes, the dialog |

Handles are `topic` or `topic.subskill` (`react.hooks_core`). Fifty sub-skill
slugs repeat across topics, so the topic is always part of the name.

`settings({ dialog: true })` asks for the letter in your editor's native
dialog instead of the chat. It blocks the turn, so it is a setting, never the
default.

## Privacy

What leaves your machine on a `rep` call: catalog handles with small weights.
Also package, file extension and folder names the public catalog already
knows. Your agent's `touched` words are matched to handles on your machine;
the words themselves are never sent. An unknown package name is dropped. A
private name (`@acme/react-internal`) is sent as its public alias (`react`).
We never send your code, a file's contents, or a prompt. `npx atomicreps
setup` prints the exact payload for your repo, before you sign in.

`npx atomicreps mcp` forwards each JSON-RPC message from your editor to the
Atomic Reps server with your token. The answer comes back the same way.
`ATOMICREPS_API` is honoured only for an Atomic Reps or loopback address,
since your token goes wherever it points. Anything else is ignored and
reported by `doctor`; set `ATOMICREPS_UNSAFE_ORIGIN=1` to override.

## Login

`npx atomicreps` prints a code. Type it at atomicreps.com/connect while
signed in; a forwarded link approves nothing. The token lands in
`~/.config/atomicreps/config.json` (mode 0600), prefixed `arep_` so secret
scanners find it. You can revoke it from your account page. `logout` forgets
it; `logout --purge` also deletes the reps and status this machine cached.

The trust boundary, and how to report a vulnerability: SECURITY.md.

## Check it yourself

`dist/cli.js` is built from these files and nothing else. The package has no
runtime dependencies.

```
npm install
npm run build    # writes dist/cli.js from src
npm test         # the behaviour described above, as tests
```

To compare with what npm serves: `npm pack atomicreps`, then read its
`dist/cli.js` beside the one you just built. Everything the client sends is in
`src/api.ts`. Everything it reads from your repository is in `src/infer.ts`.

MIT.
