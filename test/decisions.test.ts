import { describe, expect, it } from "vitest";

import { describeDecision, sentFields } from "../src/decisions.js";

describe("the decision a rep call records", () => {
  it("keeps what was sent, strongest first, over what the tree read", () => {
    const fields = sentFields(
      {
        touched: [
          { key: "graphql.caching_batching", weight: 3 },
          { key: "sql.optimization", weight: 10 },
        ],
        named: [],
        unmatched: 0,
      },
      undefined,
    );
    expect(fields.top?.map((e) => e.key)).toEqual(["sql.optimization", "graphql.caching_batching"]);
  });

  it("says which catalog words the phrases matched and how many matched none", () => {
    const line = describeDecision({
      at: 0,
      via: "tool",
      outcome: "shown",
      named: [{ match: "query optimization", key: "sql.optimization", weight: 10 }],
      unmatched: 2,
    });
    expect(line).toContain("query optimization → sql.optimization 10");
    expect(line).toContain("2 matched no catalog word");
  });
});
