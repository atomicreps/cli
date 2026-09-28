import { describe, expect, it } from "vitest";

import { stripAnsi, to256 } from "../src/ansi.js";
import { ART_WIDTH, ART_WIDTH_WIDE } from "../src/constants.js";
import {
  IDLE_FRAMES,
  LOOP_ART,
  PALETTE,
  SIZES,
  type LoopFrame,
  type LoopVariant,
} from "../src/loop-art.js";
import { idleFrameAt, loopArt, loopGrid, loopPixels } from "../src/loop.js";
import type { LoopPose } from "../src/types.js";

const POSES: LoopPose[] = ["idle", "thinking", "impressed", "facepalm", "celebrating", "sleeping"];
const VARIANTS: LoopVariant[] = ["small", "home"];
const FRAMES: LoopFrame[] = ["blink", "bob"];

function width(row: string): number {
  return [...stripAnsi(row)].length;
}

function everyGrid(): Array<[string, LoopVariant, readonly string[]]> {
  const all: Array<[string, LoopVariant, readonly string[]]> = [];
  for (const variant of VARIANTS) {
    for (const pose of POSES) all.push([pose, variant, LOOP_ART[pose][variant]]);
    for (const frame of FRAMES) all.push([`idle ${frame}`, variant, IDLE_FRAMES[variant][frame]]);
  }
  return all;
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

describe("the hand-drawn grids", () => {
  it("are exactly the size their variant declares, every row", () => {
    for (const [name, variant, grid] of everyGrid()) {
      expect(grid.length, `${name}/${variant} rows`).toBe(SIZES[variant].h);
      for (const [i, row] of grid.entries()) {
        expect(row.length, `${name}/${variant} row ${i}`).toBe(SIZES[variant].w);
      }
    }
  });

  it("use only letters the palette has a colour for", () => {
    for (const [name, variant, grid] of everyGrid()) {
      for (const [i, row] of grid.entries()) {
        for (const letter of row) {
          if (letter === ".") continue;
          expect(PALETTE[letter]?.deep, `${name}/${variant} row ${i} letter ${letter}`).toMatch(
            /^#[0-9a-f]{6}$/,
          );
        }
      }
    }
  });

  it("give every letter a 256-colour stand-in the table holds exactly", () => {
    for (const [letter, { cube }] of Object.entries(PALETTE)) {
      const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(cube.slice(at, at + 2), 16));
      const index = to256(r!, g!, b!);
      const levels = [0, 95, 135, 175, 215, 255];
      const exact =
        index >= 232
          ? [8 + (index - 232) * 10, 8 + (index - 232) * 10, 8 + (index - 232) * 10]
          : [
              levels[Math.floor((index - 16) / 36)],
              levels[Math.floor((index - 16) / 6) % 6],
              levels[(index - 16) % 6],
            ];
      expect([r, g, b], `${letter} ${cube}`).toEqual(exact);
    }
  });

  it("fit the column the home screen reserves", () => {
    expect(SIZES.home.w).toBe(ART_WIDTH_WIDE);
    expect(SIZES.small.w).toBeLessThanOrEqual(ART_WIDTH);
  });
});

describe("loopPixels", () => {
  it("prints two pixels to a cell at the grid's width", () => {
    for (const pose of POSES) {
      for (const variant of VARIANTS) {
        const rows = loopPixels(pose, variant, { deep: true });
        expect(rows.length, `${pose}/${variant}`).toBe(SIZES[variant].h / 2);
        for (const [i, row] of rows.entries()) {
          expect(width(row), `${pose}/${variant} row ${i}`).toBe(SIZES[variant].w);
        }
      }
    }
  });

  it("is the same width whether the terminal takes deep colour or the cube", () => {
    for (const pose of POSES) {
      const deep = loopPixels(pose, "home", { deep: true }).map(width);
      const cube = loopPixels(pose, "home", { deep: false }).map(width);
      expect(cube, pose).toEqual(deep);
    }
  });

  it("swaps in an idle frame for idle only", () => {
    expect(loopGrid("idle", "home", "blink")).toBe(IDLE_FRAMES.home.blink);
    expect(loopGrid("sleeping", "home", "blink")).toBe(LOOP_ART.sleeping.home);
  });
});

describe("idleFrameAt", () => {
  it("blinks briefly once a cycle and bobs in between", () => {
    const frames = Array.from({ length: 34 }, (_, tick) => idleFrameAt(tick));
    expect(frames.filter((f) => f === "blink")).toHaveLength(2);
    expect(frames).toContain("bob");
    expect(frames).toContain(undefined);
  });
});

describe("to256", () => {
  it("maps a colour the 256-colour table holds to that entry", () => {
    expect(to256(95, 135, 175)).toBe(67);
    expect(to256(0, 0, 0)).toBe(16);
    expect(to256(128, 128, 128)).toBe(244);
  });

  it("keeps a dark navy blue rather than lifting it to teal", () => {
    const [r, g, b] = [0x0d, 0x22, 0x3d];
    const index = to256(r, g, b) - 16;
    expect(index % 6, "blue level").toBeGreaterThan(Math.floor(index / 6) % 6);
  });
});
