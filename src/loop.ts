import { paint } from "./ansi.js";
import type { LoopPose } from "./types.js";

type Face = {
  eyes: string;
  mouth: string;
  blush: string;
};

const FACES = {
  idle: { eyes: "◕   ◕", mouth: " ‿ ", blush: "♡" },
  thinking: { eyes: "◔   ◕", mouth: " ~ ", blush: " " },
  impressed: { eyes: "✦   ✦", mouth: " ▽ ", blush: "♡" },
  facepalm: { eyes: "-   -", mouth: " ⌒ ", blush: " " },
  celebrating: { eyes: "^   ^", mouth: " ▽ ", blush: "♡" },
  sleeping: { eyes: "–   –", mouth: " z ", blush: " " },
} as const satisfies Record<LoopPose, Face>;

const GILLS = {
  idle: ["  ~≈", " ~≈≈", "  ~≈"],
  thinking: ["  ~≈", " ~≈≈", "  ~≈"],
  impressed: [" ~≈≈", "~≈≈≈", " ~≈≈"],
  facepalm: ["  ~≈", " ~≈≈", "  ~≈"],
  celebrating: [" ~≈≈", "~≈≈≈", " ~≈≈"],
  sleeping: ["   ~", "  ~≈", "   ~"],
} as const satisfies Record<LoopPose, readonly [string, string, string]>;

function mirror(gill: string): string {
  return [...gill].toReversed().join("");
}

export function loopArt(pose: LoopPose): string[] {
  const { eyes, mouth, blush } = FACES[pose];
  const [g1, g2, g3] = GILLS[pose];
  const g = (s: string) => paint(s, "gill");
  const b = (s: string) => paint(s, "body");
  const f = (s: string) => paint(s, "face");
  const bl = (s: string) => paint(s, "blush");
  const arms = pose === "celebrating" ? [g(" \\"), g("/ ")] : ["  ", "  "];
  return [
    `${g(g1)}${b("╭─────────╮")}${g(mirror(g1))}`,
    `${g(g2)}${b("│")}${f(`  ${eyes}  `)}${b("│")}${g(mirror(g2))}`,
    `${g(g3)}${b("│")} ${bl(blush)} ${f(mouth)} ${bl(blush)} ${b("│")}${g(mirror(g3))}`,
    `    ${b("╰──╮")}${b("   ")}${b("╭──╯")}    `,
    `${arms[0]}     ${b("╰───╯")}${b("~")}    ${arms[1]}`,
  ];
}
