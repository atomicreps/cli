import { describe, expect, it } from "vitest";

import {
  draftFrom,
  pickedFrom,
  selectionLine,
  toggleRow,
  treeRows,
  type TreeGroup,
} from "../src/tree.js";

const GROUPS: TreeGroup[] = [
  {
    slug: "frontend",
    name: "Frontend",
    children: [
      { slug: "javascript", name: "JavaScript" },
      { slug: "css", name: "CSS" },
      { slug: "react", name: "React" },
    ],
  },
  {
    slug: "backend",
    name: "Backend",
    children: [
      { slug: "postgres", name: "PostgreSQL" },
      { slug: "node", name: "Node.js runtime" },
    ],
  },
];

const ALL_FRONTEND = ["javascript", "css", "react"];

function rowsOf(open: string[], picked: string[] = [], filter = "") {
  return treeRows(GROUPS, new Set(open), new Set(picked), filter);
}

describe("what the door is sent", () => {
  it("whole areas stay areas, so the pick follows the catalog as it grows", () => {
    expect(draftFrom(GROUPS, new Set(ALL_FRONTEND))).toEqual({
      prefer: ["frontend"],
      topics: [],
    });
  });

  it("one partial area expands every other area too", () => {
    const picked = new Set([...ALL_FRONTEND, "postgres"]);
    const draft = draftFrom(GROUPS, picked);
    expect(draft.prefer).toEqual(["frontend", "backend"]);
    expect(draft.topics.toSorted()).toEqual(["css", "javascript", "postgres", "react"]);
  });

  it("nothing picked is the whole catalog, not an empty one", () => {
    expect(draftFrom(GROUPS, new Set())).toEqual({ prefer: [], topics: [] });
  });

  it("a topic the catalog no longer has never reaches the door", () => {
    expect(draftFrom(GROUPS, new Set(["css", "retired-topic"])).topics).toEqual(["css"]);
  });
});

describe("reading a stored selection back", () => {
  it("a stored topic list is the whole answer, as the door reads it", () => {
    expect([...pickedFrom(GROUPS, ["frontend", "backend"], ["css"])]).toEqual(["css"]);
  });

  it("stored areas expand only when no topic is stored", () => {
    expect([...pickedFrom(GROUPS, ["backend"], [])].toSorted()).toEqual(["node", "postgres"]);
  });

  it("a whole-area pick survives the round trip", () => {
    const first = draftFrom(GROUPS, new Set(ALL_FRONTEND));
    expect([...pickedFrom(GROUPS, first.prefer, first.topics)].toSorted()).toEqual(
      ALL_FRONTEND.toSorted(),
    );
  });

  it("a partial pick survives the round trip", () => {
    const picked = new Set(["css", "postgres"]);
    const first = draftFrom(GROUPS, picked);
    expect([...pickedFrom(GROUPS, first.prefer, first.topics)].toSorted()).toEqual([
      "css",
      "postgres",
    ]);
  });
});

describe("the rows on screen", () => {
  it("a closed area hides its topics", () => {
    expect(rowsOf([]).map((row) => row.kind)).toEqual(["group", "group"]);
  });

  it("an open area shows them under it", () => {
    expect(rowsOf(["backend"]).map((row) => row.kind)).toEqual([
      "group",
      "group",
      "child",
      "child",
    ]);
  });

  it("a filter opens every surviving area, closed or not", () => {
    const rows = rowsOf([], [], "post");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.kind === "group" && rows[0].group.slug).toBe("backend");
    expect(rows[1]?.kind === "child" && rows[1].child.slug).toBe("postgres");
  });

  it("the filter ignores spacing and case, so `nodejs` finds `Node.js runtime`", () => {
    const rows = rowsOf([], [], "nodejs");
    expect(rows.some((row) => row.kind === "child" && row.child.slug === "node")).toBe(true);
  });

  it("an area whose own name matches keeps all of its topics", () => {
    const rows = rowsOf([], [], "frontend");
    expect(rows.filter((row) => row.kind === "child")).toHaveLength(3);
  });

  it("a filter that matches nothing leaves no rows to toggle", () => {
    expect(rowsOf([], [], "kubernetes")).toEqual([]);
  });
});

describe("space on a row", () => {
  it("an area row takes all of it, then gives all of it back", () => {
    const group = rowsOf([])[0];
    if (group === undefined) throw new Error("no group row");
    const on = toggleRow(group, new Set());
    expect([...on].toSorted()).toEqual(ALL_FRONTEND.toSorted());
    expect([...toggleRow(rowsOf([], [...on])[0]!, on)]).toEqual([]);
  });

  it("an area holding some topics fills up rather than emptying", () => {
    const group = rowsOf([], ["css"])[0];
    if (group === undefined) throw new Error("no group row");
    expect([...toggleRow(group, new Set(["css"]))].toSorted()).toEqual(ALL_FRONTEND.toSorted());
  });

  it("under a filter an area row reaches only the topics it is showing", () => {
    const group = rowsOf([], [], "css")[0];
    if (group === undefined) throw new Error("no group row");
    expect([...toggleRow(group, new Set())]).toEqual(["css"]);
  });
});

describe("the line under the tree", () => {
  it("is not ready to leave while nothing is picked, and says so in the same line", () => {
    expect(selectionLine(GROUPS, new Set()).ready).toBe(false);
    expect(selectionLine(GROUPS, new Set(["css"])).ready).toBe(true);
  });

  it("asks for an area when nothing is picked rather than describing a default", () => {
    expect(selectionLine(GROUPS, new Set()).text).toContain("at least one area");
  });

  it("promises new topics only when the areas are whole", () => {
    expect(selectionLine(GROUPS, new Set(ALL_FRONTEND)).text).toContain("as they are added");
    expect(selectionLine(GROUPS, new Set(["css"])).text).not.toContain("as they are added");
  });

  it("counts the topics that will actually serve, not the ones ticked by hand", () => {
    expect(selectionLine(GROUPS, new Set([...ALL_FRONTEND, "postgres"])).text).toContain(
      "4 topics",
    );
  });
});
