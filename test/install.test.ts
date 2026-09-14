import { describe, expect, it } from "vitest";

import { catalogTree, DEFAULT_DRAFT, draftLines, draftOf, patchOf } from "../src/install.js";
import type { DomainEntry, TopicEntry } from "../src/types.js";

const DOMAINS: DomainEntry[] = [
  { slug: "frontend", name: "Frontend" },
  { slug: "backend", name: "Backend" },
  { slug: "design", name: "Design & UI" },
];

const TOPICS: TopicEntry[] = [
  { slug: "javascript", name: "JavaScript", free: true, domain: "frontend" },
  { slug: "css", name: "CSS", free: true, domain: "frontend" },
  { slug: "postgres", name: "PostgreSQL", free: true, domain: "backend" },
  { slug: "orphan", name: "Orphan", free: true },
];

describe("the catalog as a tree", () => {
  it("keeps catalog order and nests the topics under their area", () => {
    const groups = catalogTree(DOMAINS, TOPICS);
    expect(groups.map((g) => g.slug)).toEqual(["frontend", "backend"]);
    expect(groups[0]?.children.map((c) => c.slug)).toEqual(["javascript", "css"]);
  });

  it("drops an area with no topics rather than showing an empty caret", () => {
    expect(catalogTree(DOMAINS, TOPICS).map((g) => g.slug)).not.toContain("design");
  });

  it("drops a topic with no area rather than inventing one for it", () => {
    const all = catalogTree(DOMAINS, TOPICS).flatMap((g) => g.children.map((c) => c.slug));
    expect(all).not.toContain("orphan");
  });
});

describe("the patch the door receives", () => {
  it("carries every answer and nothing else", () => {
    expect(
      patchOf({
        prefer: ["frontend"],
        topics: ["css"],
        strict: true,
        intensity: "intense",
        levels: { min: 2, max: 5 },
      }),
    ).toEqual({
      prefer: ["frontend"],
      topics: ["css"],
      strict: true,
      intensity: "intense",
      levels: { min: 2, max: 5 },
    });
  });
});

describe("a draft from the door's summary", () => {
  it("opens on what is set, so saving one screen cannot wipe another", () => {
    const draft = draftOf({
      prefer: ["frontend"],
      topics: ["css"],
      strict: true,
      intensity: "light",
      levels: { min: 2, max: 4 },
    });
    expect(draft).toEqual({
      prefer: ["frontend"],
      topics: ["css"],
      strict: true,
      intensity: "light",
      levels: { min: 2, max: 4 },
    });
  });

  it("falls back to the default, never to blank, for a field the door did not send", () => {
    const draft = draftOf({ prefer: ["backend"], intensity: "not-a-rate" });
    expect(draft.prefer).toEqual(["backend"]);
    expect(draft.topics).toEqual(DEFAULT_DRAFT.topics);
    expect(draft.strict).toBe(DEFAULT_DRAFT.strict);
    expect(draft.intensity).toBe(DEFAULT_DRAFT.intensity);
    expect(draft.levels).toEqual(DEFAULT_DRAFT.levels);
  });
});

describe("the summary screen", () => {
  it("names the areas rather than counting them", () => {
    const names = new Map(DOMAINS.map((d) => [d.slug, d.name]));
    const lines = draftLines({ ...DEFAULT_DRAFT, prefer: ["frontend", "backend"] }, names);
    expect(lines[0]).toBe("Areas: Frontend, Backend, whole.");
  });

  it("says the whole catalog when no area was picked, whatever else is set", () => {
    expect(draftLines(DEFAULT_DRAFT)[0]).toBe("Areas: the whole catalog.");
  });

  it("singular and plural both read as English", () => {
    const one = draftLines({ ...DEFAULT_DRAFT, prefer: ["frontend"], topics: ["css"] })[0];
    const two = draftLines({
      ...DEFAULT_DRAFT,
      prefer: ["frontend"],
      topics: ["css", "javascript"],
    })[0];
    expect(one).toContain("1 topic pinned");
    expect(two).toContain("2 topics pinned");
  });

  it("a single rung is not printed as a range", () => {
    expect(draftLines({ ...DEFAULT_DRAFT, levels: { min: 3, max: 3 } })[2]).toBe("Depth: level 3.");
    expect(draftLines({ ...DEFAULT_DRAFT, levels: { min: 1, max: 5 } })[2]).toBe(
      "Depth: levels 1 to 5.",
    );
  });
});
