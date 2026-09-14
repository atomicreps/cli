import { describe, expect, it } from "vitest";

import { PHRASE_WEIGHT } from "../src/constants.js";
import {
  knownExtensions,
  knownHandle,
  knownPackages,
  parseGrammar,
  resolvePhrases,
  resolveTopic,
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
