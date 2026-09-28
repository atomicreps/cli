import { cell, COLOUR, deepColour, paint, type Rgb } from "./ansi.js";
import { IDLE_FRAMES, LOOP_ART, PALETTE, type LoopFrame, type LoopVariant } from "./loop-art.js";
import type { LoopPose } from "./types.js";

export type { LoopFrame, LoopVariant };

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

const UPPER = "▀";
const LOWER = "▄";

const spaces = (n: number) => " ".repeat(Math.max(0, n));

const rgbCache = new Map<string, Rgb>();

function colourOf(letter: string, deep: boolean): Rgb | null {
  if (letter === ".") return null;
  const key = `${letter}${deep ? "+" : "-"}`;
  const known = rgbCache.get(key);
  if (known) return known;
  const entry = PALETTE[letter];
  const hex = (deep ? entry?.deep : entry?.cube) ?? "#000000";
  const value: Rgb = [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  rgbCache.set(key, value);
  return value;
}

export type LoopOptions = {
  readonly frame?: LoopFrame;
  readonly deep?: boolean;
};

const BLINK_EVERY_TICKS = 34;
const BLINK_TICKS = 2;
const BOB_TICKS = 7;

export function idleFrameAt(tick: number): LoopFrame | undefined {
  if (tick % BLINK_EVERY_TICKS >= BLINK_EVERY_TICKS - BLINK_TICKS) return "blink";
  return Math.floor(tick / BOB_TICKS) % 2 === 1 ? "bob" : undefined;
}

export function loopGrid(
  pose: LoopPose,
  variant: LoopVariant,
  frame?: LoopFrame,
): readonly string[] {
  return pose === "idle" && frame ? IDLE_FRAMES[variant][frame] : LOOP_ART[pose][variant];
}

export function loopPixels(
  pose: LoopPose,
  variant: LoopVariant = "small",
  options: LoopOptions = {},
): string[] {
  const grid = loopGrid(pose, variant, options.frame);
  const deep = options.deep ?? deepColour();
  const rows: string[] = [];
  for (let y = 0; y < grid.length; y += 2) {
    const top = grid[y] ?? "";
    const bottom = grid[y + 1] ?? "";
    let line = "";
    for (let x = 0; x < top.length; x++) {
      const above = colourOf(top[x] ?? ".", deep);
      const below = colourOf(bottom[x] ?? ".", deep);
      if (above === null && below === null) line += " ";
      else if (above === null) line += cell(LOWER, below, null, deep);
      else line += cell(UPPER, above, below, deep);
    }
    rows.push(line);
  }
  return rows;
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
