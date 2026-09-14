import { padTo, paint, visibleWidth, wrap } from "./ansi.js";
import { decodeKey, type Key } from "./keys.js";
import { COPY_WIDTH, keyHint, out, readKey, rule, TEXT_WIDTH, title, withLoop } from "./screen.js";
import { toggleRow, treeRows, type TreeGroup } from "./tree.js";
import type { LoopPose } from "./types.js";

export type PickResult<T> = { ok: true; value: T } | { ok: false; why: "back" | "quit" };

const BACK: PickResult<never> = { ok: false, why: "back" };
const QUIT: PickResult<never> = { ok: false, why: "quit" };

const ON = paint("●", "gold");
const SOME = paint("◐", "gold");
const OFF = paint("·", "faint");
const CURSOR = paint("❯", "coral", "bold");

function mark(picked: number, total: number): string {
  if (picked === 0) return OFF;
  return picked === total ? ON : SOME;
}

function paragraph(text: string, width: number = TEXT_WIDTH): string[] {
  return wrap(text, width).map((line) => paint(line, "faint"));
}

function header(pose: LoopPose, heading: string, intro: string, stepLine?: string): string[] {
  const title_ = stepLine === undefined ? title(heading) : `${title(heading)}   ${stepLine}`;
  return withLoop(pose, [title_, "", ...paragraph(intro, COPY_WIDTH), ""]);
}

export function viewport(
  total: number,
  cursor: number,
  height: number,
): { start: number; end: number } {
  if (total <= height) return { start: 0, end: total };
  const start = Math.min(Math.max(0, cursor - Math.floor(height / 2)), total - height);
  return { start, end: start + height };
}

function listHeight(reserved: number): number {
  return Math.max(5, (process.stdout.rows || 24) - reserved);
}

function scrollNote(hidden: number, arrow: string): string[] {
  return hidden > 0 ? [paint(`    ${arrow} ${hidden} more`, "faint")] : [];
}

async function nextKey(): Promise<Key> {
  return decodeKey(await readKey());
}

function move(cursor: number, delta: number, total: number): number {
  if (total === 0) return 0;
  return Math.min(Math.max(0, cursor + delta), total - 1);
}

export async function pickTree(opts: {
  groups: readonly TreeGroup[];
  picked: ReadonlySet<string>;
  heading: string;
  intro: string;
  stepLine?: string | undefined;
  summary: (picked: ReadonlySet<string>) => { text: string; ready: boolean };
}): Promise<PickResult<Set<string>>> {
  let picked = new Set(opts.picked);
  let filter = "";
  let cursor = 0;
  let refused = false;
  const head = header("idle", opts.heading, opts.intro, opts.stepLine);
  const open = new Set(
    opts.groups
      .filter((group) => group.children.some((child) => picked.has(child.slug)))
      .filter((group) => !group.children.every((child) => picked.has(child.slug)))
      .map((group) => group.slug),
  );
  for (;;) {
    const rows = treeRows(opts.groups, open, picked, filter);
    const summary = opts.summary(picked);
    cursor = Math.min(cursor, Math.max(0, rows.length - 1));
    const height = listHeight(filter === "" ? 13 : 14);
    const { start, end } = viewport(rows.length, cursor, height);
    const drawn = rows.slice(start, end).map((row, i) => {
      const here = start + i === cursor;
      const lead = here ? `${CURSOR} ` : "  ";
      if (row.kind === "group") {
        const caret = paint(row.open ? "▾" : "▸", "faint");
        const name = here ? paint(row.group.name, "bold", "ink") : row.group.name;
        const total = row.children.length;
        const count =
          total === row.group.children.length
            ? `${total} ${total === 1 ? "topic" : "topics"}`
            : `${total} of ${row.group.children.length}`;
        const state =
          row.picked === 0
            ? paint("", "faint")
            : row.picked === total
              ? paint("whole", "gold")
              : paint(`${row.picked} picked`, "gold");
        return `${lead}${caret} ${mark(row.picked, total)} ${padTo(name, 30)} ${paint(padTo(count, 12), "faint")}${state}`;
      }
      const name = here ? paint(row.child.name, "bold", "ink") : paint(row.child.name, "soft");
      return `${lead}    ${row.picked ? ON : OFF} ${name}`;
    });
    const empty = rows.length === 0 ? [paint(`    nothing matches "${filter}"`, "faint")] : [];
    out([
      ...head,
      ...(filter === ""
        ? []
        : [`  ${paint("filter", "faint")} ${paint(filter, "coral", "bold")}`, ""]),
      ...scrollNote(start, "↑"),
      ...drawn,
      ...empty,
      ...scrollNote(rows.length - end, "↓"),
      "",
      paint(summary.text, refused ? "coral" : "soft", ...(refused ? (["bold"] as const) : [])),
      rule(),
      keyHint([
        ["↑↓", "move"],
        ["→←", "open"],
        ["space", "pick"],
        ["type", "filter"],
        ["enter", "next"],
        ["esc", filter === "" ? "back" : "clear"],
      ]),
    ]);
    const key = await nextKey();
    const row = rows[cursor];
    switch (key.kind) {
      case "cancel":
        return QUIT;
      case "escape":
        if (filter === "") return BACK;
        filter = "";
        cursor = 0;
        break;
      case "enter":
      case "tab":
        if (!summary.ready) {
          refused = true;
          break;
        }
        return { ok: true, value: picked };
      case "up":
        cursor = move(cursor, -1, rows.length);
        break;
      case "down":
        cursor = move(cursor, 1, rows.length);
        break;
      case "pageUp":
        cursor = move(cursor, -height, rows.length);
        break;
      case "pageDown":
        cursor = move(cursor, height, rows.length);
        break;
      case "home":
        cursor = 0;
        break;
      case "end":
        cursor = Math.max(0, rows.length - 1);
        break;
      case "right":
        if (row?.kind === "group" && !row.open) {
          open.add(row.group.slug);
          cursor += 1;
        }
        break;
      case "left":
        if (row?.kind === "group") open.delete(row.group.slug);
        else if (row !== undefined) {
          open.delete(row.group.slug);
          cursor = rows.findIndex((r) => r.kind === "group" && r.group.slug === row.group.slug);
        }
        break;
      case "space":
        if (row !== undefined) picked = toggleRow(row, picked);
        refused = false;
        break;
      case "backspace":
        filter = filter.slice(0, -1);
        cursor = 0;
        break;
      case "char":
        filter += key.value;
        cursor = 0;
        break;
      default:
        break;
    }
  }
}

export type Choice<T> = { value: T; label: string; hint: string };

export async function pickOne<T>(opts: {
  choices: ReadonlyArray<Choice<T>>;
  current: T;
  heading: string;
  intro: string;
  stepLine?: string | undefined;
  pose?: LoopPose | undefined;
  note?: string | undefined;
}): Promise<PickResult<T>> {
  const at = Math.max(
    0,
    opts.choices.findIndex((choice) => choice.value === opts.current),
  );
  let cursor = at;
  let chosen = at;
  const width = Math.max(...opts.choices.map((choice) => visibleWidth(choice.label)));
  const head = header(opts.pose ?? "idle", opts.heading, opts.intro, opts.stepLine);
  for (;;) {
    const rows = opts.choices.map((choice, i) => {
      const here = i === cursor;
      const label = here
        ? paint(padTo(choice.label, width), "bold", "ink")
        : padTo(choice.label, width);
      return `${here ? `${CURSOR} ` : "  "}${i === chosen ? ON : OFF} ${label}   ${paint(choice.hint, "soft")}`;
    });
    out([
      ...head,
      ...rows,
      ...(opts.note === undefined ? [] : ["", ...paragraph(opts.note)]),
      "",
      rule(),
      keyHint([
        ["\u2191\u2193", "move"],
        ["space", "pick"],
        ["enter", "next"],
        ["esc", "back"],
      ]),
    ]);
    const key = await nextKey();
    if (key.kind === "cancel") return QUIT;
    if (key.kind === "escape") return BACK;
    if (key.kind === "space") chosen = cursor;
    if (key.kind === "enter" || key.kind === "tab") {
      const choice = opts.choices[chosen];
      if (choice !== undefined) return { ok: true, value: choice.value };
    }
    if (key.kind === "up") cursor = move(cursor, -1, opts.choices.length);
    if (key.kind === "down") cursor = move(cursor, 1, opts.choices.length);
  }
}

export type Check = {
  id: string;
  label: string;
  hint: string;
  detail?: string;
  status?: string;
  known?: boolean;
};

export async function pickMany(opts: {
  items: readonly Check[];
  picked?: ReadonlySet<string>;
  heading: string;
  intro: string;
  confirm: string;
  pose?: LoopPose | undefined;
  stepLine?: string | undefined;
  summary?: (picked: ReadonlySet<string>) => {
    text: string;
    ready: boolean;
    focus?: string;
  };
}): Promise<PickResult<Set<string>>> {
  let picked = new Set(opts.picked ?? []);
  let cursor = 0;
  let refused = false;
  const width = Math.max(...opts.items.map((item) => visibleWidth(item.label)));
  const statusWidth = Math.max(0, ...opts.items.map((item) => visibleWidth(item.status ?? "")));
  const head = header(opts.pose ?? "idle", opts.heading, opts.intro, opts.stepLine);
  for (;;) {
    const height = listHeight(12);
    const { start, end } = viewport(opts.items.length, cursor, height);
    const rows = opts.items.slice(start, end).map((item, i) => {
      const here = start + i === cursor;
      const label = here
        ? paint(padTo(item.label, width), "bold", "ink")
        : padTo(item.label, width);
      const on = picked.has(item.id);
      const status =
        statusWidth === 0
          ? ""
          : `${paint(padTo(item.status ?? "", statusWidth), item.known === true ? "gold" : "faint")}  `;
      return `${here ? `${CURSOR} ` : "  "}${on ? ON : OFF} ${label}   ${status}${paint(item.hint, "faint")}`;
    });
    const detail = opts.items[cursor]?.detail;
    const summary = opts.summary?.(picked);
    out([
      ...head,
      ...scrollNote(start, "↑"),
      ...rows,
      ...scrollNote(opts.items.length - end, "↓"),
      "",
      ...(detail === undefined ? [""] : paragraph(detail)),
      ...(summary === undefined
        ? []
        : [
            paint(
              summary.text,
              refused ? "coral" : "soft",
              ...(refused ? (["bold"] as const) : []),
            ),
          ]),
      rule(),
      keyHint([
        ["↑↓", "move"],
        ["space", "pick"],
        ["a", "all"],
        ["enter", opts.confirm],
        ["esc", "back"],
      ]),
    ]);
    const key = await nextKey();
    if (key.kind === "cancel") return QUIT;
    if (key.kind === "escape") return BACK;
    if (key.kind === "enter" || key.kind === "tab") {
      if (summary !== undefined && !summary.ready) {
        refused = true;
        const to = opts.items.findIndex((item) => item.id === summary.focus);
        if (to !== -1) cursor = to;
        continue;
      }
      return { ok: true, value: picked };
    }
    if (key.kind === "up") cursor = move(cursor, -1, opts.items.length);
    if (key.kind === "down") cursor = move(cursor, 1, opts.items.length);
    if (key.kind === "space") {
      const item = opts.items[cursor];
      if (item !== undefined) {
        const next = new Set(picked);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        picked = next;
        refused = false;
      }
    }
    if (key.kind === "char" && key.value.toLowerCase() === "a") {
      picked = picked.size === opts.items.length ? new Set() : new Set(opts.items.map((i) => i.id));
      refused = false;
    }
  }
}

export type Rung = {
  level: number;
  name: string;
  says: string;
  tag?: string;
};

export function bandFrom(first: number, second: number): { min: number; max: number } {
  return first <= second ? { min: first, max: second } : { min: second, max: first };
}

export async function pickBand(opts: {
  rungs: readonly Rung[];
  band: { min: number; max: number };
  heading: string;
  intro: string;
  stepLine?: string | undefined;
  note: string;
}): Promise<PickResult<{ min: number; max: number }>> {
  let { min, max } = opts.band;
  let cursor = Math.max(
    0,
    opts.rungs.findIndex((rung) => rung.level === min),
  );
  let pending: number | null = null;
  const width = Math.max(...opts.rungs.map((rung) => visibleWidth(rung.name)));
  const saysWidth = Math.max(...opts.rungs.map((rung) => visibleWidth(rung.says)));
  const head = header("thinking", opts.heading, opts.intro, opts.stepLine);
  for (;;) {
    const here = opts.rungs[cursor]?.level ?? min;
    const shown = pending === null ? { min, max } : bandFrom(pending, here);
    out([
      ...head,
      ...opts.rungs.map((rung, i) => {
        const inBand = rung.level >= shown.min && rung.level <= shown.max;
        const says =
          rung.tag === undefined
            ? paint(rung.says, "soft")
            : `${paint(padTo(rung.says, saysWidth), "soft")}  ${paint(rung.tag, "gold", "bold")}`;
        const lead = i === cursor ? `${CURSOR} ` : "  ";
        return `${lead}${inBand ? ON : OFF} ${paint(String(rung.level), "coral", "bold")}  ${paint(padTo(rung.name, width), inBand ? "bold" : "dim")}   ${says}`;
      }),
      "",
      paint(
        pending === null
          ? shown.min === shown.max
            ? `Level ${shown.min} only. Space a level to start a new range.`
            : `Levels ${shown.min} to ${shown.max}. Space a level to start a new range.`
          : `From ${pending}. Space the other end.`,
        pending === null ? "soft" : "coral",
      ),
      ...paragraph(opts.note),
      rule(),
      keyHint([
        ["\u2191\u2193", "move"],
        ["space", "pick"],
        ["enter", "next"],
        ["esc", "back"],
      ]),
    ]);
    const key = await nextKey();
    if (key.kind === "cancel") return QUIT;
    if (key.kind === "escape") return BACK;
    if (key.kind === "enter" || key.kind === "tab") {
      const settled = pending === null ? { min, max } : bandFrom(pending, here);
      return { ok: true, value: settled };
    }
    if (key.kind === "space") {
      if (pending === null) pending = here;
      else {
        ({ min, max } = bandFrom(pending, here));
        pending = null;
      }
    }
    if (key.kind === "up") cursor = move(cursor, -1, opts.rungs.length);
    if (key.kind === "down") cursor = move(cursor, 1, opts.rungs.length);
  }
}
