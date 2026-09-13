import { spawnSync } from "node:child_process";

import { paint, padTo, sanitize, stripAnsi } from "./ansi.js";
import { apiOrigin, isAlpha, siteOrigin } from "./config.js";
import { ART_GUTTER, ART_WIDTH, CLEAR, HIDE_CURSOR, SHOW_CURSOR } from "./constants.js";
import { decodeKey } from "./keys.js";
import { loopArt } from "./loop.js";
import type { LoopPose } from "./types.js";

export const WIDTH = Math.min(process.stdout.columns || 80, 88);
export const TEXT_WIDTH = WIDTH - 4;
export const COPY_WIDTH = TEXT_WIDTH - ART_GUTTER;

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI;
}

export function out(lines: string[]): void {
  const all = [...channelBanner(), ...lines];
  process.stdout.write(`${CLEAR}${all.map((l) => `  ${sanitize(l)}`).join("\n")}\n`);
}

export function plain(lines: string[]): void {
  process.stdout.write(`${lines.map(stripAnsi).join("\n")}\n`);
}

export function rule(): string {
  return paint("─".repeat(TEXT_WIDTH), "faint");
}

export function title(text: string): string {
  return paint(text, "bold", "ink");
}

export function keyHint(pairs: Array<[string, string]>): string {
  return pairs
    .map(([k, label]) => `${paint(k, "coral", "bold")} ${paint(label, "soft")}`)
    .join("   ");
}

export function withLoop(pose: LoopPose, copy: string[]): string[] {
  const art = loopArt(pose);
  const rows = Math.max(art.length, copy.length);
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    const left = art[i] ?? " ".repeat(ART_WIDTH);
    lines.push(`${padTo(left, ART_GUTTER)}${copy[i] ?? ""}`);
  }
  return lines;
}

function rawMode(): Disposable {
  const stdin = process.stdin;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return {
    [Symbol.dispose]: () => {
      stdin.setRawMode?.(false);
      stdin.pause();
    },
  };
}

export async function readKey(): Promise<string> {
  using _raw = rawMode();
  const { promise, resolve } = Promise.withResolvers<string>();
  const onData = (data: string) => {
    process.stdin.off("data", onData);
    resolve(data);
  };
  process.stdin.on("data", onData);
  return await promise;
}

export function isEnter(key: string): boolean {
  return decodeKey(key).kind === "enter";
}

export function isBack(key: string): boolean {
  const decoded = decodeKey(key);
  return (
    decoded.kind === "escape" ||
    decoded.kind === "cancel" ||
    (decoded.kind === "char" && decoded.value === "q")
  );
}

export async function pause(label = "back"): Promise<void> {
  process.stdout.write(`\n  ${keyHint([["any key", label]])}\n`);
  await readKey();
}

export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 512) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  return parsed.host === new URL(siteOrigin()).host ? parsed.toString() : null;
}

export function openBrowser(url: string): void {
  const safe = safeUrl(url);
  if (safe === null) return;
  const [command, args] =
    process.platform === "darwin"
      ? (["open", [safe]] as const)
      : process.platform === "win32"
        ? (["cmd", ["/c", "start", "", safe]] as const)
        : (["xdg-open", [safe]] as const);
  try {
    spawnSync(command, [...args], { stdio: "ignore" });
  } catch {
  }
}

export function copyToClipboard(text: string): boolean {
  const tool =
    process.platform === "darwin" ? "pbcopy" : process.platform === "win32" ? "clip" : "xclip";
  try {
    const run = spawnSync(tool, process.platform === "linux" ? ["-selection", "clipboard"] : [], {
      input: text,
      stdio: ["pipe", "ignore", "ignore"],
    });
    return run.status === 0;
  } catch {
    return false;
  }
}

export function channelBanner(): string[] {
  if (!isAlpha()) return [];
  return [`${paint(" ALPHA ", "bold", "gold")} ${paint(apiOrigin(), "faint")}`, ""];
}

export function hiddenCursor(): Disposable {
  process.stdout.write(HIDE_CURSOR);
  const restore = () => process.stdout.write(`${SHOW_CURSOR}\n`);
  process.on("exit", restore);
  return {
    [Symbol.dispose]: () => {
      process.off("exit", restore);
      restore();
    },
  };
}

export function step(index: number, total: number): string {
  return paint(`Step ${index} of ${total}`, "faint");
}
