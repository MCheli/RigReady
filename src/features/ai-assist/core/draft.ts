import { z } from 'zod';
import { PackSchema, PlaceSchema, RoleSchema, TierSchema, type Pack } from './pack';
import { devicesText, oneLine, type Snapshot } from './snapshot';
import type { Parsed } from './suggest';

/**
 * For an aircraft without a shipped guide: the model drafts one in the same format (tiers,
 * plain language, where each action belongs), every action checked against the
 * aircraft's real action list. The draft is saved under RigReady's data folder and marked
 * as drafted by AI wherever it is shown.
 */

export const MAX_DRAFT_ITEMS = 60;

export function draftSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'items'],
    properties: {
      summary: {
        type: 'string',
        description: 'Two or three sentences on how to set this aircraft up.',
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'tier', 'place', 'role', 'what', 'when', 'actionIds'],
          properties: {
            title: { type: 'string' },
            tier: { type: 'string', enum: ['must', 'should', 'nice'] },
            place: { type: 'string', enum: ['hotas', 'panel', 'keyboard'] },
            role: {
              type: 'string',
              enum: ['stick', 'throttle', 'pedals', 'mfd', 'panel', 'keyboard'],
            },
            what: { type: 'string', description: 'What it does, one sentence.' },
            when: { type: 'string', description: 'When you use it, one sentence.' },
            actionIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Ids from <actions>.',
            },
          },
        },
      },
    },
  };
}

export function draftTask(snapshot: Snapshot): string {
  return [
    devicesText(snapshot),
    '',
    `Task: write a binding guide for the ${oneLine(snapshot.aircraftName)} for someone who does not know it.`,
    '- Group the important controls into items (one item per switch or control, listing every action id it needs, for example the four directions of a trim hat).',
    '- tier must = needed to fly and fight; should = makes it much easier; nice = convenient.',
    '- place and role say where it belongs: on the stick, throttle or pedals (hotas), a panel, or fine on the keyboard.',
    `- 15 to ${MAX_DRAFT_ITEMS} items, most important first. Only ids from <actions>.`,
  ].join('\n');
}

const RawDraftSchema = z.object({
  summary: z.string().max(4000),
  items: z.array(z.unknown()).max(200),
});

const RawDraftItemSchema = z.object({
  title: z.string().min(1).max(200),
  tier: TierSchema,
  place: PlaceSchema,
  role: RoleSchema,
  what: z.string().min(1).max(2000),
  when: z.string().min(1).max(2000),
  actionIds: z.array(z.string().max(200)).min(1).max(40),
});

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

export function validateDraft(
  text: string,
  snapshot: Snapshot,
  model: string,
  at: string
): Parsed<{ pack: Pack; dropped: number }> {
  let json: unknown;
  try {
    json = JSON.parse(text.trim());
  } catch {
    return { ok: false, why: 'The answer was not the structured guide RigReady asked for.' };
  }
  const raw = RawDraftSchema.safeParse(json);
  if (!raw.success) return { ok: false, why: 'The answer did not have the shape of a guide.' };
  if (raw.data.items.length > MAX_DRAFT_ITEMS * 2) {
    return {
      ok: false,
      why: `The answer had ${raw.data.items.length} items, far more than asked for. Nothing from it was used.`,
    };
  }
  const byId = new Map(snapshot.actions.map((a) => [a.id, a]));
  let dropped = 0;
  const items: Pack['items'] = [];
  for (const entry of raw.data.items) {
    const item = RawDraftItemSchema.safeParse(entry);
    if (!item.success) {
      dropped++;
      continue;
    }
    const actions = [...new Set(item.data.actionIds)]
      .map((id) => byId.get(id))
      .filter((a) => a !== undefined);
    if (actions.length === 0) {
      dropped++;
      continue;
    }
    items.push({
      id: `item-${items.length + 1}`,
      title: clip(oneLine(item.data.title, 200), 80),
      tier: item.data.tier,
      place: item.data.place,
      role: item.data.role,
      need: 'all',
      what: clip(oneLine(item.data.what, 2000), 600),
      when: clip(oneLine(item.data.when, 2000), 300),
      actions: actions.map((a) => ({
        name: clip(a.name, 200),
        label: clip(oneLine(a.name, 120), 120),
      })),
    });
    if (items.length >= MAX_DRAFT_ITEMS) break;
  }
  if (items.length === 0)
    return {
      ok: false,
      why: 'None of the items in the answer named a real action of this aircraft.',
    };
  const roles: Pack['roles'] = {};
  for (const item of items) {
    const plan = roles[item.role] ?? { summary: 'As drafted.', items: [] };
    plan.items.push(item.id);
    roles[item.role] = plan;
  }
  const pack = PackSchema.safeParse({
    format: 1,
    aircraft: { id: snapshot.aircraftId, name: clip(oneLine(snapshot.aircraftName, 80), 80) },
    summary: clip(oneLine(raw.data.summary, 4000), 800) || 'Drafted by AI.',
    sources: [
      `Drafted by ${model} from DCS's action list for this aircraft. Not checked by a person.`,
    ],
    drafted: { by: model, at },
    roles,
    items,
  });
  if (!pack.success) return { ok: false, why: 'The drafted guide did not fit the guide format.' };
  return { ok: true, value: { pack: pack.data, dropped } };
}
