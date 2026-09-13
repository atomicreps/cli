import { ESC } from "./constants.js";

export type Key =
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "home" }
  | { kind: "end" }
  | { kind: "pageUp" }
  | { kind: "pageDown" }
  | { kind: "enter" }
  | { kind: "space" }
  | { kind: "tab" }
  | { kind: "escape" }
  | { kind: "backspace" }
  | { kind: "cancel" }
  | { kind: "char"; value: string }
  | { kind: "other" };

const SEQUENCES = new Map<string, Key>([
  [`${ESC}[A`, { kind: "up" }],
  [`${ESC}[B`, { kind: "down" }],
  [`${ESC}[C`, { kind: "right" }],
  [`${ESC}[D`, { kind: "left" }],
  [`${ESC}OA`, { kind: "up" }],
  [`${ESC}OB`, { kind: "down" }],
  [`${ESC}OC`, { kind: "right" }],
  [`${ESC}OD`, { kind: "left" }],
  [`${ESC}[H`, { kind: "home" }],
  [`${ESC}[F`, { kind: "end" }],
  [`${ESC}[1~`, { kind: "home" }],
  [`${ESC}[4~`, { kind: "end" }],
  [`${ESC}[5~`, { kind: "pageUp" }],
  [`${ESC}[6~`, { kind: "pageDown" }],
]);

export function decodeKey(raw: string): Key {
  const sequence = SEQUENCES.get(raw);
  if (sequence !== undefined) return sequence;
  if (raw === "\r" || raw === "\n") return { kind: "enter" };
  if (raw === " ") return { kind: "space" };
  if (raw === "\t") return { kind: "tab" };
  if (raw === ESC) return { kind: "escape" };
  if (raw === "" || raw === "\b") return { kind: "backspace" };
  if (raw === "" || raw === "") return { kind: "cancel" };
  if (raw.length === 1 && raw >= " " && raw <= "~") return { kind: "char", value: raw };
  return { kind: "other" };
}
