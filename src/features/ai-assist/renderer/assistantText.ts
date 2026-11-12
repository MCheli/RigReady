import {
  MAX_TOOL_ROUNDS,
  type AssistantProgress,
  type ConversationView,
  type Drafts,
  type Entry,
  type ScriptDraftView,
  type SetupDraftView,
  type TurnPreview,
} from '../core/assistantModel';

/**
 * What the assistant panel says in numbers and in which order it shows things, kept out of the
 * template so it can be tested: a cost is never rounded down to nothing, a count never reads
 * "1 requests", and a proposal is shown where it was made and only once.
 */

const n = (v: number): string => v.toLocaleString('en-US');

/** A count with its noun: "1 request", "2 requests". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${n(count)} ${count === 1 ? one : many}`;
}

/** A plain amount: "$0.25". */
export function dollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** An approximate cost, never shown as nothing: "about $0.33", "less than $0.01". */
export function about(amount: number): string {
  return amount < 0.01 ? 'less than $0.01' : `about ${dollars(amount)}`;
}

/**
 * The size of the request that waits. The cost is what reading this one request costs: the
 * answer and any request after it come on top, and the line says so.
 */
export function sizeLine(preview: TurnPreview): string {
  const parts = [
    `Request ${preview.round} of this question`,
    `about ${plural(preview.approxTokens, 'token')}`,
  ];
  if (preview.approxCost !== null) {
    parts.push(`${about(preview.approxCost)} to read, plus the answer`);
  }
  return parts.join(' · ');
}

/** What the question has cost so far and where RigReady stops to ask; empty with nothing to say. */
export function budgetLine(preview: TurnPreview): string {
  if (preview.approxCost === null) {
    return preview.local
      ? ''
      : 'No price is known for this model, so no cost is shown and no ceiling applies.';
  }
  const spent = preview.spent ?? 0;
  const soFar = spent > 0 ? `This question so far: ${about(spent)}. ` : '';
  if (preview.ceiling === null) return `${soFar}No ceiling is set in Settings.`;
  const most = `${dollars(preview.ceiling)}, the most a question may cost before RigReady asks you`;
  if (preview.overCeiling) {
    return spent > 0
      ? `This question has cost ${about(spent)} and this request would take it past ${most}.`
      : `Reading this request alone costs ${about(preview.approxCost)}, more than ${most}.`;
  }
  return `${soFar}RigReady asks before ${spent > 0 ? 'it' : 'a question'} passes ${dollars(preview.ceiling)}.`;
}

/** What the assistant is doing right now, for the line above the input. */
export function workingLine(progress: AssistantProgress | undefined): string {
  if (!progress) return 'Sending the request';
  return progress.phase === 'tool'
    ? `Running: ${progress.tool ?? 'a tool'} (request ${progress.round})`
    : `Waiting for the answer (request ${progress.round})`;
}

/** What the question has used so far while it works; empty before the first answer. */
export function spendLine(progress: AssistantProgress | undefined): string {
  if (!progress || progress.tokens === 0) return '';
  const cost = progress.cost === null ? '' : `, ${about(progress.cost)}`;
  return `${plural(progress.tokens, 'token')} so far${cost}`;
}

/** The conversation's total, under the input; empty before the first answer. */
export function usageLine(usage: ConversationView['usage']): string {
  if (usage.requests === 0) return '';
  const cached = usage.cached > 0 ? ` (${n(usage.cached)} read from cache)` : '';
  const cost = usage.cost === null ? '' : `, ${about(usage.cost)}`;
  return `This conversation: ${plural(usage.requests, 'request')}, ${plural(usage.input + usage.output, 'token')}${cached}${cost}`;
}

/** A typed amount of dollars: "0.25", "$0.25", "0,25", ".5". Anything else is no amount. */
export function parseDollars(text: string): number | undefined {
  const typed = text
    .trim()
    .replace(/^\$\s*/, '')
    .replace(',', '.');
  return /^(\d+(\.\d*)?|\.\d+)$/.test(typed) ? Number(typed) : undefined;
}

/** What the ceiling in Settings does, for the provider and model chosen there. */
export function ceilingHint(status: {
  questionCeiling: number;
  priceKnown: boolean;
  local: boolean;
}): string {
  const rounds = `A question still ends when the assistant has used tools ${MAX_TOOL_ROUNDS} times.`;
  if (!status.priceKnown) {
    return status.local
      ? `A server on this PC has no price per request, so no cost is shown and this amount is not used. ${rounds}`
      : `No price is known for this model, so no cost is shown and this amount is not used. ${rounds}`;
  }
  if (status.questionCeiling === 0) {
    return `No ceiling: RigReady does not stop a question for its cost. ${rounds}`;
  }
  return 'One question often takes several requests. Before a request would take a question past this amount, RigReady stops and asks you. An amount smaller than a single request costs holds back the first request too. 0 means no ceiling.';
}

export const PANEL_WIDTH = { fallback: 560, min: 420, max: 960, step: 24 } as const;

/** The panel's width for a wanted width in a window: at least 120 px of the page stay in sight. */
export function panelWidth(wanted: number, windowWidth: number): number {
  const most = Math.max(PANEL_WIDTH.min, Math.min(PANEL_WIDTH.max, windowWidth - 120));
  if (!Number.isFinite(wanted)) return Math.min(PANEL_WIDTH.fallback, most);
  return Math.round(Math.min(Math.max(wanted, PANEL_WIDTH.min), most));
}

export interface SavedLine {
  message: string;
  setupId?: string;
}

/** One thing in the conversation column, in the order it is shown. */
export type FlowItem =
  | { kind: 'entry'; key: string; entry: Entry }
  | { kind: 'setup'; key: string; draft: SetupDraftView }
  | { kind: 'script'; key: string; draft: ScriptDraftView }
  | { kind: 'saved'; key: string; id: string; done: SavedLine };

/**
 * The conversation with what was proposed in it. A draft, or the line that says it was saved,
 * comes right after the tool row that made it (the last one, when it was proposed again);
 * `waiting` holds what was drafted elsewhere: by another AI client, or in an earlier
 * conversation. Nothing is in both, and nothing twice.
 */
export function flow(
  entries: Entry[],
  drafts: Drafts,
  saved: Record<string, SavedLine>
): { conversation: FlowItem[]; waiting: FlowItem[] } {
  const setups = new Map(drafts.setups.map((d) => [d.id, d]));
  const scripts = new Map(drafts.scripts.map((d) => [d.id, d]));
  const last = new Map<string, number>();
  entries.forEach((entry, i) => {
    if (entry.kind === 'tool' && entry.draftId) last.set(entry.draftId, i);
  });
  const placed = new Set<string>();
  const itemFor = (id: string): FlowItem | undefined => {
    const setup = setups.get(id);
    if (setup) return { kind: 'setup', key: `setup:${id}`, draft: setup };
    const script = scripts.get(id);
    if (script) return { kind: 'script', key: `script:${id}`, draft: script };
    const done = saved[id];
    return done ? { kind: 'saved', key: `saved:${id}`, id, done } : undefined;
  };
  const conversation: FlowItem[] = [];
  entries.forEach((entry, i) => {
    conversation.push({ kind: 'entry', key: `entry:${i}`, entry });
    if (entry.kind !== 'tool' || !entry.draftId || last.get(entry.draftId) !== i) return;
    const item = itemFor(entry.draftId);
    if (!item) return;
    placed.add(entry.draftId);
    conversation.push(item);
  });
  const waiting: FlowItem[] = [];
  for (const id of [...setups.keys(), ...scripts.keys(), ...Object.keys(saved)]) {
    if (placed.has(id)) continue;
    const item = itemFor(id);
    if (!item) continue;
    placed.add(id);
    waiting.push(item);
  }
  return { conversation, waiting };
}
