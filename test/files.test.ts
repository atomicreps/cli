import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeFileAtomic } from "../src/files.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atomicreps-files-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("writeFileAtomic mode preservation", () => {
  it("keeps an existing restrictive mode when mode is omitted", () => {
    const target = join(dir, "settings.json");
    writeFileSync(target, "{}", { mode: 0o600 });

    writeFileAtomic(target, '{"updated":true}');

    expect(readFileSync(target, "utf8")).toBe('{"updated":true}');
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it("still honors an explicit mode over the existing one", () => {
    const target = join(dir, "settings.json");
    writeFileSync(target, "{}", { mode: 0o600 });

    writeFileAtomic(target, '{"updated":true}', 0o644);

    expect(statSync(target).mode & 0o777).toBe(0o644);
  });

  it("falls back to the umask default for a brand-new file with no mode given", () => {
    const target = join(dir, "new-file.json");

    writeFileAtomic(target, '{"fresh":true}');

    expect(readFileSync(target, "utf8")).toBe('{"fresh":true}');
    expect(statSync(target)).toBeDefined();
  });
});
