import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { inferHints } from "../src/infer.js";

describe("inferHints", () => {
  it("returns inside the budget even when git hangs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atomicreps-infer-"));
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "git"), "#!/bin/sh\nsleep 10\n", { mode: 0o755 });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { hono: "1" } }));
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath}`;
    try {
      const started = Date.now();
      const hints = await inferHints(dir, 150);
      expect(Date.now() - started).toBeLessThan(1500);
      expect(hints.packages).toContain("hono");
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("reads imports and extensions from a real repo's changed files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atomicreps-repo-"));
    const { execSync } = await import("node:child_process");
    execSync("git init -q", { cwd: dir });
    writeFileSync(
      join(dir, "server.ts"),
      'import { Hono } from "hono";\nexport const app = new Hono();\n',
    );
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { react: "19" } }));
    const hints = await inferHints(dir, 2000);
    expect(hints.extensions).toContain("ts");
    expect(hints.packages[0]).toBe("hono");
    expect(hints.packages).toContain("react");
  });

  it("with a grammar, paths and added lines become handles with weights, heaviest first", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atomicreps-touch-"));
    const { execSync } = await import("node:child_process");
    execSync(
      "git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init",
      {
        cwd: dir,
      },
    );
    writeFileSync(join(dir, "Dockerfile"), "FROM node:20\nCOPY package.json ./\nRUN npm ci\n");
    mkdirSync(join(dir, "db", "migrations"), { recursive: true });
    writeFileSync(join(dir, "db", "migrations", "001.sql"), "CREATE INDEX idx ON t (a);\n");
    const grammar = {
      version: "t",
      paths: [
        { pattern: "(^|/)dockerfile$", key: "docker.dockerfile", weight: 3 },
        {
          pattern: "(^|/)migrations/[^/]+\\.sql$",
          key: "data_modeling.migration_strategies",
          weight: 3,
        },
      ],
      words: [
        { words: "copy package.json", key: "docker.dockerfile", weight: 3 },
        { words: "create index", key: "sql.indexing", weight: 3 },
      ],
    };
    const hints = await inferHints(dir, 2000, grammar);
    const keys = hints.touched.map((t) => t.key);
    expect(keys[0]).toBe("docker.dockerfile");
    expect(keys).toContain("sql.indexing");
    expect(keys).toContain("data_modeling.migration_strategies");
    for (const entry of hints.touched) expect(entry.weight).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(hints)).not.toContain("CREATE INDEX");
    expect(JSON.stringify(hints)).not.toContain("migrations/001");
  });
});

describe("git paths that need quoting", () => {
  function stubGit(dir: string): void {
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "git"),
      [
        "#!/bin/sh",
        'case "$*" in',
        "  *status*-z*) printf '?? Claude outputs/note.png\\0 M src/app.ts\\0' ;;",
        "  *status*) printf '?? \"Claude outputs/note.png\"\\n M src/app.ts\\n' ;;",
        "  *) printf '' ;;",
        "esac",
      ].join("\n"),
      { mode: 0o755 },
    );
  }

  it("keeps quote characters out of the payload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atomicreps-quoted-"));
    stubGit(dir);
    const previousPath = process.env.PATH;
    process.env.PATH = `${join(dir, "bin")}:${previousPath}`;
    try {
      const hints = await inferHints(dir, 5000);
      for (const shape of hints.extensions) {
        expect(shape).not.toContain('"');
        expect(shape).not.toContain("\\");
      }
      expect(hints.extensions).toContain("claude outputs");
      expect(hints.extensions).toContain("png");
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

describe("running from a subdirectory of the repo", () => {
  it("reads changed files that git reported relative to the root", async () => {
    const root = mkdtempSync(join(tmpdir(), "atomicreps-root-"));
    const sub = join(root, "packages", "thing");
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(root, "src", "app.ts"), 'import { serve } from "hono";\n');

    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "git"),
      [
        "#!/bin/sh",
        'case "$*" in',
        `  *rev-parse*) printf '${root}\\n' ;;`,
        "  *status*) printf ' M src/app.ts\\0' ;;",
        "  *) printf '' ;;",
        "esac",
      ].join("\n"),
      { mode: 0o755 },
    );

    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath}`;
    try {
      const fromSub = await inferHints(sub, 5000);
      expect(fromSub.packages, "the import in the changed file must be found").toContain("hono");
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("keeps a path git would never emit away from the filesystem", async () => {
    const root = mkdtempSync(join(tmpdir(), "atomicreps-escape-"));
    mkdirSync(join(root, ".git"), { recursive: true });
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "git"),
      [
        "#!/bin/sh",
        'case "$*" in',
        `  *rev-parse*) printf '${root}\\n' ;;`,
        "  *status*) printf ' M ../../../etc/passwd\\0 M /etc/hosts\\0' ;;",
        "  *) printf '' ;;",
        "esac",
      ].join("\n"),
      { mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath}`;
    try {
      const hints = await inferHints(root, 5000);
      expect(hints.extensions).not.toContain("passwd");
      expect(hints.extensions.some((e) => e.includes("etc"))).toBe(false);
    } finally {
      process.env.PATH = previousPath;
    }
  });
});
