/** Shift applies the clicked row's new state to the inclusive visible range. */
export function toggleOrderSelection(selected: number[], visible: number[], clicked: number, anchor: number | null, shift: boolean) {
  const next = new Set(selected);
  const select = !next.has(clicked);
  const start = anchor === null ? -1 : visible.indexOf(anchor);
  const end = visible.indexOf(clicked);
  const ids = shift && start >= 0 && end >= 0
    ? visible.slice(Math.min(start, end), Math.max(start, end) + 1)
    : [clicked];
  for (const id of ids) { if (select) next.add(id); else next.delete(id); }
  return [...next];
}

export function searchText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
