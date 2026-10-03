/**
 * A small line diff, for showing exactly what a change will write to a file before it
 * is written. Binding files are a few hundred lines, so a plain LCS table is enough.
 */

export interface DiffLine {
  type: 'same' | 'add' | 'del' | 'gap';
  text: string;
}

const MAX_CELLS = 4_000_000;

export function lineDiff(before: string, after: string, context = 2): DiffLine[] {
  const a = before === '' ? [] : before.split(/\r?\n/);
  const b = after === '' ? [] : after.split(/\r?\n/);
  // Trim the common head and tail first; edits are local.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  const middle: DiffLine[] = [];
  if (midA.length * midB.length > MAX_CELLS) {
    for (const text of midA) middle.push({ type: 'del', text });
    for (const text of midB) middle.push({ type: 'add', text });
  } else {
    const rows = midA.length + 1;
    const cols = midB.length + 1;
    const table = new Uint32Array(rows * cols);
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        table[i * cols + j] =
          midA[i] === midB[j]
            ? table[(i + 1) * cols + j + 1]! + 1
            : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (midA[i] === midB[j]) {
        middle.push({ type: 'same', text: midA[i]! });
        i++;
        j++;
      } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) {
        middle.push({ type: 'del', text: midA[i++]! });
      } else {
        middle.push({ type: 'add', text: midB[j++]! });
      }
    }
    while (i < midA.length) middle.push({ type: 'del', text: midA[i++]! });
    while (j < midB.length) middle.push({ type: 'add', text: midB[j++]! });
  }

  const all: DiffLine[] = [
    ...a.slice(0, head).map((text) => ({ type: 'same' as const, text })),
    ...middle,
    ...a.slice(a.length - tail).map((text) => ({ type: 'same' as const, text })),
  ];
  // Keep changed lines with a little context; replace long unchanged runs with a gap marker.
  const keep = new Array<boolean>(all.length).fill(false);
  all.forEach((line, index) => {
    if (line.type === 'same') return;
    for (
      let k = Math.max(0, index - context);
      k <= Math.min(all.length - 1, index + context);
      k++
    ) {
      keep[k] = true;
    }
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  all.forEach((line, index) => {
    if (keep[index]) {
      if (skipped > 0) out.push({ type: 'gap', text: `${skipped} unchanged lines` });
      skipped = 0;
      out.push(line);
    } else {
      skipped++;
    }
  });
  if (skipped > 0 && out.length > 0) out.push({ type: 'gap', text: `${skipped} unchanged lines` });
  return out;
}
