export type TreeChild = { slug: string; name: string };
export type TreeGroup = { slug: string; name: string; children: readonly TreeChild[] };

export type TreeRow =
  | {
      kind: "group";
      group: TreeGroup;
      children: readonly TreeChild[];
      open: boolean;
      picked: number;
    }
  | { kind: "child"; group: TreeGroup; child: TreeChild; picked: boolean };

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s._-]+/g, "");
}

export function matches(child: TreeChild, filter: string): boolean {
  if (filter === "") return true;
  const needle = normalize(filter);
  return normalize(child.name).includes(needle) || normalize(child.slug).includes(needle);
}

export function treeRows(
  groups: readonly TreeGroup[],
  open: ReadonlySet<string>,
  picked: ReadonlySet<string>,
  filter = "",
): TreeRow[] {
  const searching = filter !== "";
  const rows: TreeRow[] = [];
  for (const group of groups) {
    const groupMatched = searching && normalize(group.name).includes(normalize(filter));
    const children = groupMatched
      ? group.children
      : group.children.filter((child) => matches(child, filter));
    if (children.length === 0) continue;
    const isOpen = searching || open.has(group.slug);
    rows.push({
      kind: "group",
      group,
      children,
      open: isOpen,
      picked: children.filter((child) => picked.has(child.slug)).length,
    });
    if (!isOpen) continue;
    for (const child of children) {
      rows.push({ kind: "child", group, child, picked: picked.has(child.slug) });
    }
  }
  return rows;
}

export function toggleRow(row: TreeRow, picked: ReadonlySet<string>): Set<string> {
  const next = new Set(picked);
  if (row.kind === "child") {
    if (next.has(row.child.slug)) next.delete(row.child.slug);
    else next.add(row.child.slug);
    return next;
  }
  const whole = row.children.every((child) => next.has(child.slug));
  for (const child of row.children) {
    if (whole) next.delete(child.slug);
    else next.add(child.slug);
  }
  return next;
}

function known(groups: readonly TreeGroup[]): Set<string> {
  const out = new Set<string>();
  for (const group of groups) for (const child of group.children) out.add(child.slug);
  return out;
}

export function pickedFrom(
  groups: readonly TreeGroup[],
  prefer: readonly string[],
  topics: readonly string[],
): Set<string> {
  if (topics.length > 0) {
    const catalog = known(groups);
    return new Set(topics.filter((slug) => catalog.has(slug)));
  }
  const wanted = new Set(prefer);
  const out = new Set<string>();
  for (const group of groups) {
    if (!wanted.has(group.slug)) continue;
    for (const child of group.children) out.add(child.slug);
  }
  return out;
}

export function draftFrom(
  groups: readonly TreeGroup[],
  picked: ReadonlySet<string>,
): { prefer: string[]; topics: string[] } {
  const prefer: string[] = [];
  let partial = false;
  for (const group of groups) {
    const count = group.children.filter((child) => picked.has(child.slug)).length;
    if (count === 0) continue;
    prefer.push(group.slug);
    if (count !== group.children.length) partial = true;
  }
  if (!partial) return { prefer, topics: [] };
  const catalog = known(groups);
  return { prefer, topics: [...picked].filter((slug) => catalog.has(slug)) };
}

export function selectionLine(
  groups: readonly TreeGroup[],
  picked: ReadonlySet<string>,
): { text: string; ready: boolean } {
  const { prefer, topics } = draftFrom(groups, picked);
  if (prefer.length === 0) {
    return { text: "Pick at least one area. A rep has to come from somewhere.", ready: false };
  }
  const areas = prefer.length === 1 ? "1 area" : `${prefer.length} areas`;
  if (topics.length === 0) {
    return { text: `${areas}, whole. New topics in them arrive as they are added.`, ready: true };
  }
  const count = topics.length === 1 ? "1 topic" : `${topics.length} topics`;
  return { text: `${areas}, narrowed to ${count}.`, ready: true };
}
