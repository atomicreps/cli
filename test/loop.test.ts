import { describe, expect, it } from "vitest";

import { stripAnsi } from "../src/ansi.js";
import { ART_WIDTH } from "../src/constants.js";
import { LOOP_ART, PALETTE, SIZES, type LoopVariant } from "../src/loop-art.js";
import { eyeWidth, loopArt, loopPixels, PIXEL_FACES } from "../src/loop.js";
import type { LoopPose } from "../src/types.js";

const POSES: LoopPose[] = ["idle", "thinking", "impressed", "facepalm", "celebrating", "sleeping"];
const VARIANTS: LoopVariant[] = ["small", "home"];

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

describe("loopPixels", () => {
  it("draws every pose and size at the width its grid declares", () => {
    for (const pose of POSES) {
      for (const variant of VARIANTS) {
        for (const [i, row] of loopPixels(pose, variant, { deep: true }).entries()) {
          expect(width(row), `${pose}/${variant} row ${i}`).toBe(SIZES[variant].w);
        }
      }
    }
  });

  it("prints two pixels to a cell, so a grid is half as many rows as it is tall", () => {
    for (const pose of POSES) {
      for (const variant of VARIANTS) {
        expect(loopPixels(pose, variant).length).toBe(Math.ceil(SIZES[variant].h / 2));
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

  it("gives every pose a face, because eyes do not survive the reduce", () => {
    for (const pose of POSES) {
      for (const variant of VARIANTS) {
        const anchors = LOOP_ART[pose][variant].anchors;
        expect(Object.keys(anchors).toSorted(), `${pose}/${variant}`).toEqual([
          "eyeL",
          "eyeR",
          "mouth",
        ]);
        for (const [name, [cx, cy]] of Object.entries(anchors)) {
          expect(Math.round(cx), `${pose}/${variant} ${name} x`).toBeGreaterThanOrEqual(0);
          expect(Math.round(cx), `${pose}/${variant} ${name} x`).toBeLessThan(SIZES[variant].w);
          expect(Math.round(cy / 2), `${pose}/${variant} ${name} y`).toBeLessThan(
            Math.ceil(SIZES[variant].h / 2),
          );
        }
      }
    }
  });

  it("keeps every painted face inside the grid it is drawn on", () => {
    for (const variant of VARIANTS) {
      for (const pose of POSES) {
        const face = PIXEL_FACES[variant][pose];
        const grid = LOOP_ART[pose][variant];
        const where = `${pose}/${variant}`;

        const columns = face.mouth[0]?.length ?? 0;
        for (const line of face.mouth) expect(line.length, where).toBe(columns);

        const left = Math.round(grid.anchors.eyeL![0] * 2) >> 1;
        const right = Math.round(grid.anchors.eyeR![0] * 2) >> 1;
        const row = Math.round(grid.anchors.eyeL![1]) >> 1;
        const wide = eyeWidth(face);
        for (const side of [face.eyes.left, face.eyes.right]) {
          for (const cells of side) expect(cells.length, `${where} eye width`).toBe(wide);
        }
        expect(left - wide, `${where} cheek off the left`).toBeGreaterThanOrEqual(0);
        expect(right + wide, `${where} cheek off the right`).toBeLessThan(grid.w);
        expect(left * 2 - 2, `${where} mouth off the left`).toBeGreaterThanOrEqual(0);
        expect(left * 2 - 2 + columns, `${where} mouth off the right`).toBeLessThanOrEqual(
          grid.w * 2,
        );
        const under = (row + face.eyes.left.length) * 2;
        expect(under + face.mouth.length, `${where} mouth off the bottom`).toBeLessThanOrEqual(
          grid.h,
        );
      }
    }
  });

  it("blinks without changing a single column", () => {
    const open = loopPixels("idle", "home").map(width);
    const shut = loopPixels("idle", "home", { blink: true }).map(width);
    expect(shut).toEqual(open);
  });
});

describe("the baked art", () => {
  it("carries one byte per pixel for every pose and size", () => {
    for (const pose of POSES) {
      for (const variant of VARIANTS) {
        const grid = LOOP_ART[pose][variant];
        const bytes = Buffer.from(grid.data, "base64");
        expect(bytes.length, `${pose}/${variant}`).toBe(grid.w * grid.h);
      }
    }
  });

  it("holds a palette of parsable six-digit colours", () => {
    expect(PALETTE.length).toBeGreaterThan(0);
    expect(PALETTE.length).toBeLessThan(256);
    for (const hex of PALETTE) expect(hex).toMatch(/^[0-9a-f]{6}$/);
  });

  it("never indexes past the palette", () => {
    for (const pose of POSES) {
      for (const variant of VARIANTS) {
        for (const byte of Buffer.from(LOOP_ART[pose][variant].data, "base64")) {
          expect(byte, `${pose}/${variant}`).toBeLessThanOrEqual(PALETTE.length);
        }
      }
    }
  });
});
