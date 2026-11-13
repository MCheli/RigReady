import * as yaml from 'js-yaml';
import type { BoundAction } from '../../../core/bindings';
import type { RigError } from '../../../core/result';
import { MAX_PATTERN, MAX_REPEATS, type Pack } from './pack';

/**
 * A binding guide of the user's own: a file somebody shared, or one written by hand. It is
 * kept where a guide drafted by AI is kept, one file per aircraft in RigReady's data folder,
 * and goes through the same parser as every other guide. No AI key is involved.
 */

/** A guide file larger than this is not read: a full one is a few tens of thousands of characters. */
export const MAX_GUIDE_BYTES = 512 * 1024;

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() : flat;
};

/** What is wrong with a guide file, in one line a person can act on. */
export function guideProblem(error: RigError): string {
  const where = (error.detail ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 4)
    .join(' ');
  const text = where ? `${error.message} ${where}` : error.message;
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

/**
 * A short guide that is valid as it stands, built on real actions of the aircraft, with the
 * format explained above it. The user edits it from there.
 */
export function starterGuide(
  aircraft: { id: string; name: string },
  actions: BoundAction[]
): string {
  const named = actions.filter((a) => a.name.trim().length > 0);
  const examples = [
    named.find((a) => a.kind === 'button' && a.editable),
    named.find((a) => a.kind === 'axis' && a.editable),
  ].filter((a) => a !== undefined);
  const chosen = examples.length > 0 ? examples : named.slice(0, 1);
  const name = oneLine(aircraft.name, 80) || aircraft.id;
  const items: Pack['items'] = chosen.map((action, n) => ({
    id: `example-${n + 1}`,
    title: oneLine(action.name, 80),
    tier: 'must',
    place: 'hotas',
    role: action.kind === 'axis' ? 'throttle' : 'stick',
    need: 'all',
    what: 'Replace this with what it does, in plain words.',
    when: 'Replace this with when you need it.',
    actions: [{ name: oneLine(action.name, 200), label: oneLine(action.name, 120) }],
  }));
  const roles: Pack['roles'] = {};
  for (const item of items) {
    const plan = roles[item.role] ?? { summary: 'Replace this with what goes here.', items: [] };
    plan.items.push(item.id);
    roles[item.role] = plan;
  }
  const pack: Pack = {
    format: 1,
    aircraft: { id: aircraft.id, name },
    summary: `My own guide for the ${name}. Replace this with a few words on how you set it up.`,
    sources: ['Written by hand.'],
    roles,
    items,
  };
  const head = [
    `# Your own binding guide for the ${name}, kept in RigReady's data folder on this PC.`,
    '# It leaves the PC only as part of a request for AI help for this aircraft, if you ever',
    '# send one: its summary and items are in that request, which is shown to you first.',
    '#',
    '# How to write it:',
    '#   items    One entry per thing worth binding. Copy an example and change it.',
    '#   id       Lower-case letters, digits and dashes. Each id once.',
    '#   tier     must, should or nice.',
    '#   place    hotas, panel or keyboard: where it belongs.',
    '#   role     stick, throttle, pedals, mfd, panel or keyboard: the device it goes on.',
    '#   need     all (every action listed should be bound) or any (one is enough).',
    '#   what     What it does, in plain words. "when" says when you need it. "note" is optional.',
    "#   actions  DCS's own name of an action, word for word as its Controls screen shows it,",
    '#            with a plain label. Or one line "re:" with a pattern that matches several',
    `#            names: at most ${MAX_PATTERN} characters, no group that repeats, and "*", "+"`,
    `#            or "{…}" at most ${MAX_REPEATS} times.`,
    '#   roles    For each device, a summary and the ids of the items that go on it.',
    '#',
    '# Save the file, then press "Read it again" on the Binding guide page. When something does',
    '# not fit, the page says what and where.',
    '',
  ].join('\n');
  return `${head}${yaml.dump(pack, { lineWidth: 100 })}`;
}
