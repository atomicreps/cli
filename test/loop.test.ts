import { describe, expect, it } from "vitest";

import { stripAnsi } from "../src/ansi.js";
import { ART_WIDTH } from "../src/constants.js";
import { loopArt } from "../src/loop.js";
import type { LoopPose } from "../src/types.js";

const POSES: LoopPose[] = ["idle", "thinking", "impressed", "facepalm", "celebrating", "sleeping"];

function width(row: string): number {
  return [...stripAnsi(row)].length;
}

describe("loopArt", () => {
  it("draws every pose at the same width", () => {
    for (const pose of POSES) {
      for (const [i, row] of loopArt(pose).entries()) {
        expect(width(row), `${pose} row ${i}`).toBe(ART_WIDTH);
      }
    }
  });
});
