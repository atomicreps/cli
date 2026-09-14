import { join } from "node:path";

import { readJsonFile } from "./files.js";

const MANIFEST = join(import.meta.dirname, "..", "package.json");

function readVersion(): string {
  const version = readJsonFile<{ version?: unknown }>(MANIFEST)?.version;
  return typeof version === "string" ? version : "0.0.0";
}

export const SERVER_VERSION = readVersion();

function parts(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10));
}

export function isBehind(current: string, latest: string): boolean {
  const a = parts(current);
  const b = parts(latest);
  if (a.length !== 3 || b.length !== 3) return false;
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    const mine = a[i] ?? 0;
    const theirs = b[i] ?? 0;
    if (mine !== theirs) return mine < theirs;
  }
  return false;
}
