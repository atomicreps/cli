import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

import * as clock from "./clock.js";
import {
  INFER_BUDGET_MS,
  MAX_BYTES_PER_FILE,
  MAX_CHANGED,
  MAX_DIFF_BYTES,
  MAX_EXTENSIONS_SENT,
  MAX_FILES_READ,
  MAX_IMPORTS_PER_FILE,
  MAX_MANIFEST_DEPS,
  MAX_PACKAGES_SENT,
  MAX_ROOT_HOPS,
} from "./constants.js";
import { applyGrammar } from "./touch.js";
import type { LocalHints, TouchGrammar } from "./types.js";

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
    const parsed = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Object.keys({ ...parsed.dependencies, ...parsed.devDependencies }).slice(
      0,
      MAX_MANIFEST_DEPS,
    );
  } catch {
    return [];
  }
}

function isSafeRepoPath(entry: string): boolean {
  if (entry.length === 0 || entry.length > 1024) return false;
  if (entry.startsWith("/") || entry.includes("..")) return false;
  return !/[\u0000-\u001f]/.test(entry);
}

function repoRoot(cwd: string): string {
  let dir = cwd;
  for (let hops = 0; hops < MAX_ROOT_HOPS; hops++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
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

export async function inferHints(
  cwd: string,
  budgetMs = INFER_BUDGET_MS,
  grammar: TouchGrammar | null = null,
): Promise<LocalHints> {
  const deadline = clock.deadline(budgetMs);

  const root = repoRoot(cwd);

  const changedRaw = await runGit(
    cwd,
    ["status", "--porcelain", "-z", "--untracked-files=all", "--no-renames"],
    Math.min(deadline.remaining(), budgetMs * 0.4),
  );
  const changed = changedRaw
    .split("\0")
    .map((entry) => entry.slice(3).trim())
    .filter(isSafeRepoPath)
    .slice(0, MAX_CHANGED);

  const extensions = new Set<string>();
  const packages = new Set<string>();
  for (const file of changed) {
    const ext = extensionOf(file);
    if (ext) extensions.add(ext);
    const dir = file.split("/")[0];
    if (dir && dir !== file) extensions.add(dir.toLowerCase());
  }

  const diff =
    grammar && changed.length > 0 && deadline.remaining() > 20
      ? await runGit(
          root,
          ["diff", "--no-color", "--unified=0", "--no-ext-diff", "HEAD", "--", ...changed],
          Math.min(deadline.remaining(), budgetMs * 0.3),
        )
      : "";

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

  return {
    packages: [...packages].slice(0, MAX_PACKAGES_SENT),
    extensions: [...extensions].slice(0, MAX_EXTENSIONS_SENT),
    touched,
  };
}
