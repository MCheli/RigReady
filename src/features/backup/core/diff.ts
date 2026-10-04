/** Line-by-line comparison of two versions of a text file, for snapshots and "what changed". */

export interface DiffLine {
  kind: ' ' | '+' | '-';
  text: string;
}

export interface Hunk {
  /** 1-based first line in the old and new text. */
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface TextDiff {
  added: number;
  removed: number;
  hunks: Hunk[];
  /** Set when the files were too different to compare line by line in reasonable time. */
  tooLarge?: boolean;
}

/** A file is treated as text when its first 8 KB has no NUL byte and decodes as UTF-8. */
export function isText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) return false;
  try {
    // stream: a multi-byte character cut off at 8 KB is not an error.
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    // Not UTF-8: the file is binary, which is an answer, not a failure.
    return false;
  }
}

export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

const MAX_CELLS = 4_000_000;

/** The difference between two texts as hunks with `context` unchanged lines around each change. */
export function diffLines(before: string, after: string, context = 3): TextDiff {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const ops: DiffLine[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: ' ', text: a[i]! });
  let tooLarge = false;
  if (midA.length * midB.length > MAX_CELLS) {
    tooLarge = true;
    for (const text of midA) ops.push({ kind: '-', text });
    for (const text of midB) ops.push({ kind: '+', text });
  } else {
    ops.push(...lcsOps(midA, midB));
  }
  for (let i = endA; i < a.length; i++) ops.push({ kind: ' ', text: a[i]! });
  const added = ops.filter((o) => o.kind === '+').length;
  const removed = ops.filter((o) => o.kind === '-').length;
  return { added, removed, hunks: toHunks(ops, context), ...(tooLarge ? { tooLarge } : {}) };
}

function lcsOps(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  // lengths[i][j] = LCS of a[i..] and b[j..], in one flat array.
  const width = m + 1;
  const lengths = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i * width + j] =
        a[i] === b[j]
          ? lengths[(i + 1) * width + j + 1]! + 1
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    }
  }
  const ops: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: ' ', text: a[i]! });
      i++;
      j++;
    } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) {
      ops.push({ kind: '-', text: a[i++]! });
    } else {
      ops.push({ kind: '+', text: b[j++]! });
    }
  }
  while (i < n) ops.push({ kind: '-', text: a[i++]! });
  while (j < m) ops.push({ kind: '+', text: b[j++]! });
  return ops;
}

function toHunks(ops: DiffLine[], context: number): Hunk[] {
  const hunks: Hunk[] = [];
  const changed = ops.map((o, index) => (o.kind === ' ' ? -1 : index)).filter((i) => i >= 0);
  if (changed.length === 0) return hunks;
  // Line numbers before each op.
  const oldAt: number[] = [];
  const newAt: number[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const op of ops) {
    oldAt.push(oldLine);
    newAt.push(newLine);
    if (op.kind !== '+') oldLine++;
    if (op.kind !== '-') newLine++;
  }
  let from = Math.max(0, changed[0]! - context);
  let to = Math.min(ops.length, changed[0]! + context + 1);
  const flush = (): void => {
    hunks.push({ oldStart: oldAt[from]!, newStart: newAt[from]!, lines: ops.slice(from, to) });
  };
  for (const index of changed.slice(1)) {
    if (index - context <= to) {
      to = Math.min(ops.length, index + context + 1);
    } else {
      flush();
      from = Math.max(0, index - context);
      to = Math.min(ops.length, index + context + 1);
    }
  }
  flush();
  return hunks;
}
