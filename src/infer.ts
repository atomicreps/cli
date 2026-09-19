import { spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";

import * as clock from "./clock.js";
import {
  INFER_BUDGET_MS,
  TUI_INFER_BUDGET_MS,
  MAX_BYTES_PER_FILE,
  MAX_CHANGED,
  MAX_SCAN_DEPTH,
  MAX_SCAN_FILES,
  MAX_DIFF_BYTES,
  MAX_EXTENSIONS_SENT,
  MAX_FILES_READ,
  MAX_IMPORTS_PER_FILE,
  MAX_MANIFEST_DEPS,
  MAX_PACKAGES_SENT,
  MAX_ROOT_HOPS,
  SCAN_SKIP,
} from "./constants.js";
import { applyGrammar, EMPTY_GRAMMAR, knownExtensions, knownPackages } from "./touch.js";
import type { LocalHints, TouchGrammar } from "./types.js";
import { record } from "./wire.js";

function runGit(cwd: string, args: string[], budgetMs: number): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  let out = "";
  let done = false;
  const finish = (value: string) => {
    if (done) return;
    done = true;
    resolve(value);
  };
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    finish("");
    return promise;
  }
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
    }
    finish(out);
  }, budgetMs);
  child.stdout?.on("data", (chunk: Buffer) => {
    if (out.length < MAX_DIFF_BYTES) out += chunk.toString("utf8");
  });
  child.on("error", () => {
    clearTimeout(timer);
    finish("");
  });
  child.on("close", () => {
    clearTimeout(timer);
    finish(out);
  });
  return promise;
}

function openRead(path: string): { fd: number } & Disposable {
  const fd = openSync(path, "r");
  return { fd, [Symbol.dispose]: () => closeSync(fd) };
}

function readHead(path: string): string {
  try {
    const size = Math.min(statSync(path).size, MAX_BYTES_PER_FILE);
    using file = openRead(path);
    const buffer = Buffer.alloc(size);
    const read = readSync(file.fd, buffer, 0, size, 0);
    return buffer.subarray(0, read).toString("utf8");
  } catch {
    return "";
  }
}

function scanRecent(
  cwd: string,
  deadline: { remaining: () => number },
): { files: string[]; mark: string } | null {
  const found: Array<{ rel: string; mtime: number; size: number }> = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: cwd, depth: 0 }];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || deadline.remaining() <= 0) return null;
    let entries: Dirent[];
    try {
      entries = readdirSync(next.dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(next.dir, entry.name);
      if (entry.isDirectory()) {
        if (next.depth + 1 > MAX_SCAN_DEPTH || SCAN_SKIP.has(entry.name)) continue;
        queue.push({ dir: path, depth: next.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      if (found.length >= MAX_SCAN_FILES) return null;
      try {
        const stat = statSync(path);
        found.push({ rel: relative(cwd, path), mtime: stat.mtimeMs, size: stat.size });
      } catch {
      }
    }
  }
  const byRecency = found.toSorted((a, b) => b.mtime - a.mtime);
  return {
    files: byRecency.slice(0, MAX_CHANGED).map((entry) => entry.rel),
    mark: fingerprint(byRecency.map((e) => `${e.rel}:${e.mtime}:${e.size}`).join("|")),
  };
}

const IMPORT_RE = /(?:from\s+|require\(|import\s+)["']([^"']+)["']/g;

function importSpecifiers(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/")) continue;
    const pkg = spec.startsWith("@")
      ? spec.split("/").slice(0, 2).join("/")
      : (spec.split("/")[0] ?? spec);
    found.add(pkg);
    if (found.size >= MAX_IMPORTS_PER_FILE) break;
  }
  return [...found];
}

function manifestDeps(cwd: string): string[] {
  try {
    const raw = readFileSync(join(cwd, "package.json"), "utf8");
    const parsed = record(JSON.parse(raw) as unknown);
    if (parsed === undefined) return [];
    const names = new Set<string>();
    for (const field of [parsed.dependencies, parsed.devDependencies]) {
      const deps = record(field);
      if (deps === undefined) continue;
      for (const name of Object.keys(deps)) names.add(name);
    }
    return [...names].slice(0, MAX_MANIFEST_DEPS);
  } catch {
    return [];
  }
}

function isSafeRepoPath(entry: string): boolean {
  if (entry.length === 0 || entry.length > 1024) return false;
  if (entry.startsWith("/") || entry.includes("..")) return false;
  return !/[\u0000-\u001f]/.test(entry);
}

function findRepoRoot(cwd: string): string | null {
  let dir = cwd;
  for (let hops = 0; hops < MAX_ROOT_HOPS; hops++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function extensionOf(path: string): string {
  const base = basename(path).toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  return extname(base).replace(/^\./, "");
}

export function addedLines(diff: string): string[] {
  const lines: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) lines.push(line.slice(1));
  }
  return lines;
}

export type Session = { hints: LocalHints; mark: string | null };

const NOTHING: LocalHints = { packages: [], extensions: [], touched: [] };

function safePaths(raw: string, prefixChars: number): string[] {
  return raw
    .split("\0")
    .map((entry) => entry.slice(prefixChars).trim())
    .filter(isSafeRepoPath)
    .slice(0, MAX_CHANGED);
}

function hintsOf(
  root: string,
  cwd: string,
  changed: readonly string[],
  diff: string,
  deadline: clock.Deadline,
  grammar: TouchGrammar | null,
): LocalHints {
  const extensions = new Set<string>();
  const packages = new Set<string>();
  for (const file of changed) {
    const ext = extensionOf(file);
    if (ext) extensions.add(ext);
    const dir = file.split("/")[0];
    if (dir && dir !== file) extensions.add(dir.toLowerCase());
  }

  const byRecency = changed
    .map((file) => {
      try {
        return { file, mtime: statSync(join(root, file)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { file: string; mtime: number } => entry !== null)
    .toSorted((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_FILES_READ);
  const heads: string[] = [];
  for (const { file } of byRecency) {
    if (deadline.remaining() <= 0) break;
    const head = readHead(join(root, file));
    heads.push(head);
    for (const spec of importSpecifiers(head)) packages.add(spec);
  }

  for (const dep of manifestDeps(cwd)) packages.add(dep);
  if (root !== cwd) for (const dep of manifestDeps(root)) packages.add(dep);

  const touched =
    grammar === null
      ? []
      : applyGrammar(grammar, { paths: changed, addedLines: addedLines(diff), heads, deadline });

  const vocabulary = grammar ?? EMPTY_GRAMMAR;
  return {
    packages: knownPackages(vocabulary, [...packages]).slice(0, MAX_PACKAGES_SENT),
    extensions: knownExtensions(vocabulary, [...extensions]).slice(0, MAX_EXTENSIONS_SENT),
    touched,
  };
}

export async function inferSession(
  cwd: string,
  budgetMs = INFER_BUDGET_MS,
  grammar: TouchGrammar | null = null,
): Promise<Session> {
  const deadline = clock.deadline(budgetMs);

  const inRepo = findRepoRoot(cwd);
  const root = inRepo ?? cwd;

  const changedRaw =
    inRepo === null
      ? ""
      : await runGit(
          cwd,
          ["status", "--porcelain", "-z", "--untracked-files=all", "--no-renames"],
          Math.min(deadline.remaining(), budgetMs * 0.4),
        );
  const scan = inRepo === null ? scanRecent(cwd, deadline) : null;
  const changed = scan === null ? safePaths(changedRaw, 3) : scan.files.filter(isSafeRepoPath);

  const diff =
    grammar && changed.length > 0 && deadline.remaining() > 20
      ? await runGit(
          root,
          ["diff", "--no-color", "--unified=0", "--no-ext-diff", "HEAD", "--", ...changed],
          Math.min(deadline.remaining(), budgetMs * 0.3),
        )
      : "";

  return {
    hints: hintsOf(root, cwd, changed, diff, deadline, grammar),
    mark:
      inRepo === null ? (scan?.mark ?? null) : fingerprint(`${changedRaw}|${String(diff.length)}`),
  };
}

const COMMIT_HASH = /^[0-9a-f]{7,64}$/;

export async function inferCommit(
  cwd: string,
  hash: string,
  budgetMs = TUI_INFER_BUDGET_MS,
  grammar: TouchGrammar | null = null,
): Promise<Session> {
  const root = findRepoRoot(cwd);
  if (root === null || !COMMIT_HASH.test(hash)) return { hints: NOTHING, mark: null };
  const deadline = clock.deadline(budgetMs);
  const changedRaw = await runGit(
    root,
    ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "--root", hash],
    Math.min(deadline.remaining(), budgetMs * 0.4),
  );
  const changed = safePaths(changedRaw, 0);
  const diff =
    grammar && changed.length > 0 && deadline.remaining() > 20
      ? await runGit(
          root,
          [
            "show",
            "--no-color",
            "--unified=0",
            "--no-ext-diff",
            "--format=",
            hash,
            "--",
            ...changed,
          ],
          Math.min(deadline.remaining(), budgetMs * 0.3),
        )
      : "";
  return {
    hints: hintsOf(root, cwd, changed, diff, deadline, grammar),
    mark: fingerprint(`${hash}|${changedRaw}`),
  };
}

export async function inferHints(
  cwd: string,
  budgetMs = INFER_BUDGET_MS,
  grammar: TouchGrammar | null = null,
): Promise<LocalHints> {
  return (await inferSession(cwd, budgetMs, grammar)).hints;
}

export function fingerprint(text: string): string {
  let h = 0x81_1c_9d_c5;
  for (const ch of text) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01_00_01_93) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
