import { cell, COLOUR, deepColour, paint, type Rgb } from "./ansi.js";
import { LOOP_ART, PALETTE, type LoopVariant } from "./loop-art.js";
import type { LoopPose } from "./types.js";

export type { LoopVariant };

type GlyphFace = {
  eyes: string;
  mouth: string;
  blush: boolean;
};

const GLYPH_FACES: Readonly<Record<LoopPose, GlyphFace>> = {
  idle: { eyes: "◕   ◕", mouth: " ⌣ ", blush: true },
  thinking: { eyes: "◔   ◕", mouth: " ~ ", blush: false },
  impressed: { eyes: "◉   ◉", mouth: " ○ ", blush: true },
  facepalm: { eyes: "⌣   ⌣", mouth: " ⌒ ", blush: false },
  celebrating: { eyes: "⌢   ⌢", mouth: " ○ ", blush: true },
  sleeping: { eyes: "‿   ‿", mouth: " ᴗ ", blush: false },
};

type FacePaint = "shine" | "ink" | "blush" | "skin";

type FaceCell = {
  readonly glyph: string;
  readonly fg: FacePaint;
  readonly bg: FacePaint;
};

type EyeRow = readonly FaceCell[];
type EyePair = { readonly left: readonly EyeRow[]; readonly right: readonly EyeRow[] };

type PixelFace = {
  readonly eyes: EyePair;
  readonly brows?: EyePair;
  readonly mouth: readonly string[];
  readonly blush?: boolean;
};

const ink = (glyph: string): FaceCell => ({ glyph, fg: "ink", bg: "skin" });
const both = (rows: readonly EyeRow[]): EyePair => ({ left: rows, right: rows });

const IRIS: FaceCell = { glyph: "█", fg: "ink", bg: "ink" };
const LIDDED: FaceCell = { glyph: "▀", fg: "ink", bg: "shine" };
const SPARK: FaceCell = { glyph: "▘", fg: "shine", bg: "ink" };
const DOME: FaceCell = { glyph: "▀", fg: "ink", bg: "skin" };
const PINCH: FaceCell = { glyph: "▄", fg: "ink", bg: "skin" };

type EyeSet = {
  readonly open: EyePair;
  readonly arch: EyePair;
  readonly wince: EyePair;
  readonly shut: EyePair;
};

type BrowedEyeSet = EyeSet & {
  readonly pinched: EyePair;
  readonly furrow: EyePair;
};

const NARROW_EYES: EyeSet = {
  open: both([[SPARK]]),
  arch: { left: [[ink("▞")]], right: [[ink("▚")]] },
  wince: { left: [[ink("▚")]], right: [[ink("▞")]] },
  shut: both([[ink("▄")]]),
};

const WIDE_EYES: BrowedEyeSet = {
  open: both([
    [IRIS, LIDDED, IRIS],
    [DOME, IRIS, DOME],
  ]),
  arch: both([[ink("▞"), ink("▀"), ink("▚")]]),
  wince: both([[ink("▚"), ink("▄"), ink("▞")]]),
  shut: both([[ink("▄"), ink("▄"), ink("▄")]]),
  pinched: {
    left: [
      [IRIS, LIDDED, PINCH],
      [DOME, IRIS, DOME],
    ],
    right: [
      [PINCH, LIDDED, IRIS],
      [DOME, IRIS, DOME],
    ],
  },
  furrow: both([[ink("▀"), ink("▀"), ink("▀")]]),
};

const HOME_MOUTH = {
  smile: [".....#..#.....", "......##......"],
  open: [".....####.....", ".....####....."],
  flat: [".....####....."],
  frown: ["......##......", ".....#..#....."],
  dot: ["......##......"],
} as const;
const SMALL_MOUTH = {
  smile: ["..........", "....##...."],
  open: ["....##....", "....##...."],
  flat: ["....##...."],
  frown: ["...####...", ".........."],
} as const;

export const PIXEL_FACES: Readonly<Record<LoopVariant, Readonly<Record<LoopPose, PixelFace>>>> = {
  home: {
    idle: { eyes: WIDE_EYES.open, mouth: HOME_MOUTH.smile, blush: true },
    thinking: { eyes: WIDE_EYES.open, mouth: HOME_MOUTH.flat },
    impressed: { eyes: WIDE_EYES.open, mouth: HOME_MOUTH.open, blush: true },
    facepalm: {
      eyes: WIDE_EYES.pinched,
      brows: WIDE_EYES.furrow,
      mouth: HOME_MOUTH.dot,
      blush: true,
    },
    celebrating: { eyes: WIDE_EYES.arch, mouth: HOME_MOUTH.smile, blush: true },
    sleeping: { eyes: WIDE_EYES.shut, mouth: HOME_MOUTH.flat },
  },
  small: {
    idle: { eyes: NARROW_EYES.open, mouth: SMALL_MOUTH.smile, blush: true },
    thinking: { eyes: NARROW_EYES.open, mouth: SMALL_MOUTH.flat },
    impressed: { eyes: NARROW_EYES.open, mouth: SMALL_MOUTH.open, blush: true },
    facepalm: { eyes: NARROW_EYES.wince, mouth: SMALL_MOUTH.frown },
    celebrating: { eyes: NARROW_EYES.arch, mouth: SMALL_MOUTH.smile, blush: true },
    sleeping: { eyes: NARROW_EYES.shut, mouth: SMALL_MOUTH.flat },
  },
};

const EYE_INK: Rgb = [74, 43, 58];
const BLUSH_INK: Rgb = [232, 104, 140];
const SHINE_INK: Rgb = [255, 249, 251];
const UPPER = "▀";
const LOWER = "▄";
const QUADRANTS = [" ", "▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█"];
const TRANSPARENT = 0;

const spaces = (n: number) => " ".repeat(Math.max(0, n));

const rgbCache = new Map<number, Rgb>();

function colourAt(index: number): Rgb {
  const known = rgbCache.get(index);
  if (known) return known;
  const hex = PALETTE[index - 1] ?? "000000";
  const value: Rgb = [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
  rgbCache.set(index, value);
  return value;
}

const gridCache = new Map<string, Uint8Array>();

function pixelsOf(pose: LoopPose, variant: LoopVariant): Uint8Array {
  const key = `${pose}/${variant}`;
  const known = gridCache.get(key);
  if (known) return known;
  const decoded = Uint8Array.from(Buffer.from(LOOP_ART[pose][variant].data, "base64"));
  gridCache.set(key, decoded);
  return decoded;
}

export function eyeWidth(face: PixelFace): number {
  return face.eyes.left[0]?.length ?? 1;
}

function blinkFor(face: PixelFace): EyePair {
  return eyeWidth(face) === 1 ? NARROW_EYES.shut : WIDE_EYES.shut;
}

function standing(
  px: Uint8Array,
  grid: { readonly w: number; readonly h: number },
  start: number,
  left: number,
  right: number,
  deep: number,
): number {
  const carries = (column: number, row: number) =>
    (px[row * 2 * grid.w + column] ?? TRANSPARENT) !== TRANSPARENT ||
    (px[(row * 2 + 1) * grid.w + column] ?? TRANSPARENT) !== TRANSPARENT;
  for (let at = start; at + deep <= grid.h >> 1; at++) {
    let clear = true;
    for (let down = 0; down < deep && clear; down++) {
      clear = carries(left, at + down) && carries(right, at + down);
    }
    if (clear) return at;
  }
  return start;
}

export type LoopOptions = {
  readonly blink?: boolean;
  readonly deep?: boolean;
};

export function loopPixels(
  pose: LoopPose,
  variant: LoopVariant = "small",
  options: LoopOptions = {},
): string[] {
  const grid = LOOP_ART[pose][variant];
  const px = pixelsOf(pose, variant);
  const deep = options.deep ?? deepColour();
  const face = PIXEL_FACES[variant][pose];

  const { eyeL, eyeR } = grid.anchors;
  const owned = new Map<string, FaceCell>();
  const painted = new Map<string, string>();

  if (eyeL && eyeR) {
    const left = Math.round(eyeL[0] * 2) >> 1;
    const right = Math.round(eyeR[0] * 2) >> 1;
    const row = standing(
      px,
      grid,
      Math.round(eyeL[1]) >> 1,
      left,
      right,
      face.eyes.left.length + 1,
    );
    const wide = eyeWidth(face);
    const eyes = options.blink ? blinkFor(face) : face.eyes;
    const stamp = (rows: readonly EyeRow[], from: number, top: number) => {
      rows.forEach((cells, down) => {
        cells.forEach((what, along) => owned.set(`${from + along},${top + down}`, what));
      });
    };
    stamp(eyes.left, left - wide + 1, row);
    stamp(eyes.right, right, row);
    if (face.brows !== undefined && options.blink !== true && row > 0) {
      stamp(face.brows.left, left - wide + 1, row - 1);
      stamp(face.brows.right, right, row - 1);
    }
    if (face.blush === true) {
      const mark: FaceCell = { glyph: LOWER, fg: "blush", bg: "skin" };
      const cheek = row + face.eyes.left.length - 1;
      owned.set(`${left - wide},${cheek}`, mark);
      owned.set(`${right + wide},${cheek}`, mark);
    }
    const under = (row + face.eyes.left.length) * 2;
    const from = left * 2 - 2;
    face.mouth.forEach((line, down) => {
      [...line].forEach((mark, along) => {
        if (mark === "#") painted.set(`${from + along},${under + down}`, mark);
      });
    });
  }

  type Cell = { glyph: string; fg: Rgb | null; bg: Rgb | null };
  const rows: Cell[][] = [];
  for (let y = 0; y < grid.h; y += 2) {
    const row: Cell[] = [];
    for (let x = 0; x < grid.w; x++) {
      const top = px[y * grid.w + x] ?? TRANSPARENT;
      const bottom = y + 1 < grid.h ? (px[(y + 1) * grid.w + x] ?? TRANSPARENT) : TRANSPARENT;
      const flat = top !== TRANSPARENT ? top : bottom;
      const skin = flat === TRANSPARENT ? null : colourAt(flat);
      const shade = (role: FacePaint) =>
        role === "shine"
          ? SHINE_INK
          : role === "blush"
            ? BLUSH_INK
            : role === "ink"
              ? EYE_INK
              : skin;

      const claimed = owned.get(`${x},${y >> 1}`);
      if (claimed) {
        row.push({ glyph: claimed.glyph, fg: shade(claimed.fg), bg: shade(claimed.bg) });
        continue;
      }

      const corners =
        (painted.has(`${x * 2},${y}`) ? 1 : 0) |
        (painted.has(`${x * 2 + 1},${y}`) ? 2 : 0) |
        (painted.has(`${x * 2},${y + 1}`) ? 4 : 0) |
        (painted.has(`${x * 2 + 1},${y + 1}`) ? 8 : 0);
      if (corners !== 0) {
        row.push({ glyph: QUADRANTS[corners] ?? UPPER, fg: EYE_INK, bg: skin });
      } else if (top === TRANSPARENT && bottom === TRANSPARENT)
        row.push({ glyph: " ", fg: null, bg: null });
      else if (top !== TRANSPARENT && bottom !== TRANSPARENT)
        row.push({ glyph: UPPER, fg: colourAt(top), bg: colourAt(bottom) });
      else if (top !== TRANSPARENT) row.push({ glyph: UPPER, fg: colourAt(top), bg: null });
      else row.push({ glyph: LOWER, fg: colourAt(bottom), bg: null });
    }
    rows.push(row);
  }

  return rows.map((row) => row.map((c) => cell(c.glyph, c.fg, c.bg, deep)).join(""));
}

const GILLS = {
  calm: ["  ≈≋", " ≈≋≈", "  ≈≋"],
  wide: [" ≈≋≈", "≈≋≈≋", " ≈≋≈"],
  droop: ["   ~", "  ≈~", "   ~"],
} as const;

function gillsFor(pose: LoopPose): readonly [string, string, string] {
  if (pose === "sleeping") return GILLS.droop;
  if (pose === "celebrating" || pose === "impressed") return GILLS.wide;
  return GILLS.calm;
}

const mirror = (gill: string): string => [...gill].toReversed().join("");

export function loopArt(pose: LoopPose): string[] {
  const face = GLYPH_FACES[pose];
  const [g0, g1, g2] = gillsFor(pose);
  const g = (s: string) => paint(s, "gill");
  const b = (s: string) => paint(s, "body");
  const f = (s: string) => paint(s, "face");
  const bl = (s: string) => paint(s, "blush");
  const cheeks = face.blush ? ` ${bl("◟")} ${f(face.mouth)} ${bl("◞")} ` : `   ${f(face.mouth)}   `;
  const tail =
    pose === "celebrating"
      ? `${g("\\")}${spaces(3)}${b("╰─╯")}${g("~~")}${spaces(1)}${g("/")}`
      : `${spaces(4)}${b("╰─╯")}${g("~~")}${spaces(2)}`;
  return [
    `${spaces(4)} ${b("╭───────╮")} ${spaces(4)}`,
    `${g(g0)}${b("╭╯")} ${f(face.eyes)} ${b("╰╮")}${g(mirror(g0))}`,
    `${g(g1)}${b("│")}${cheeks}${b("│")}${g(mirror(g1))}`,
    `${g(g2)}${b("╰╮")}${spaces(7)}${b("╭╯")}${g(mirror(g2))}`,
    `${spaces(4)}  ${b("╰──┬──╯")}  ${spaces(4)}`,
    `${spaces(4)}${tail}${spaces(4)}`,
  ];
}

export function loopRows(
  pose: LoopPose,
  variant: LoopVariant = "small",
  options: LoopOptions = {},
): string[] {
  return COLOUR ? loopPixels(pose, variant, options) : loopArt(pose);
}
