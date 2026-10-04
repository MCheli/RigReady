import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../../core/logger';
import { BINDING_FILES, diffFile, HORNET } from '../../../../tests/dcsBindings';
import { messageEvents, streamedMessage, streamOf } from '../../../../tests/aiStream';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type {
  AiStatus,
  AppliedView,
  GuideView,
  PlanView,
  Prepared,
  Progress,
  SendProgress,
  Sent,
} from './model';
import { AiAssist } from './service';

const KEY = 'sk-ant-api03-SECRETSECRETSECRET-abcdEFGH';
const STICK = '806DDF00-B756-11F0-8023-444553540000';
const THROTTLE = '806DDF00-B756-11F0-8022-444553540000';
const IDS = {
  pickle: 'key:d3003pnilu3003cd13vd1vpnilvu0',
  atc: 'key:d3037pnilu3037cd13vd1vpnilvu0',
  cage: 'key:d3031pnilu3031cd13vd1vpnilvu0',
  gear: 'key:d68pnilunilcdnilvdnilvpnilvunil',
  pitch: 'axis:a2001cdnil',
  score: 'key:diCommandScoresWindowTogglepnilunilcdnilvdnilvpnilvunil',
};

let app: WiredApp;
afterEach(() => app?.cleanup());

async function start(): Promise<WiredApp> {
  app = await wiredApp('dcs-bindings-hornet', { files: BINDING_FILES });
  return app;
}

async function storeKey(): Promise<void> {
  await app.invoke('settings:setAiKey', { key: KEY });
}

const USAGE = {
  input_tokens: 1200,
  output_tokens: 900,
  cache_creation_input_tokens: 30000,
  cache_read_input_tokens: 0,
};

const planText = (items: unknown[]): string =>
  JSON.stringify({ summary: 'Put the carrier switches on the HOTAS.', items, notes: [] });

/** A suggestion answer as the API streams it. */
const suggestionAnswer = (items: unknown[]) => streamedMessage(planText(items), { usage: USAGE });

/** Every file under a folder, as text. */
async function allText(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile())
      out.push(await fs.readFile(path.join(entry.parentPath, entry.name), 'latin1'));
  }
  return out;
}

describe('the binding guide without a key', () => {
  it('lists the aircraft with their guides, and shows no AI controls without a key', async () => {
    await start();
    const list = await app.invoke<{ aircraft: { id: string; guide: string | null }[] }>(
      'ai-assist:aircraft'
    );
    expect(list.aircraft.slice(0, 2)).toMatchObject([
      { id: HORNET, guide: 'shipped' },
      { id: 'UH-1H', guide: 'shipped' },
    ]);
    expect(list.aircraft.find((a) => a.id === 'UH-1H_Gunner')?.guide).toBeNull();
    const status = await app.invoke<AiStatus>('ai-assist:status');
    expect(status).toMatchObject({ keyPresent: false, model: 'claude-opus-5-5' });
    expect(status.keyHint).toBeUndefined();
    await expect(
      app.invoke('ai-assist:prepare', { aircraftId: HORNET, kind: 'suggest' })
    ).rejects.toThrow(/No Anthropic API key/);
    expect(app.ports.http.calls).toEqual([]);
  });

  it('shows each item in tiers with what it is bound to now, and the plan per device', async () => {
    await start();
    const guide = await app.invoke<GuideView>('ai-assist:guide', { aircraftId: HORNET });
    expect(guide.tiers.map((t) => t.title)).toEqual([
      'Must have to fly and fight',
      'Should have',
      'Nice to have',
    ]);
    const trigger = guide.tiers[0]!.items.find((i) => i.id === 'trigger')!;
    expect(trigger).toMatchObject({
      status: 'bound',
      placeTitle: 'On the stick, throttle or pedals',
      roleTitle: 'Stick',
    });
    expect(trigger.actions[0]!.bound[0]!.text).toBe(
      'WINWING Orion Joystick Base 2 + JGRIP-F16 · Button 5'
    );
    expect(guide.guide?.roles.map((r) => r.role)).toEqual([
      'stick',
      'throttle',
      'pedals',
      'mfd',
      'panel',
      'keyboard',
    ]);
    expect(guide.controllers.some((c) => c.name.startsWith('FANATEC'))).toBe(false);
    // An aircraft without a guide still opens.
    const gunner = await app.invoke<GuideView>('ai-assist:guide', { aircraftId: 'UH-1H_Gunner' });
    expect(gunner.guide).toBeNull();
  });

  it('stages a pressed control, previews the exact file change, writes it through the bindings feature, and undoes it', async () => {
    await start();
    const file = await diffFile(app.home, 'WINWING Orion Joystick');
    const before = await fs.readFile(file, 'utf8');

    let guide = await app.invoke<GuideView>('ai-assist:stage', {
      aircraftId: HORNET,
      actionId: IDS.cage,
      deviceGuid: STICK.toLowerCase(),
      input: 'JOY_BTN5',
    });
    expect(guide.staged).toEqual([
      expect.objectContaining({
        label: 'Cage / uncage',
        inputLabel: 'Button 5',
        replaces: ['Gun Trigger - SECOND DETENT (Press to shoot)'],
      }),
    ]);
    // Staging again for the same action replaces the first press.
    guide = await app.invoke<GuideView>('ai-assist:stage', {
      aircraftId: HORNET,
      actionId: IDS.cage,
      deviceGuid: STICK,
      input: 'JOY_BTN21',
    });
    expect(guide.staged).toHaveLength(1);
    expect(guide.staged[0]).toMatchObject({ input: 'JOY_BTN21', replaces: [] });
    expect(await fs.readFile(file, 'utf8')).toBe(before);

    const plan = await app.invoke<PlanView>('ai-assist:reviewStaged', { aircraftId: HORNET });
    expect(plan.summary).toBe('Bind 1 action from the binding guide (F/A-18C)');
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]!.lines).toEqual(['Cage/Uncage Button: bind Button 21']);
    expect(plan.files[0]!.diff.some((l) => l.type === 'add' && l.text.includes('JOY_BTN21'))).toBe(
      true
    );
    expect(await fs.readFile(file, 'utf8')).toBe(before);

    const applied = await app.invoke<AppliedView>('ai-assist:applyStaged', { aircraftId: HORNET });
    expect(applied.files).toBe(1);
    expect(await fs.readFile(file, 'utf8')).toContain('JOY_BTN21');
    const journal = await app.ports.files.journalGroups();
    expect(journal.ok && journal.value[0]).toMatchObject({
      reason: 'Bind 1 action from the binding guide (F/A-18C)',
    });
    guide = await app.invoke<GuideView>('ai-assist:guide', { aircraftId: HORNET });
    expect(guide.staged).toEqual([]);
    const cage = guide.tiers.flatMap((t) => t.items).find((i) => i.id === 'cage')!;
    expect(cage.actions[0]!.bound.map((b) => b.text)).toContain(
      'WINWING Orion Joystick Base 2 + JGRIP-F16 · Button 21'
    );

    await app.invoke('ai-assist:undo', { groupId: applied.groupId });
    expect(await fs.readFile(file, 'utf8')).toBe(before);
  });

  it('refuses a control that cannot do the action, and two staged changes on one control', async () => {
    await start();
    const stage = (actionId: string, deviceGuid: string, input: string) =>
      app.invoke('ai-assist:stage', { aircraftId: HORNET, actionId, deviceGuid, input });
    await expect(stage(IDS.pitch, STICK, 'JOY_BTN3')).rejects.toThrow(/needs an axis/);
    await expect(stage(IDS.cage, STICK, 'JOY_X')).rejects.toThrow(/needs a button or hat/);
    await expect(stage(IDS.cage, STICK, 'JOY_BTN99')).rejects.toThrow(/has no such control/);
    await expect(
      stage(IDS.cage, '20B0BED0-03A4-11F1-8001-444553540000', 'JOY_BTN1')
    ).rejects.toThrow(/not one DCS uses/);
    await expect(stage(IDS.score, STICK, 'JOY_BTN1')).rejects.toThrow(/cannot write/);
    await expect(stage('key:nope', STICK, 'JOY_BTN1')).rejects.toThrow(/no such action/);
    await expect(app.invoke('ai-assist:reviewStaged', { aircraftId: HORNET })).rejects.toThrow(
      /Nothing is staged/
    );

    await stage(IDS.cage, STICK, 'JOY_BTN21');
    const guide = (await stage(IDS.atc, STICK, 'JOY_BTN21')) as GuideView;
    expect(guide.staged.every((s) => s.clashesWith.length === 1)).toBe(true);
    await expect(app.invoke('ai-assist:reviewStaged', { aircraftId: HORNET })).rejects.toThrow(
      /Two staged changes use Button 21/
    );
    const one = await app.invoke<GuideView>('ai-assist:unstage', {
      aircraftId: HORNET,
      id: guide.staged[0]!.id,
    });
    expect(one.staged).toHaveLength(1);
    const none = await app.invoke<GuideView>('ai-assist:unstage', { aircraftId: HORNET });
    expect(none.staged).toEqual([]);
  });

  it('saves progress and staged changes in its data folder, so they survive a restart', async () => {
    await start();
    await app.invoke('ai-assist:stage', {
      aircraftId: HORNET,
      actionId: IDS.cage,
      deviceGuid: STICK,
      input: 'JOY_BTN21',
    });
    await app.invoke<Progress>('ai-assist:setProgress', {
      aircraftId: HORNET,
      itemId: 'pitch-roll',
      state: 'done',
      current: 'rudder',
    });
    await app.invoke<Progress>('ai-assist:setProgress', {
      aircraftId: HORNET,
      itemId: 'rudder',
      state: 'skipped',
    });
    await app.invoke<Progress>('ai-assist:setCurrent', { aircraftId: HORNET, itemId: 'thrust' });

    // A fresh service on the same data folder: what the app sees after a restart.
    const again = new AiAssist({
      ports: app.ports,
      log: app.wiring.context.log,
      bindings: app.wiring.context.bindings,
    });
    const guide = await again.guide(HORNET);
    if (!guide.ok) throw new Error(guide.error.message);
    expect(guide.value.progress).toEqual({
      done: ['pitch-roll'],
      skipped: ['rudder'],
      current: 'thrust',
    });
    expect(guide.value.staged.map((s) => s.input)).toEqual(['JOY_BTN21']);

    const reopened = await app.invoke<Progress>('ai-assist:setProgress', {
      aircraftId: HORNET,
      itemId: 'rudder',
      state: 'open',
    });
    expect(reopened.skipped).toEqual([]);
    const reset = await app.invoke<Progress>('ai-assist:resetProgress', { aircraftId: HORNET });
    expect(reset).toMatchObject({ done: [], skipped: [] });
    expect(reset.staged).toHaveLength(1);
  });
});

describe('AI help with a key', () => {
  it('shows only the last four characters of the key, tests it, and keeps the model as a setting', async () => {
    await start();
    await storeKey();
    const status = await app.invoke<AiStatus>('ai-assist:status');
    expect(status).toMatchObject({ keyPresent: true, keyHint: '…EFGH' });
    expect(JSON.stringify(status)).not.toContain(KEY);
    expect(status.whatIsSent.join(' ')).toMatch(/Never sent: file paths, device ids/);

    app.ports.http.respond('/v1/models/claude-opus-5-5', { json: { id: 'claude-opus-5-5' } });
    const tested = await app.invoke<{ valid: boolean; message: string }>('ai-assist:testKey');
    expect(tested).toEqual({ valid: true, message: 'The key works with Claude Opus 5.5.' });

    const sonnet = await app.invoke<AiStatus>('ai-assist:setModel', { model: 'claude-sonnet-5-5' });
    expect(sonnet.model).toBe('claude-sonnet-5-5');
    await expect(app.invoke('ai-assist:setModel', { model: 'gpt-x' })).rejects.toThrow(
      /Unknown model/
    );

    await app.invoke('settings:clearAiKey');
    expect((await app.invoke<AiStatus>('ai-assist:status')).keyPresent).toBe(false);
    await expect(app.invoke('ai-assist:testKey')).rejects.toThrow(/No Anthropic API key/);
  });

  it('shows the exact request first, sends it unchanged, and turns the answer into a reviewable list', async () => {
    await start();
    await storeKey();
    const prepared = await app.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: HORNET,
      kind: 'suggest',
    });
    expect(app.ports.http.calls).toEqual([]);
    expect(prepared.body).not.toContain(KEY);
    expect(prepared.body).not.toContain(STICK);
    expect(prepared.contents[0]).toMatch(/^1072 actions of the F\/A-18C/);
    expect(prepared.approxTokens).toBeGreaterThan(10_000);

    app.ports.http.respond(
      'api.anthropic.com/v1/messages',
      suggestionAnswer([
        {
          actionId: IDS.atc,
          device: 'dev9',
          input: 'JOY_BTN7',
          priority: 'should',
          reason: 'Thumb reach.',
        },
        {
          actionId: IDS.gear,
          device: 'dev10',
          input: 'JOY_BTN21',
          priority: 'must',
          reason: 'Gear on the throttle.',
        },
        { actionId: 'key:fake', device: 'dev9', input: 'JOY_BTN9', priority: 'must', reason: 'x' },
      ])
    );
    const sent = await app.invoke<Extract<Sent, { kind: 'suggest' }>>('ai-assist:send', {
      requestId: prepared.requestId,
    });
    // Exactly what was shown.
    expect(JSON.stringify(JSON.parse(prepared.body))).toBe(app.ports.http.calls[0]!.body);
    expect(sent.suggestions.map((s) => [s.label, s.deviceName, s.inputLabel, s.replaces])).toEqual([
      ['Auto-throttle on/off', 'WINWING Orion Joystick Base 2 + JGRIP-F16', 'Button 7', []],
      [
        'Gear: toggle',
        'WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R',
        'Button 21',
        ['Pilot Salute'],
      ],
    ]);
    expect(sent.dropped).toHaveLength(1);
    expect(sent.usage).toMatchObject({
      input: 1200,
      output: 900,
      cacheWrite: 30000,
      model: 'claude-opus-5-5',
    });
    expect(sent.usage.cost).toBeGreaterThan(0);
    expect(JSON.stringify(sent)).not.toContain(THROTTLE);
    await expect(app.invoke('ai-assist:send', { requestId: prepared.requestId })).rejects.toThrow(
      /no longer ready/
    );

    // Nothing is applied until reviewed: the review is the bindings feature's exact plan.
    const file = await diffFile(app.home, 'WINWING THROTTLE');
    const before = await fs.readFile(file, 'utf8');
    const plan = await app.invoke<PlanView>('ai-assist:reviewSuggestions', {
      roundId: sent.roundId,
      selected: ['s2'],
    });
    expect(plan.files.map((f) => f.lines)).toEqual([
      ['Pilot Salute: remove Button 21', 'Landing Gear Control Handle - UP/DOWN: bind Button 21'],
    ]);
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    await expect(
      app.invoke('ai-assist:reviewSuggestions', { roundId: sent.roundId, selected: [] })
    ).rejects.toThrow(/Tick at least one/);

    const applied = await app.invoke<AppliedView>('ai-assist:applySuggestions', {
      roundId: sent.roundId,
      selected: ['s2'],
    });
    expect(applied.summary).toBe('Bind 1 action suggested by AI');
    expect(await fs.readFile(file, 'utf8')).toContain('Landing Gear Control Handle - UP/DOWN');

    // The key is in no file RigReady or the bindings feature wrote: settings, journal, backups, bindings.
    for (const text of await allText(app.home)) expect(text).not.toContain(KEY);
  });

  it('refuses ticked suggestions that fight over one control, and a model answer that does not check out', async () => {
    await start();
    await storeKey();
    app.ports.http.scripts.push({
      match: { url: '/v1/messages' },
      times: 1,
      response: {
        status: 200,
        headers: {},
        ...suggestionAnswer([
          { actionId: IDS.atc, device: 'dev9', input: 'JOY_BTN7', priority: 'must', reason: 'a' },
          { actionId: IDS.cage, device: 'dev9', input: 'JOY_BTN7', priority: 'must', reason: 'b' },
        ]),
      },
    });
    app.ports.http.respond(
      '/v1/messages',
      streamedMessage('I will bind everything to button 1 and write to C:\\Windows.')
    );
    const first = await app.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: HORNET,
      kind: 'suggest',
    });
    const round = await app.invoke<Extract<Sent, { kind: 'suggest' }>>('ai-assist:send', {
      requestId: first.requestId,
    });
    expect(round.suggestions.every((s) => !s.selected)).toBe(true);
    await expect(
      app.invoke('ai-assist:applySuggestions', { roundId: round.roundId, selected: ['s1', 's2'] })
    ).rejects.toThrow(/both use Button 7/);
    await expect(
      app.invoke('ai-assist:applySuggestions', { roundId: 'round999', selected: ['s1'] })
    ).rejects.toThrow(/no longer available/);

    const second = await app.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: HORNET,
      kind: 'suggest',
    });
    await expect(app.invoke('ai-assist:send', { requestId: second.requestId })).rejects.toThrow(
      /not the structured list/
    );
    const journal = await app.ports.files.journalGroups();
    expect(journal.ok && journal.value).toEqual([]);
  });

  it('answers questions and explains actions as plain text, and drafts a guide for an aircraft without one', async () => {
    await start();
    await storeKey();
    const text = (t: string) => ({
      json: {
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: t }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    });
    app.ports.http.scripts.push({
      match: { url: '/v1/messages', body: 'Task: explain the action' },
      response: { status: 200, headers: {}, ...text('It drops bombs.') },
    });
    app.ports.http.scripts.push({
      match: { url: '/v1/messages', body: 'Question:' },
      response: { status: 200, headers: {}, ...text('You have no hook bound.') },
    });
    // The gunner position has no shipped guide; the draft must name its real actions.
    const reader = app.wiring.context.bindings.get('dcs')!;
    const actions = await reader.actions!('UH-1H_Gunner');
    if (!actions.ok) throw new Error(actions.error.message);
    app.ports.http.scripts.push({
      match: { url: '/v1/messages', body: 'write a binding guide' },
      response: {
        status: 200,
        headers: {},
        ...streamedMessage(
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
                actionIds: [actions.value[0]!.id],
              },
            ],
          })
        ),
      },
    });

    const explain = await app.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: HORNET,
      kind: 'explain',
      actionId: IDS.pickle,
    });
    const explained = await app.invoke<Extract<Sent, { kind: 'answer' }>>('ai-assist:send', {
      requestId: explain.requestId,
    });
    expect(explained).toMatchObject({
      kind: 'answer',
      question: 'What does "Weapon Release Button" do?',
      text: 'It drops bombs.',
    });

    const ask = await app.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: HORNET,
      kind: 'ask',
      question: 'What am I missing for carrier landings?',
    });
    expect(ask.contents).toContain('Your question: "What am I missing for carrier landings?"');
    const answered = await app.invoke<Extract<Sent, { kind: 'answer' }>>('ai-assist:send', {
      requestId: ask.requestId,
    });
    expect(answered.text).toBe('You have no hook bound.');
    await expect(
      app.invoke('ai-assist:prepare', { aircraftId: HORNET, kind: 'ask', question: '  ' })
    ).rejects.toThrow(/Type a question/);
    await expect(
      app.invoke('ai-assist:prepare', { aircraftId: HORNET, kind: 'explain', actionId: 'key:nope' })
    ).rejects.toThrow(/no such action/);

    const draft = await app.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: 'UH-1H_Gunner',
      kind: 'draft',
    });
    const drafted = await app.invoke<Extract<Sent, { kind: 'draft' }>>('ai-assist:send', {
      requestId: draft.requestId,
    });
    expect(drafted).toMatchObject({ kind: 'draft', items: 1, dropped: 0 });
    const guide = await app.invoke<GuideView>('ai-assist:guide', { aircraftId: 'UH-1H_Gunner' });
    expect(guide.guide).toMatchObject({ kind: 'drafted', drafted: { by: 'claude-opus-5-5' } });
    expect(guide.tiers[0]!.items[0]!.title).toBe('Fire');
    const list = await app.invoke<{ aircraft: { id: string; guide: string | null }[] }>(
      'ai-assist:aircraft'
    );
    expect(list.aircraft.find((a) => a.id === 'UH-1H_Gunner')?.guide).toBe('drafted');
    expect(await app.invoke('ai-assist:deleteDraft', { aircraftId: 'UH-1H_Gunner' })).toEqual({
      deleted: true,
    });
    expect(await app.invoke('ai-assist:deleteDraft', { aircraftId: 'UH-1H_Gunner' })).toEqual({
      deleted: false,
    });
  });

  it('logs what happened and the token counts, never the key or the request', async () => {
    await start();
    await storeKey();
    const lines: string[] = [];
    const record = (m: string): void => void lines.push(m);
    const log: Logger = {
      debug: record,
      info: record,
      warn: record,
      error: record,
      child: () => log,
    };
    const ai = new AiAssist({ ports: app.ports, log, bindings: app.wiring.context.bindings });
    app.ports.http.scripts.push({
      match: { url: '/v1/messages' },
      times: 1,
      response: { status: 401, headers: {}, json: { error: { message: `invalid ${KEY}` } } },
    });
    app.ports.http.respond('/v1/messages', suggestionAnswer([]));
    const failing = await ai.prepare({ kind: 'suggest', aircraftId: HORNET });
    if (!failing.ok) throw new Error(failing.error.message);
    const failed = await ai.send(failing.value.requestId);
    expect(!failed.ok && failed.error.code).toBe('ai.key');
    expect(JSON.stringify(failed)).not.toContain(KEY);
    const working = await ai.prepare({ kind: 'suggest', aircraftId: HORNET });
    if (!working.ok) throw new Error(working.error.message);
    expect((await ai.send(working.value.requestId)).ok).toBe(true);
    expect(lines.join('\n')).toContain('suggest answered by claude-opus-5-5: 1200 in');
    expect(lines.join('\n')).not.toContain(KEY);
    expect(lines.join('\n')).not.toContain('Weapon Release Button');
  });
});

describe('a streamed request: progress, cancel, and answers that never complete', () => {
  const ITEMS = [
    { actionId: IDS.atc, device: 'dev9', input: 'JOY_BTN7', priority: 'should', reason: 'Thumb.' },
    { actionId: IDS.gear, device: 'dev10', input: 'JOY_BTN21', priority: 'must', reason: 'Gear.' },
    { actionId: 'key:fake', device: 'dev9', input: 'JOY_BTN9', priority: 'must', reason: 'x' },
  ];
  const progressOf = (): SendProgress[] =>
    app.events.filter((e) => e.channel.endsWith('sendProgress')).map((e) => e.payload as never);
  const suggest = (): Promise<Prepared> =>
    app.invoke<Prepared>('ai-assist:prepare', { aircraftId: HORNET, kind: 'suggest' });

  it('streams the long requests only, and says so before anything is sent', async () => {
    await start();
    await storeKey();
    const long = await suggest();
    expect(long.streamed).toBe(true);
    expect(JSON.parse(long.body).stream).toBe(true);
    const draft = await app.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: 'UH-1H_Gunner',
      kind: 'draft',
    });
    expect(draft.streamed).toBe(true);
    const short = await app.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: HORNET,
      kind: 'ask',
      question: 'Why?',
    });
    expect(short.streamed).toBe(false);
    expect('stream' in JSON.parse(short.body)).toBe(false);
    // A short request has nothing to cancel.
    expect(await app.invoke('ai-assist:cancel', { requestId: short.requestId })).toEqual({
      cancelled: false,
    });
  });

  it('reports that the model started and the suggestions received so far, and uses the answer only when it is complete', async () => {
    await start();
    await storeKey();
    // Cut every 23 bytes, so items finish in the middle of chunks.
    app.ports.http.respond(
      '/v1/messages',
      streamedMessage(planText(ITEMS), { usage: USAGE, pieceChars: 30, chunkBytes: 23 })
    );
    const prepared = await suggest();
    const sent = await app.invoke<Extract<Sent, { kind: 'suggest' }>>('ai-assist:send', {
      requestId: prepared.requestId,
    });
    const progress = progressOf();
    expect(progress[0]).toEqual({
      requestId: prepared.requestId,
      phase: 'started',
      chars: 0,
      items: 0,
    });
    const receiving = progress.slice(1);
    expect(receiving.every((p) => p.phase === 'receiving')).toBe(true);
    // Each finished item is reported when it finishes: 0, then 1, 2, 3, with the text growing.
    expect(receiving.map((p) => p.items)).toEqual([0, 1, 2, 3]);
    expect(receiving.map((p) => p.chars)).toEqual(
      [...receiving.map((p) => p.chars)].sort((a, b) => a - b)
    );
    expect(receiving.at(-1)!.chars).toBeLessThanOrEqual(planText(ITEMS).length);
    // No progress event carries any of the answer.
    expect(JSON.stringify(progress)).not.toContain('JOY_BTN');
    // The complete answer went through the same checks as ever: the made-up action is left out.
    expect(sent.suggestions).toHaveLength(2);
    expect(sent.dropped).toHaveLength(1);
    expect(sent.usage).toMatchObject({ input: 1200, output: 900, cacheWrite: 30000 });
  });

  it('reports text progress by the clock when no item finishes', async () => {
    await start();
    await storeKey();
    const lines: SendProgress[] = [];
    const ai = new AiAssist({
      ports: app.ports,
      log: app.ctx.log,
      bindings: app.wiring.context.bindings,
      onProgress: (p) => {
        lines.push(p);
        // Every second report comes after "a while"; the ones in between are too soon.
        if (lines.length % 2 === 0) app.clock.advance(1000);
      },
    });
    app.ports.http.respond(
      '/v1/messages',
      streamedMessage(planText([]), { usage: USAGE, pieceChars: 4 })
    );
    const prepared = await ai.prepare({ kind: 'suggest', aircraftId: HORNET });
    if (!prepared.ok) throw new Error(prepared.error.message);
    expect((await ai.send(prepared.value.requestId)).ok).toBe(true);
    const pieces = Math.ceil(planText([]).length / 4);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.length).toBeLessThan(pieces);
    expect(lines.every((p) => p.items === 0)).toBe(true);
  });

  it('Cancel aborts the request on its way: nothing of the answer is used, and there is nothing left to cancel', async () => {
    await start();
    await storeKey();
    // Two whole suggestions arrive, then nothing more: the request would wait for the idle timeout.
    const events = messageEvents(planText(ITEMS), { usage: USAGE, pieceChars: 30 });
    const text = planText(ITEMS);
    const keep = 6 + Math.ceil(text.indexOf('key:fake') / 30);
    app.ports.http.respond('/v1/messages', {
      stream: streamOf(events.slice(0, keep), { end: 'hang' }),
    });
    const prepared = await suggest();
    const started = Date.now();
    const sending = app.invoke('ai-assist:send', { requestId: prepared.requestId });
    sending.catch(() => undefined); // asserted below; not unhandled in the meantime
    await vi.waitFor(() => expect(progressOf().at(-1)?.items).toBe(2));
    expect(await app.invoke('ai-assist:cancel', { requestId: prepared.requestId })).toEqual({
      cancelled: true,
    });
    await expect(sending).rejects.toThrow('Cancelled. Nothing from the answer was used.');
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await app.invoke('ai-assist:cancel', { requestId: prepared.requestId })).toEqual({
      cancelled: false,
    });
    // The two suggestions that had arrived are nowhere: no round, nothing written.
    await expect(
      app.invoke('ai-assist:reviewSuggestions', { roundId: 'round1', selected: ['s1'] })
    ).rejects.toThrow(/no longer available/);
    const journal = await app.ports.files.journalGroups();
    expect(journal.ok && journal.value).toEqual([]);
    // The request is used up, as after any send.
    await expect(app.invoke('ai-assist:send', { requestId: prepared.requestId })).rejects.toThrow(
      /no longer ready/
    );
  });

  it('ends a stalled, broken or failing stream with a plain message and keeps nothing of it', async () => {
    await start();
    await storeKey();
    const lines: string[] = [];
    const record = (m: string): void => void lines.push(m);
    const log: Logger = {
      debug: record,
      info: record,
      warn: record,
      error: record,
      child: () => log,
    };
    const ai = new AiAssist({
      ports: app.ports,
      log,
      bindings: app.wiring.context.bindings,
      streamIdleMs: 40,
    });
    const partial = messageEvents(planText(ITEMS), { pieceChars: 30 }).slice(0, 9);
    const attempt = async (response: Parameters<typeof app.ports.http.respond>[1]) => {
      app.ports.http.scripts.length = 0;
      app.ports.http.respond('/v1/messages', response);
      const prepared = await ai.prepare({ kind: 'suggest', aircraftId: HORNET });
      if (!prepared.ok) throw new Error(prepared.error.message);
      const sent = await ai.send(prepared.value.requestId);
      if (sent.ok) throw new Error('expected a failure');
      return sent.error;
    };
    expect(await attempt({ stream: streamOf(partial, { end: 'hang' }) })).toMatchObject({
      code: 'ai.stalled',
      message: expect.stringMatching(/stopped arriving.*nothing from it was used/),
    });
    expect(await attempt({ stream: streamOf(partial, { end: 'reset' }) })).toMatchObject({
      code: 'ai.interrupted',
    });
    expect(await attempt({ stream: streamOf(partial) })).toMatchObject({ code: 'ai.incomplete' });
    expect(
      await attempt({
        stream: streamOf([
          ...partial,
          {
            event: 'error',
            data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
          },
        ]),
      })
    ).toMatchObject({
      code: 'ai.unavailable',
      message: 'The Anthropic API is busy or down right now. Try again in a few minutes.',
      detail: 'Anthropic said: Overloaded',
    });
    expect(
      await attempt(streamedMessage(planText(ITEMS).slice(0, 200), { stopReason: 'max_tokens' }))
    ).toMatchObject({ code: 'ai.truncated' });
    // A complete stream whose text is not the plan asked for is refused by the same check as before.
    expect(await attempt(streamedMessage('{"summary":"x","items":"all of them"}'))).toMatchObject({
      code: 'ai.invalid',
    });
    expect(lines.filter((l) => l.includes('failed')).map((l) => l.split(': ').at(-1))).toEqual([
      'ai.stalled',
      'ai.interrupted',
      'ai.incomplete',
      'ai.unavailable',
      'ai.truncated',
    ]);
    const journal = await app.ports.files.journalGroups();
    expect(journal.ok && journal.value).toEqual([]);
  });
});
