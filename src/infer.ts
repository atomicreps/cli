import { spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { loadClassifier, touchedFor } from "./classify.js";
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
  MAX_NEW_FILE_BYTES,
  MAX_PACKAGES_SENT,
  SCAN_SKIP,
} from "./constants.js";
import { findRepoRoot } from "./project.js";
import { EMPTY_GRAMMAR, extensionOf, knownExtensions, knownPackages } from "./touch.js";
import type { ChangedFile, LocalHints, Pushed, TouchGrammar, TreeSnapshot } from "./types.js";
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

function readHead(path: string, maxBytes = MAX_BYTES_PER_FILE): string {
  try {
    const size = Math.min(statSync(path).size, maxBytes);
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

export function addedByFile(diff: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const raw = line
        .slice(4)
        .replace(/\t$/, "")
        .replace(/^"(.*)"$/, "$1");
      if (raw === "/dev/null") {
        current = undefined;
        continue;
      }
      const path = raw.replace(/^b\//, "");
      current = out.get(path) ?? [];
      out.set(path, current);
      continue;
    }
    if (current !== undefined && line.startsWith("+")) current.push(line.slice(1));
  }
  return out;
}

export type Session = {
  hints: LocalHints;
  mark: string | null;
  snapshot: TreeSnapshot;
  unchanged: boolean;
  files: readonly ChangedFile[];
};

function stampOf(root: string, path: string): string {
  try {
    const stat = statSync(join(root, path));
    return `${String(stat.mtimeMs)}:${String(stat.size)}`;
  } catch {
    return "gone";
  }
}

const NOTHING: LocalHints = { packages: [], extensions: [], touched: [] };

function safePaths(raw: string, prefixChars: number): string[] {
  return raw
    .split("\0")
    .map((entry) => entry.slice(prefixChars).trim())
    .filter(isSafeRepoPath)
    .slice(0, MAX_CHANGED);
}

type Change = { path: string; status: ChangedFile["status"] };

function statusChanges(raw: string): Change[] {
  return raw
    .split("\0")
    .filter((entry) => entry.length > 3)
    .map((entry): Change => {
      const code = entry.slice(0, 2);
      const status =
        code === "??" || code.includes("A") ? "added" : code.includes("D") ? "deleted" : "modified";
      return { path: entry.slice(3).trim(), status };
    })
    .filter((change) => isSafeRepoPath(change.path))
    .slice(0, MAX_CHANGED);
}

function hintsOf(
  root: string,
  cwd: string,
  changes: readonly Change[],
  diff: string,
  deadline: clock.Deadline,
  grammar: TouchGrammar | null,
  prose: readonly string[],
): { hints: LocalHints; files: ChangedFile[] } {
  const extensions = new Set<string>();
  const packages = new Set<string>();
  for (const { path } of changes) {
    const ext = extensionOf(path);
    if (ext) extensions.add(ext);
    const dir = path.split("/")[0];
    if (dir && dir !== path) extensions.add(dir.toLowerCase());
  }

  const added = addedByFile(diff);
  const byRecency = changes
    .filter((change) => change.status !== "deleted")
    .map((change) => {
      try {
        return { change, mtime: statSync(join(root, change.path)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { change: Change; mtime: number } => entry !== null)
    .toSorted((a, b) => b.mtime - a.mtime);
  const files: ChangedFile[] = [];
  for (const [index, { change }] of byRecency.entries()) {
    const isNew = change.status === "added";
    const text =
      index < MAX_FILES_READ && deadline.remaining() > 0
        ? readHead(join(root, change.path), isNew ? MAX_NEW_FILE_BYTES : MAX_BYTES_PER_FILE)
        : "";
    for (const spec of importSpecifiers(text)) packages.add(spec);
    const lines = text.split("\n");
    files.push({
      path: change.path,
      status: change.status,
      ...(isNew ? { added: lines } : { added: added.get(change.path) ?? [], head: lines }),
    });
  }
  for (const change of changes) {
    if (change.status === "deleted") files.push({ ...change, added: [] });
  }

  for (const dep of manifestDeps(cwd)) packages.add(dep);
  if (root !== cwd) for (const dep of manifestDeps(root)) packages.add(dep);

  const touched =
    grammar === null ? [] : touchedFor(grammar, loadClassifier(), files, deadline, prose);

  const vocabulary = grammar ?? EMPTY_GRAMMAR;
  return {
    hints: {
      packages: knownPackages(vocabulary, [...packages]).slice(0, MAX_PACKAGES_SENT),
      extensions: knownExtensions(vocabulary, [...extensions]).slice(0, MAX_EXTENSIONS_SENT),
      touched,
    },
    files,
  };
}

export async function inferSession(
  cwd: string,
  budgetMs = INFER_BUDGET_MS,
  grammar: TouchGrammar | null = null,
  prose: readonly string[] = [],
  previous?: Pushed,
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
  const listed: Change[] =
    scan === null
      ? statusChanges(changedRaw)
      : scan.files.filter(isSafeRepoPath).map((path) => ({ path, status: "added" }));

  const snapshot: Record<string, string> = {};
  for (const change of listed) snapshot[change.path] = stampOf(root, change.path);
  const since = previous?.snapshot;
  const changes =
    since === undefined
      ? listed
      : listed.filter((change) => since[change.path] !== snapshot[change.path]);

  const tracked = changes.filter((c) => c.status === "modified").map((c) => c.path);
  const diff =
    grammar && tracked.length > 0 && deadline.remaining() > 20
      ? await runGit(
          root,
          [
            "-c",
            "core.quotepath=off",
            "diff",
            "--no-color",
            "--unified=0",
            "--no-ext-diff",
            "HEAD",
            "--",
            ...tracked,
          ],
          Math.min(deadline.remaining(), budgetMs * 0.3),
        )
      : "";

  const mark =
    inRepo === null ? (scan?.mark ?? null) : fingerprint(`${changedRaw}|${String(diff.length)}`);
  if (mark !== null && mark === previous?.mark) {
    return { hints: NOTHING, mark, snapshot, unchanged: true, files: [] };
  }
  return {
    ...hintsOf(root, cwd, changes, diff, deadline, grammar, prose),
    mark,
    snapshot,
    unchanged: false,
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
  if (root === null || !COMMIT_HASH.test(hash)) {
    return { hints: NOTHING, mark: null, snapshot: {}, unchanged: false, files: [] };
  }
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
            "-c",
            "core.quotepath=off",
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
  const changes = changed.map((path): Change => ({ path, status: "modified" }));
  return {
    ...hintsOf(root, cwd, changes, diff, deadline, grammar, []),
    mark: fingerprint(`${hash}|${changedRaw}`),
    snapshot: {},
    unchanged: false,
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
