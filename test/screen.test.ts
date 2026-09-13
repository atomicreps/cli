import { describe, expect, it } from "vitest";

import { visibleWidth, wrap } from "../src/ansi.js";
import { ART_GUTTER } from "../src/constants.js";
import { COPY_WIDTH, TEXT_WIDTH, withLoop, WIDTH } from "../src/screen.js";

const LONG =
  "Nothing on this screen has happened yet. Enter does exactly the rows you tick, and nothing else on this machine changes.";

describe("nothing is wider than the terminal", () => {
  it("leaves room for the gutter it will be indented by", () => {
    expect(COPY_WIDTH + ART_GUTTER).toBeLessThanOrEqual(WIDTH);
  });

  it("keeps copy beside Loop inside the width, art rows and copy rows alike", () => {
    for (const line of withLoop("idle", wrap(LONG, COPY_WIDTH))) {
      expect(visibleWidth(line), line).toBeLessThanOrEqual(WIDTH);
    }
  });

  it("would not fit at the full text width, which is why COPY_WIDTH exists", () => {
    const widest = withLoop("idle", wrap(LONG, TEXT_WIDTH)).reduce(
      (n, line) => Math.max(n, visibleWidth(line)),
      0,
    );
    expect(widest).toBeGreaterThan(WIDTH);
  });
});
