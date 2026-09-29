import { describe, expect, it } from "vitest";

import { deadline } from "../src/clock.js";
import { MAX_WEIGHT, PHRASE_WEIGHT } from "../src/constants.js";
import {
  knownExtensions,
  knownHandle,
  knownPackages,
  parseGrammar,
  resolvePhrases,
  resolveTopic,
  scoreFiles,
} from "../src/touch.js";
import type { TouchGrammar } from "../src/types.js";

const RAW = {
  version: "v1",
  paths: [{ pattern: "(^|/)dockerfile$", key: "docker.dockerfile", weight: 3 }],
  words: [
    { words: "useeffect cleanup", key: "react.effects", weight: 2 },
    { words: "mutable default", key: "python.mutable_defaults", weight: 3 },
  ],
  vocabulary: {
    handles: ["react", "react.effects", "python.mutable_defaults"],
    packages: ["react", "postgres", "docker"],
    extensions: ["ts", "tsx", "dockerfile", "migrations"],
  },
};

function grammarOf(patch: Record<string, unknown> = {}): TouchGrammar {
  const parsed = parseGrammar({ ...RAW, ...patch });
  if (parsed === null) throw new Error("the fixture must parse");
  return parsed;
}

describe("parsing the vocabulary", () => {
  it("a grammar from before the vocabulary existed still parses, with nothing in it", () => {
    const parsed = parseGrammar({ version: "old", paths: [], words: [] });
    expect(parsed?.vocabulary).toEqual({ handles: [], packages: [], extensions: [] });
  });

  it("drops an entry that is not a short string rather than refusing the grammar", () => {
    const parsed = parseGrammar({
      ...RAW,
      vocabulary: { handles: ["react", 7, "", "x".repeat(500)], packages: "nope", extensions: [] },
    });
    expect(parsed?.vocabulary.handles).toEqual(["react"]);
    expect(parsed?.vocabulary.packages).toEqual([]);
  });
});

describe("the agent's own phrases", () => {
  it("resolves a phrase a word rule matches to that handle, at the phrase weight", () => {
    expect(resolvePhrases(grammarOf(), ["useEffect cleanup"])).toEqual([
      { key: "react.effects", weight: PHRASE_WEIGHT },
    ]);
  });

  it("a line of source matches nothing and leaves nothing", () => {
    expect(resolvePhrases(grammarOf(), ["def add(x, xs=[]):"])).toEqual([]);
  });

  it("a phrase that is itself a handle passes; one that only looks like a handle does not", () => {
    expect(resolvePhrases(grammarOf(), ["python.mutable_defaults"])[0]?.key).toBe(
      "python.mutable_defaults",
    );
    expect(resolvePhrases(grammarOf(), ["python.made_up"])).toEqual([]);
  });

  it("keeps one entry per handle, whichever phrase found it first", () => {
    const entries = resolvePhrases(grammarOf(), ["useEffect cleanup", "useEffect cleanup again"]);
    expect(entries).toHaveLength(1);
  });

  it("with no vocabulary and no rules there is nothing to resolve against", () => {
    const bare = parseGrammar({ version: "old", paths: [], words: [] });
    expect(resolvePhrases(bare as TouchGrammar, ["react.effects"])).toEqual([]);
  });
});

describe("the free-text topic", () => {
  it("keeps the catalog words and drops the sentence around them", () => {
    expect(resolveTopic(grammarOf(), "customer fraud scoring in react and postgres")).toBe(
      "react postgres",
    );
  });

  it("is nothing at all when no word is in the catalog", () => {
    expect(resolveTopic(grammarOf(), "customer fraud scoring in checkout")).toBeUndefined();
  });
});

describe("package and extension names", () => {
  it("sends the alias word a private name resolves through, never the private name", () => {
    expect(knownPackages(grammarOf(), ["@acme/react-internal"])).toEqual(["react"]);
  });

  it("drops a name whose head the catalog does not know", () => {
    expect(knownPackages(grammarOf(), ["@acme/project-apollo"])).toEqual([]);
  });

  it("drops everything when the vocabulary is empty", () => {
    const bare = parseGrammar({ version: "old", paths: [], words: [] }) as TouchGrammar;
    expect(knownPackages(bare, ["react", "postgres"])).toEqual([]);
    expect(knownExtensions(bare, ["ts"])).toEqual([]);
  });

  it("normalizes an extension before checking it, and sends the normalized form", () => {
    expect(knownExtensions(grammarOf(), [".TS", "Dockerfile", "secretstuff"])).toEqual([
      "ts",
      "dockerfile",
    ]);
  });

  it("keeps a handle the catalog publishes and refuses one it does not", () => {
    expect(knownHandle(grammarOf(), " React.Effects ")).toBe("react.effects");
    expect(knownHandle(grammarOf(), "react.made_up")).toBeUndefined();
  });
});

describe("scoring the changed files", () => {
  const SCORING = {
    version: "s1",
    paths: [{ pattern: "\\.sql$", key: "sql", weight: 2 }],
    words: [
      { words: "await ", key: "csharp.async", weight: 3, langs: ["cs"] },
      { words: "create index", key: "sql.indexing", weight: 3 },
      { words: "Contrast Ratio", key: "a11y.contrast", weight: 3 },
      { words: "useeffect", key: "react.hooks", weight: 3, langs: ["tsx"] },
    ],
    vocabulary: { handles: [], packages: [], extensions: [] },
  };
  const grammar = parseGrammar(SCORING) as TouchGrammar;
  const open = deadline(60_000);

  it("lowercases rules and keeps the languages a rule is tagged with", () => {
    const contrast = grammar.words.find((rule) => rule.key === "a11y.contrast");
    expect(contrast?.words).toBe("contrast ratio");
    expect(grammar.words.find((rule) => rule.key === "csharp.async")?.langs).toEqual(["cs"]);
  });

  it("scores a language-tagged rule only inside a file of that language", () => {
    const line = ["rows = await conn.fetch(query)"];
    const py = scoreFiles(grammar, [{ path: "app.py", status: "modified", added: line }], open);
    const cs = scoreFiles(grammar, [{ path: "App.cs", status: "modified", added: line }], open);
    expect(py.map((e) => e.key)).not.toContain("csharp.async");
    expect(cs.map((e) => e.key)).toContain("csharp.async");
  });

  it("reads prose with the open rules, and with a tagged rule only when a file of its language changed", () => {
    const prose = ["The contrast ratio was 2:1. The useEffect ran twice."];
    const cssOnly = scoreFiles(
      grammar,
      [{ path: "a.css", status: "modified", added: [] }],
      open,
      prose,
    );
    expect(cssOnly.map((e) => e.key)).toEqual(["a11y.contrast"]);
    const withTsx = scoreFiles(
      grammar,
      [{ path: "a.tsx", status: "modified", added: [] }],
      open,
      prose,
    );
    expect(withTsx.map((e) => e.key).toSorted()).toEqual(["a11y.contrast", "react.hooks"]);
  });

  it("sends the strongest handle at the top weight and the rest in proportion", () => {
    const scored = scoreFiles(
      grammar,
      [{ path: "db/003.sql", status: "added", added: ["create index a on t (x);"] }],
      open,
    );
    expect(scored).toEqual([
      { key: "sql.indexing", weight: MAX_WEIGHT },
      { key: "sql", weight: Math.round((2 / 3) * MAX_WEIGHT) },
    ]);
  });

  it("does not read a deleted file's lines, only its path", () => {
    const scored = scoreFiles(
      grammar,
      [{ path: "old.sql", status: "deleted", added: ["create index a on t (x);"] }],
      open,
    );
    expect(scored.map((e) => e.key)).toEqual(["sql"]);
  });
});
