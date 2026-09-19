import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_SCAN_FILES } from "../src/constants.js";
import { inferCommit, inferHints, inferSession } from "../src/infer.js";
import type { TouchGrammar } from "../src/types.js";

const KNOWS: TouchGrammar = {
  version: "vocab",
  paths: [],
  words: [],
  vocabulary: {
    handles: [],
    packages: ["hono", "react"],
    extensions: ["ts", "py", "pyc", "png", "claude outputs", "passwd", "etc"],
  },
};

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
      const hints = await inferHints(dir, 150, KNOWS);
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
    const hints = await inferHints(dir, 2000, KNOWS);
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
      vocabulary: { handles: [], packages: [], extensions: [] },
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
    mkdirSync(join(dir, ".git"), { recursive: true });
    stubGit(dir);
    const previousPath = process.env.PATH;
    process.env.PATH = `${join(dir, "bin")}:${previousPath}`;
    try {
      const hints = await inferHints(dir, 5000, KNOWS);
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
      const fromSub = await inferHints(sub, 5000, KNOWS);
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
      const hints = await inferHints(root, 5000, KNOWS);
      expect(hints.extensions).not.toContain("passwd");
      expect(hints.extensions.some((e) => e.includes("etc"))).toBe(false);
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

describe("a folder that is not a repository", () => {
  function coursework(): string {
    const dir = mkdtempSync(join(tmpdir(), "atomicreps-class-"));
    writeFileSync(join(dir, "linked_list.py"), "class Node:\n    pass\n");
    writeFileSync(join(dir, "README.md"), "assignment 2\n");
    mkdirSync(join(dir, "__pycache__"));
    writeFileSync(join(dir, "__pycache__", "junk.pyc"), "x");
    return dir;
  }

  it("still sees what a student is working on, and skips the toolchain's leavings", async () => {
    const session = await inferSession(coursework(), 200, KNOWS);
    expect(session.hints.extensions).toContain("py");
    expect(session.hints.extensions).not.toContain("pyc");
    expect(session.mark, "a folder it could read is a folder it can mark").not.toBeNull();
  });

  it("marks the same folder the same way, and differently once a file moves", async () => {
    const dir = coursework();
    const first = await inferSession(dir, 200);
    expect((await inferSession(dir, 200)).mark).toBe(first.mark);

    writeFileSync(join(dir, "linked_list.py"), "class Node:\n    def pop(self): pass\n");
    expect((await inferSession(dir, 200)).mark).not.toBe(first.mark);
  });

  it("refuses rather than half-reads a folder past its limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atomicreps-big-"));
    for (let i = 0; i < MAX_SCAN_FILES + 100; i += 1) {
      writeFileSync(join(dir, `f${String(i)}.txt`), "x");
    }
    expect((await inferSession(dir, 500)).mark).toBeNull();
  });
});

describe("a commit rather than the working tree", () => {
  async function committed(): Promise<{ dir: string; hash: string }> {
    const dir = mkdtempSync(join(tmpdir(), "atomicreps-commit-"));
    const { execSync } = await import("node:child_process");
    const git = (cmd: string) =>
      execSync(`git -c user.email=t@t -c user.name=t ${cmd}`, { cwd: dir, encoding: "utf8" });
    git("init -q");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { react: "19" } }));
    git("add -A && git -c user.email=t@t -c user.name=t commit -q -m base");
    writeFileSync(
      join(dir, "server.ts"),
      'import { Hono } from "hono";\nexport const app = new Hono();\n',
    );
    git("add -A && git -c user.email=t@t -c user.name=t commit -q -m work");
    return { dir, hash: git("rev-parse HEAD").trim() };
  }

  it("finds the committed work the clean tree no longer shows", async () => {
    const { dir, hash } = await committed();
    const tree = await inferSession(dir, 2000, KNOWS);
    expect(tree.hints.extensions).not.toContain("ts");
    const commit = await inferCommit(dir, hash, 2000, KNOWS);
    expect(commit.hints.extensions).toContain("ts");
    expect(commit.hints.packages[0]).toBe("hono");
    expect(commit.mark).not.toBeNull();
    expect((await inferCommit(dir, hash, 2000, KNOWS)).mark).toBe(commit.mark);
  });

  it("refuses a hash that is not one before it can reach git", async () => {
    const { dir } = await committed();
    const session = await inferCommit(dir, "--output=/tmp/x", 2000, KNOWS);
    expect(session.mark).toBeNull();
    expect(session.hints.touched).toEqual([]);
  });
});
