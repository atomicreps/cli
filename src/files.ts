import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";

import { DIR_MODE } from "./constants.js";
import { isRecord } from "./types.js";

export function readJsonFile<T>(path: string): T | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: DIR_MODE });
}

function scratch(path: string): Disposable {
  return {
    [Symbol.dispose]: () => {
      if (existsSync(path)) rmSync(path, { force: true });
    },
  };
}

function existingMode(path: string): number | undefined {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return undefined;
  }
}

export function writeFileAtomic(path: string, text: string, mode?: number): void {
  const temporary = `${path}.${process.pid}.tmp`;
  using _temp = scratch(temporary);
  const keep = mode ?? existingMode(path);
  writeFileSync(temporary, text, keep === undefined ? {} : { mode: keep });
  if (keep !== undefined) {
    try {
      chmodSync(temporary, keep);
    } catch {
    }
  }
  renameSync(temporary, path);
}

export function writeJsonAtomic(path: string, value: unknown, mode?: number): void {
  writeFileAtomic(path, JSON.stringify(value, null, 2), mode);
}
