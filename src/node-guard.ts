export const MIN_NODE_MAJOR = 24;

export interface GuardVerdict {
  code: number;
  stdout?: string;
  stderr?: string;
}

export function nodeGuard(version: string, argv: readonly string[]): GuardVerdict | null {
  if (Number.parseInt(version, 10) >= MIN_NODE_MAJOR) return null;
  const command = argv.find((arg) => arg !== "--alpha");
  if (command === "hook") return { code: 0 };
  if (command === "statusline") {
    return { code: 0, stdout: `atomicreps needs Node ${MIN_NODE_MAJOR}+\n` };
  }
  return {
    code: 1,
    stderr: `atomicreps needs Node ${MIN_NODE_MAJOR} or newer (you have v${version}). Install: https://nodejs.org\n`,
  };
}

const verdict = nodeGuard(process.versions.node, process.argv.slice(2));
if (verdict) {
  if (verdict.stdout) process.stdout.write(verdict.stdout);
  if (verdict.stderr) process.stderr.write(verdict.stderr);
  process.exit(verdict.code);
}
