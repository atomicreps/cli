import { describe, expect, it } from "vitest";

import {
  type Classifier,
  classifyTouched,
  evidenceOf,
  logLikelihoodRatios,
  posterior,
  strongestFile,
  wordKey,
} from "../src/classify.js";
import { MAX_WEIGHT } from "../src/constants.js";

function table(temperature = 1): Classifier {
  return {
    version: "t",
    muSub: 10,
    muTopic: 10,
    lambda: 0.1,
    temperature,
    topics: ["sql", "csharp_async"],
    classes: ["sql.indexing", "csharp_async.tasks"],
    classTopic: [0, 1],
    classTokens: [100, 100],
    topicTokens: [100, 100],
    total: 200,
    words: {
      [wordKey("index")]: [40, [0, 40], [0, 40]],
      [wordKey("await")]: [40, [1, 40], [1, 40]],
      [wordKey("the")]: [120, [0, 60, 1, 60], [0, 60, 1, 60]],
    },
    langs: { csharp_async: ["cs"] },
  };
}

const everywhere = () => true;

describe("the classifier", () => {
  it("credits the class whose own word appears, and no class for a shared word", () => {
    const own = logLikelihoodRatios(table(), [
      { text: ["create index"], weight: 1, allows: everywhere },
    ]);
    expect(own[0]).toBeGreaterThan(own[1] ?? 0);
    const shared = logLikelihoodRatios(table(), [
      { text: ["the the the"], weight: 1, allows: everywhere },
    ]);
    expect(shared[0]).toBeCloseTo(shared[1] ?? 0, 10);
  });

  it("treats a word the corpus never saw as background for every class alike", () => {
    const scores = logLikelihoodRatios(table(), [
      { text: ["zyxwv"], weight: 1, allows: everywhere },
    ]);
    expect(scores[0]).toBeCloseTo(scores[1] ?? 0, 10);
  });

  it("reads a Python file as background for a C# class, whatever words it holds", () => {
    const files = [{ path: "app.py", status: "modified" as const, added: ["await await await"] }];
    const scores = logLikelihoodRatios(table(), evidenceOf(table(), files, []));
    expect(scores[1]).toBeLessThanOrEqual(scores[0] ?? 0);
    const inCs = [{ path: "App.cs", status: "modified" as const, added: ["await await await"] }];
    const csScores = logLikelihoodRatios(table(), evidenceOf(table(), inCs, []));
    expect(csScores[1]).toBeGreaterThan(csScores[0] ?? 0);
  });

  it("keeps the order and spreads the probability when the temperature rises", () => {
    const evidence = [{ text: ["index index"], weight: 1, allows: everywhere }];
    const sharp = posterior(table(1), evidence);
    const soft = posterior(table(8), evidence);
    expect(sharp.map((e) => e.key)).toEqual(soft.map((e) => e.key));
    expect(soft[0]?.p ?? 1).toBeLessThan(sharp[0]?.p ?? 0);
  });

  it("sends the leader at the top weight and the runner-up in proportion", () => {
    const files = [{ path: "db/003.sql", status: "added" as const, added: ["create index a"] }];
    const touched = classifyTouched(table(2), files, []);
    expect(touched[0]).toEqual({ key: "sql.indexing", weight: MAX_WEIGHT });
    for (const entry of touched.slice(1)) expect(entry.weight).toBeLessThan(MAX_WEIGHT);
  });

  it("sends nothing for a turn with no files and no prose", () => {
    expect(classifyTouched(table(), [], [])).toEqual([]);
  });
});

describe("the file behind a served handle", () => {
  it("names the changed file whose own lines favour the handle, and no file when none does", () => {
    const files = [
      { path: "notes.md", status: "modified" as const, added: ["the the"] },
      { path: "db/003.sql", status: "added" as const, added: ["create index a on t"] },
    ];
    expect(strongestFile(table(), files, "sql.indexing")).toBe("db/003.sql");
    expect(strongestFile(table(), files, "sql")).toBe("db/003.sql");
    expect(strongestFile(table(), files, "csharp_async.tasks")).toBeNull();
  });
});
