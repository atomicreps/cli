import { join } from "node:path";

import { readJsonFile } from "./files.js";

const MANIFEST = join(import.meta.dirname, "..", "package.json");

function readVersion(): string {
  const version = readJsonFile<{ version?: unknown }>(MANIFEST)?.version;
  return typeof version === "string" ? version : "0.0.0";
}

export const SERVER_VERSION = readVersion();
