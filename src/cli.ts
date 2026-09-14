import { readConfig, setChannel, writeConfig } from "./config.js";
import { ENV } from "./constants.js";
import { refreshGrammar, runHook } from "./hook.js";
import { install, needsSetup } from "./install.js";
import { serve } from "./mcp.js";
import { isInteractive } from "./screen.js";
import { statusLine } from "./statusline.js";
import { purgeLocalData } from "./store.js";
import { connect, doctor, home, login } from "./tui.js";
import { SERVER_VERSION } from "./version.js";

const HELP = `atomicreps - one short rep about the thing you just built, inside your coding agent.

  npx atomicreps            the terminal surface: you, this session, topics, mutes, rate
  npx atomicreps setup      the first-run wizard: what to practise, how often, how hard
  npx atomicreps login      sign in from a browser with a typed code
  npx atomicreps connect    pick which editors to wire up; writes nothing you did not pick
  npx atomicreps mcp        the stdio bridge to the door (what the editor launches)
  npx atomicreps doctor     token, server ping, quiet clock, allowlist
  npx atomicreps logout     forget the token on this machine
  npx atomicreps logout --purge   also forget your reps and status; for a shared machine
  npx atomicreps hook       the Claude Code plugin's Stop and UserPromptSubmit hook (stdin JSON in, JSON out)
  npx atomicreps statusline one line for a Claude Code status line

Add --alpha to any command to use the staging door instead of the live one.
Alpha keeps its own token and cache, so both can be signed in at once.

Env: ATOMICREPS_API, ATOMICREPS_SITE, ATOMICREPS_CHANNEL=alpha, NO_COLOR.
`;

function pluginHint(): void {
  if (!process.env.CLAUDECODE || process.env[ENV.pluginHint] !== "1") return;
  process.stderr.write(
    '<claude-code-hint v="1" type="plugin" value="atomicreps@claude-plugins-official" />\n',
  );
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let raw = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => (raw += chunk));
    process.stdin.on("end", () => resolve(raw));
    process.stdin.on("error", () => resolve(raw));
  });
}

function takeChannel(argv: string[]): string[] {
  const flagged = argv.includes("--alpha");
  if (flagged || process.env[ENV.channel] === "alpha") setChannel("alpha");
  return argv.filter((arg) => arg !== "--alpha");
}

async function main(raw: string[]): Promise<number> {
  const argv = takeChannel(raw);
  const [command] = argv;
  switch (command) {
    case "mcp":
      serve();
      return -1;
    case "login": {
      const ok = await login(isInteractive());
      if (ok) process.stdout.write("Signed in. Run npx atomicreps connect to wire an editor.\n");
      if (ok) pluginHint();
      return ok ? 0 : 1;
    }
    case "hook": {
      try {
        const [output] = await Promise.all([runHook(await readStdin()), refreshGrammar()]);
        if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
      } catch {
      }
      return 0;
    }
    case "statusline":
      process.stdout.write(`${statusLine()}\n`);
      return 0;
    case "version":
    case "--version":
    case "-v":
      process.stdout.write(`${SERVER_VERSION}\n`);
      return 0;
    case "setup":
      if (!isInteractive()) {
        process.stdout.write("Setup needs a terminal. Run npx atomicreps setup by hand.\n");
        return 1;
      }
      return (await install()) ? 0 : 1;
    case "connect":
      if (!readConfig().token) {
        process.stdout.write("Not signed in yet. Run npx atomicreps login first.\n");
        return 1;
      }
      await connect(false);
      return 0;
    case "doctor":
      return await doctor();
    case "logout": {
      const purge = argv.includes("--purge");
      writeConfig({});
      if (purge) purgeLocalData();
      process.stdout.write(
        purge
          ? "Signed out and forgot your reps and status on this machine.\n"
          : "Signed out on this machine.\n",
      );
      return 0;
    }
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      pluginHint();
      return 0;
    case undefined:
      if (isInteractive()) {
        if (needsSetup()) await install();
        else await home();
        return 0;
      }
      process.stdout.write(HELP);
      return readConfig().token ? await doctor() : 1;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (error: unknown) => {
    process.stderr.write(`[atomicreps] ${Error.isError(error) ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
