import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';
import type { BoundAction } from '../../../core/bindings';
import { streamedMessage } from '../../../../tests/aiStream';
import { BINDING_FILES, HORNET } from '../../../../tests/dcsBindings';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { AiStatus, GuideView, Prepared } from './model';
import { MAX_GUIDE_BYTES } from './ownGuide';
import { MAX_PATTERN, parsePack } from './pack';

/**
 * AI-009: a binding guide of the user's own, for an aircraft RigReady ships no guide for.
 * Imported from a file or started by hand, through the same parser and the same place on
 * disk as a guide drafted by AI, and with no AI key stored anywhere in these tests but the
 * one that says a draft never replaces it.
 */

/** A seat with no shipped guide in the recorded DCS install. */
const GUNNER = 'UH-1H_Gunner';
const KEY = 'sk-ant-unit-NOT-A-REAL-KEY-0000-abcd';

let app: WiredApp;
afterEach(() => app?.cleanup());

async function start(): Promise<BoundAction[]> {
  app = await wiredApp('dcs-bindings-hornet', { files: BINDING_FILES });
  const actions = await app.wiring.context.bindings.get('dcs')!.actions!(GUNNER);
  if (!actions.ok) throw new Error(actions.error.message);
  return actions.value;
}

type Draft = {
  aircraft: { id: string; name: string };
  drafted?: { by: string; at: string };
  items: { actions: unknown[] }[];
};

/** A small guide for the gunner on one real action, as somebody would share it. */
function guideText(actions: BoundAction[], change: (pack: Draft) => void = () => {}): string {
  const pack = {
    format: 1,
    aircraft: { id: GUNNER, name: 'UH-1H door gunner' },
    summary: 'The door gun first.',
    sources: ['A friend who flies it.'],
    roles: { stick: { summary: 'The gun goes on the stick.', items: ['fire'] } },
    items: [
      {
        id: 'fire',
        title: 'Fire the door gun',
        tier: 'must',
        place: 'hotas',
        role: 'stick',
        what: 'Fires the gun.',
        when: 'Gun runs.',
        actions: [{ name: actions[0]!.name, label: 'Fire' }] as unknown[],
      },
    ],
  };
  change(pack);
  return `# Shared by a friend.\n${yaml.dump(pack)}`;
}

const keptFile = (): string =>
  path.join(app.ports.folders.dataRoot(), 'ai-assist', 'guides', `${GUNNER}.yaml`);

const exists = (file: string): Promise<boolean> =>
  fs.stat(file).then(
    () => true,
    () => false
  );

/** Puts a file where the user would have it and makes the Windows dialog answer with it. */
async function pick(text: string, name = 'gunner.yaml'): Promise<string> {
  const file = path.join(app.home, 'Documents', 'Guides from friends', name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf8');
  app.ports.dialogs.script.open.push([file]);
  return file;
}

const view = (): Promise<GuideView> =>
  app.invoke<GuideView>('ai-assist:guide', { aircraftId: GUNNER });

const listed = async (): Promise<string | null | undefined> =>
  (
    await app.invoke<{ aircraft: { id: string; guide: string | null }[] }>('ai-assist:aircraft')
  ).aircraft.find((a) => a.id === GUNNER)?.guide;

/** Every file below a folder with its content, except RigReady's own data folder. */
async function outsideTheDataFolder(): Promise<Record<string, string>> {
  const data = path.resolve(app.ports.folders.dataRoot());
  const found: Record<string, string> = {};
  for (const entry of await fs.readdir(app.home, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const file = path.resolve(entry.parentPath, entry.name);
    if (file.startsWith(data + path.sep)) continue;
    found[file] = await fs.readFile(file, 'latin1');
  }
  return found;
}

describe('AI-009 a binding guide can be imported from a file, with no AI key', () => {
  it('takes the file picked in the Windows dialog, checks it, keeps a copy in the data folder and shows it as your own', async () => {
    const actions = await start();
    expect(await listed()).toBeNull();
    expect((await view()).stored).toBeNull();
    const text = guideText(actions);
    const source = await pick(text);
    const before = await outsideTheDataFolder();

    expect(await app.invoke('ai-assist:importGuide', { aircraftId: GUNNER })).toEqual({
      imported: true,
      items: 1,
    });

    expect(app.ports.dialogs.calls).toHaveLength(1);
    expect(app.ports.dialogs.calls[0]).toMatchObject({
      kind: 'open',
      options: { filters: [{ name: 'Binding guide', extensions: ['yaml', 'yml'] }] },
    });
    const guide = await view();
    expect(guide.guide).toMatchObject({ kind: 'own', summary: 'The door gun first.' });
    expect(guide.guide?.drafted).toBeUndefined();
    expect(guide.stored).toEqual({});
    expect(guide.tiers.flatMap((t) => t.items).map((i) => i.title)).toEqual(['Fire the door gun']);
    expect(await listed()).toBe('own');
    // The copy is the file as it was shared, word for word; the file picked is untouched.
    expect(await fs.readFile(keptFile(), 'utf8')).toBe(text);
    expect(await fs.readFile(source, 'utf8')).toBe(text);
    expect(await outsideTheDataFolder()).toEqual(before);
    // No key was stored and nothing was sent anywhere.
    expect((await app.invoke<AiStatus>('ai-assist:status')).ready).toBe(false);
    expect(app.ports.http.calls).toEqual([]);
  });

  it('changes nothing when the dialog is closed without a file', async () => {
    await start();
    expect(await app.invoke('ai-assist:importGuide', { aircraftId: GUNNER })).toEqual({
      imported: false,
      items: 0,
    });
    expect(await exists(keptFile())).toBe(false);
  });

  it('refuses a file that is not a guide, a guide for another aircraft and a file that is too large, and says why', async () => {
    const actions = await start();
    const go = (): Promise<unknown> => app.invoke('ai-assist:importGuide', { aircraftId: GUNNER });

    await pick('{ this is not yaml');
    await expect(go()).rejects.toThrow(/gunner\.yaml is not valid YAML/);

    await pick(guideText(actions).replace('tier: must', 'tier: urgent'), 'typo.yaml');
    await expect(go()).rejects.toThrow(/typo\.yaml is not a valid binding guide\..*tier/s);

    await pick(
      guideText(actions, (pack) => {
        pack.aircraft = { id: 'Mi-8MT', name: 'Mi-8MTV2' };
      })
    );
    await expect(go()).rejects.toThrow(
      /That guide is for the Mi-8MTV2 \(Mi-8MT\)\. The aircraft shown here is the .* \(UH-1H_Gunner\)\./
    );

    await pick(`${guideText(actions)}\n#${'x'.repeat(MAX_GUIDE_BYTES)}`);
    await expect(go()).rejects.toThrow(/larger than a binding guide can be \(512 KB\)/);

    app.ports.dialogs.script.open.push([path.join(app.home, 'Documents', 'gone.yaml')]);
    await expect(go()).rejects.toThrow(/That file could not be found/);

    expect(await exists(keptFile())).toBe(false);
    expect(await listed()).toBeNull();
  });

  it('a guide written for a variant of the aircraft is taken, whatever the case of the id', async () => {
    const actions = await start();
    await pick(
      guideText(actions, (pack) => {
        pack.aircraft = { id: 'uh-1h_gunner', name: 'UH-1H door gunner' };
      })
    );
    expect(await app.invoke('ai-assist:importGuide', { aircraftId: GUNNER })).toMatchObject({
      imported: true,
    });
  });

  it('refuses where RigReady includes a guide, and never replaces a guide file that is kept', async () => {
    const actions = await start();
    await expect(app.invoke('ai-assist:importGuide', { aircraftId: HORNET })).rejects.toThrow(
      /RigReady includes a guide for this aircraft and uses that one/
    );
    await expect(app.invoke('ai-assist:startOwnGuide', { aircraftId: HORNET })).rejects.toThrow(
      /RigReady includes a guide for this aircraft/
    );
    // The dialog is not even opened for an aircraft that cannot take a guide file.
    expect(app.ports.dialogs.calls).toHaveLength(0);

    const text = guideText(actions);
    await pick(text);
    await app.invoke('ai-assist:importGuide', { aircraftId: GUNNER });
    await pick(text.replace('The door gun first.', 'Another one.'), 'second.yaml');
    await expect(app.invoke('ai-assist:importGuide', { aircraftId: GUNNER })).rejects.toThrow(
      /There is a guide file for this aircraft already\. Open it, or delete it first\./
    );
    await expect(app.invoke('ai-assist:startOwnGuide', { aircraftId: GUNNER })).rejects.toThrow(
      /There is a guide file for this aircraft already/
    );
    expect(await fs.readFile(keptFile(), 'utf8')).toBe(text);
  });
});

describe('AI-009 a pattern in a guide is held to the same limits, whoever wrote the guide', () => {
  const withPattern =
    (re: string) =>
    (pack: Draft): void => {
      pack.items[0]!.actions = [{ re }];
    };
  const long = `^Fire${'.'.repeat(MAX_PATTERN - 4)}`;

  it('refuses an imported guide whose pattern is too long, repeats a group or repeats too often', async () => {
    const actions = await start();
    const go = (): Promise<unknown> => app.invoke('ai-assist:importGuide', { aircraftId: GUNNER });
    expect(long).toHaveLength(MAX_PATTERN + 1);

    await pick(guideText(actions, withPattern(long)));
    await expect(go()).rejects.toThrow(/not a valid binding guide\..*100/s);
    await pick(guideText(actions, withPattern('^(Fire ?)+$')));
    await expect(go()).rejects.toThrow(/item fire: a pattern may not repeat a group/);
    await pick(guideText(actions, withPattern('^.*F.*i.*re$')));
    await expect(go()).rejects.toThrow(
      /item fire: a pattern may use \*, \+ or \{…\} at most 2 times/
    );
    expect(await exists(keptFile())).toBe(false);

    // A pattern at the limit is taken.
    await pick(guideText(actions, withPattern(long.slice(0, MAX_PATTERN))));
    expect(await go()).toMatchObject({ imported: true });
  });

  it('holds a guide drafted by AI and a guide edited by hand to them each time the file is read', async () => {
    const actions = await start();
    await fs.mkdir(path.dirname(keptFile()), { recursive: true });
    const drafted = (pack: Draft): void => {
      pack.drafted = { by: 'some-model', at: '2026-11-12T10:00:00.000Z' };
    };
    await fs.writeFile(keptFile(), guideText(actions, drafted), 'utf8');
    expect((await view()).guide).toMatchObject({ kind: 'drafted' });

    for (const [re, said] of [
      [long, /100/],
      ['^(Fire ?)+$', /item fire: a pattern may not repeat a group/],
      ['^.*F.*i.*re$', /at most 2 times/],
    ] as const) {
      const text = guideText(actions, (pack) => {
        drafted(pack);
        withPattern(re)(pack);
      });
      await fs.writeFile(keptFile(), text, 'utf8');
      const guide = await view();
      // The file is not used, and the page is told what is wrong with it.
      expect(guide.guide).toBeNull();
      expect(guide.tiers.flatMap((t) => t.items)).toEqual([]);
      expect(guide.stored?.problem).toMatch(/is not a valid binding guide\./);
      expect(guide.stored?.problem).toMatch(said);
      expect(await listed()).toBeNull();
    }
  });
});

describe('AI-009 a binding guide can be written by hand, with no AI key', () => {
  it('starts a short guide that is valid as it stands, on real actions of the aircraft, with the format explained', async () => {
    const actions = await start();
    const before = await outsideTheDataFolder();
    expect(await app.invoke('ai-assist:startOwnGuide', { aircraftId: GUNNER })).toEqual({
      started: true,
    });

    const text = await fs.readFile(keptFile(), 'utf8');
    expect(text).toMatch(/^# Your own binding guide for the /);
    expect(text).toContain('# How to write it:');
    expect(text).toContain('press "Read it again" on the Binding guide page');
    const pack = parsePack(text);
    if (!pack.ok) throw new Error(pack.error.detail);
    expect(pack.value.aircraft.id).toBe(GUNNER);
    expect(pack.value.drafted).toBeUndefined();
    expect(pack.value.sources).toEqual(['Written by hand.']);
    const names = new Set(actions.map((a) => a.name));
    const used = pack.value.items.flatMap((i) => i.actions);
    expect(used.length).toBeGreaterThan(0);
    for (const spec of used) expect('name' in spec && names.has(spec.name)).toBe(true);

    const guide = await view();
    expect(guide.guide).toMatchObject({ kind: 'own' });
    expect(guide.stored).toEqual({});
    expect(guide.tiers.flatMap((t) => t.items).length).toBe(pack.value.items.length);
    expect(await listed()).toBe('own');
    expect(await outsideTheDataFolder()).toEqual(before);
    expect(app.ports.http.calls).toEqual([]);
  });

  it('reads the file again after an edit, and says what is wrong with an edit that does not fit', async () => {
    await start();
    await app.invoke('ai-assist:startOwnGuide', { aircraftId: GUNNER });
    const started = await fs.readFile(keptFile(), 'utf8');
    const title = parsePack(started);
    if (!title.ok) throw new Error(title.error.detail);
    const first = title.value.items[0]!.title;

    await fs.writeFile(keptFile(), started.replace(`title: ${first}`, 'title: Door gun'), 'utf8');
    expect((await view()).tiers.flatMap((t) => t.items).map((i) => i.title)).toContain('Door gun');

    await fs.writeFile(keptFile(), started.replace('tier: must', 'tier: first'), 'utf8');
    const broken = await view();
    expect(broken.guide).toBeNull();
    expect(broken.stored?.problem).toMatch(/UH-1H_Gunner\.yaml is not a valid binding guide\./);
    expect(broken.stored?.problem).toMatch(/tier/);
    expect(broken.stored!.problem!.length).toBeLessThanOrEqual(401);
    // The file stays for the user to mend: nothing replaces it but they themselves.
    await expect(app.invoke('ai-assist:startOwnGuide', { aircraftId: GUNNER })).rejects.toThrow(
      /There is a guide file for this aircraft already/
    );

    await fs.writeFile(keptFile(), started, 'utf8');
    expect((await view()).guide).toMatchObject({ kind: 'own' });
  });

  it('"Open the file" starts Notepad with the kept guide file as its one argument, and with no other file', async () => {
    await start();
    await expect(app.invoke('ai-assist:openGuideFile', { aircraftId: GUNNER })).rejects.toThrow(
      /There is no guide file for this aircraft/
    );
    // An id that tries to name a file elsewhere names no file at all.
    for (const aircraftId of ['..\\..\\mcp\\bridge-token', '../../settings', HORNET]) {
      await expect(app.invoke('ai-assist:openGuideFile', { aircraftId })).rejects.toThrow(
        /There is no guide file for this aircraft/
      );
    }
    expect(app.ports.shell.calls).toEqual([]);

    await app.invoke('ai-assist:startOwnGuide', { aircraftId: GUNNER });
    expect(await app.invoke('ai-assist:openGuideFile', { aircraftId: GUNNER })).toEqual({
      opened: true,
    });
    expect(app.ports.shell.calls).toEqual([
      { exe: path.join(app.ports.folders.windows(), 'notepad.exe'), args: [keptFile()] },
    ]);
  });

  it('deleting takes the guide file away, and the aircraft has no guide again', async () => {
    await start();
    await app.invoke('ai-assist:startOwnGuide', { aircraftId: GUNNER });
    expect(await app.invoke('ai-assist:deleteDraft', { aircraftId: GUNNER })).toEqual({
      deleted: true,
    });
    expect(await exists(keptFile())).toBe(false);
    expect(await listed()).toBeNull();
    expect((await view()).stored).toBeNull();
  });
});

describe('AI-009 a draft by AI never replaces a guide of your own', () => {
  const draftAnswer = (actions: BoundAction[]) =>
    streamedMessage(
      JSON.stringify({
        summary: 'Gunner basics.',
        items: [
          {
            title: 'Fire',
            tier: 'must',
            place: 'hotas',
            role: 'stick',
            what: 'Fires the door gun.',
            when: 'Gun runs.',
            actionIds: [actions[0]!.id],
          },
        ],
      })
    );

  it('is refused while a guide file of your own is kept, and nothing is sent', async () => {
    const actions = await start();
    await app.invoke('settings:setAiKey', { key: KEY });
    await pick(guideText(actions));
    await app.invoke('ai-assist:importGuide', { aircraftId: GUNNER });
    await expect(
      app.invoke('ai-assist:prepare', { aircraftId: GUNNER, kind: 'draft' })
    ).rejects.toThrow(/This aircraft has a guide file of your own, and a draft would replace it/);
    expect(app.ports.http.calls).toEqual([]);
  });

  it('a request shown before the guide was imported sends nothing afterwards and leaves the file alone', async () => {
    const actions = await start();
    await app.invoke('settings:setAiKey', { key: KEY });
    app.ports.http.scripts.push({
      match: { url: '/v1/messages', body: 'write a binding guide' },
      response: { status: 200, headers: {}, ...draftAnswer(actions) },
    });
    const shown = await app.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: GUNNER,
      kind: 'draft',
    });
    const text = guideText(actions);
    await pick(text);
    await app.invoke('ai-assist:importGuide', { aircraftId: GUNNER });

    await expect(app.invoke('ai-assist:send', { requestId: shown.requestId })).rejects.toThrow(
      /A guide file of your own was added for this aircraft meanwhile\. Nothing was sent\./
    );
    expect(app.ports.http.calls).toEqual([]);
    expect(await fs.readFile(keptFile(), 'utf8')).toBe(text);
    expect((await view()).guide).toMatchObject({ kind: 'own' });
  });

  it('a draft still replaces an earlier draft, as before', async () => {
    const actions = await start();
    await app.invoke('settings:setAiKey', { key: KEY });
    app.ports.http.scripts.push({
      match: { url: '/v1/messages', body: 'write a binding guide' },
      times: 2,
      response: { status: 200, headers: {}, ...draftAnswer(actions) },
    });
    for (let round = 0; round < 2; round++) {
      const shown = await app.invoke<Prepared>('ai-assist:prepare', {
        aircraftId: GUNNER,
        kind: 'draft',
      });
      expect(await app.invoke('ai-assist:send', { requestId: shown.requestId })).toMatchObject({
        kind: 'draft',
        items: 1,
      });
    }
    expect((await view()).guide).toMatchObject({ kind: 'drafted' });
    expect((await view()).stored).toEqual({});
  });
});

describe('AI-009 a request for AI help says whose guide it carries', () => {
  it('names a guide of your own as yours, in the preview and in the request itself', async () => {
    const actions = await start();
    await app.invoke('settings:setAiKey', { key: KEY });
    await pick(guideText(actions));
    await app.invoke('ai-assist:importGuide', { aircraftId: GUNNER });

    const own = await app.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: GUNNER,
      kind: 'ask',
      question: 'What should go on the stick?',
    });
    expect(own.contents).toContain(
      'Your own guide for this aircraft: its summary and each item with its title, tier, place and what it does'
    );
    expect(own.body).toContain('a binding guide the player wrote or was given for this aircraft');
    expect(own.body).toContain('Fire the door gun');
    expect(own.body).not.toContain("RigReady's binding guide for this aircraft");

    const shippedOne = await app.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: HORNET,
      kind: 'ask',
      question: 'What should go on the stick?',
    });
    expect(shippedOne.contents).toContain("RigReady's binding guide for this aircraft");
    expect(shippedOne.body).toContain("RigReady's binding guide for this aircraft");
    // Showing a request sends nothing.
    expect(app.ports.http.calls).toEqual([]);
  });

  it('Settings says that a guide of your own is part of such a request', async () => {
    await start();
    const status = await app.invoke<AiStatus>('ai-assist:status');
    const guide = status.whatIsSent.find((p) => /binding guide/.test(p.title))!.lines.join(' ');
    expect(guide).toMatch(
      /Sent: the guide for the aircraft when there is one \(RigReady's, one drafted by AI, or your own\)/
    );
    expect(guide).toMatch(/or any other content of your files\./);
  });
});
