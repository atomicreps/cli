import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { MAX_ROOT_HOPS } from "./constants.js";

export function findRepoRoot(cwd: string): string | null {
  let dir = cwd;
  for (let hops = 0; hops < MAX_ROOT_HOPS; hops++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function projectOf(cwd: string): string {
  const start = resolve(cwd);
  return findRepoRoot(start) ?? start;
}
