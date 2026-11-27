import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { BindingProposal, BindingProposals } from '../../../core/bindings';
import { err } from '../../../core/result';
import type { ChangeResult, Overview } from '../contract';
import { REGISTRY_KEY } from './view';

/**
 * Several bindings proposed by another feature (a setup suggested by AI), on
 * fixtures/scenarios/nuclear-option-bindings.yaml: shown first, written as one entry of the
 * Safety page through FileStore, undone as one, refused while the game runs.
 */
const STICK = 'controller:044F:0402:0';
const THROTTLE = 'controller:044F:0404:0';
const STICK_GUID = '3A7C1E20-7A11-11EF-8001-444553540000';
const THROTTLE_GUID = '3A7C1E21-7A11-11EF-8002-444553540000';

const bind = (deviceGuid: string, input: string, actionId: string) =>
  ({ op: 'bind', deviceGuid, input, actionId }) as const;

/** Nav lights on the stick's trigger, pitch where it is, Zoom In and a custom axis moved. */
const SETUP: BindingProposal = {
  aircraftId: 'all',
  summary: 'Bind 4 actions suggested by AI',
  changes: [
    bind(STICK_GUID, 'JOY_BTN1', '49'),
    bind(STICK_GUID, 'JOY_Y', '0'),
    bind(THROTTLE_GUID.toLowerCase(), 'JOY_BTN18', '25:+'),
    bind(THROTTLE_GUID, 'JOY_Z', '38'),
  ],
};

describe('several Nuclear Option bindings proposed as one change', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });
  const start = async (): Promise<WiredApp> => (app = await wiredApp('nuclear-option-bindings'));
  const proposals = (a: WiredApp): BindingProposals =>
    a.wiring.context.bindings.get('nuclear-option')!.proposals!;
  const values = async (a: WiredApp): Promise<Record<string, unknown>> => {
    const all = await a.ports.registry.listValues('HKCU', REGISTRY_KEY);
    if (!all.ok) throw new Error(all.error.message);
    return all.value;
  };
  const rows = async (a: WiredApp, id: string): Promise<string[]> => {
    const view = await a.invoke<Overview>('nuclear-option-bindings:overview');
    return view.devices
      .find((d) => d.id === id)!
      .bindings.map((b) => `${b.action} = ${b.inputLabel}${b.inverted ? ', reversed' : ''}`);
  };
  const journal = async (a: WiredApp) => {
    const groups = await a.ports.files.journalGroups();
    if (!groups.ok) throw new Error(groups.error.message);
    return groups.value;
  };

  it('shows every change first, device by device, and writes nothing', async () => {
    const a = await start();
    const before = await values(a);
    const plan = await proposals(a).plan(SETUP);
    if (!plan.ok) throw new Error(plan.error.message);
    expect(plan.value.summary).toBe('Bind 4 actions suggested by AI');
    expect(plan.value.blocked).toBeUndefined();
    expect(plan.value.files.map((f) => [f.title, f.action, f.lines])).toEqual([
      [
        'Nuclear Option’s saved bindings for Joystick - HOTAS Warthog (registry)',
        'change',
        // What the trigger did goes: a proposed binding takes the control over.
        ['Toggle Navigation Lights: Button 1', 'Button 1 no longer does Fire'],
      ],
      [
        'Nuclear Option’s saved bindings for Throttle - HOTAS Warthog (registry)',
        'change',
        [
          'Zoom In: Button 18 (was Button 7)',
          'Button 18 no longer does Toggle Gear',
          'Custom Axis 1: Z axis (was Slider 1)',
          'Z axis no longer does Throttle Axis',
        ],
      ],
    ]);
    // Pitch is on that axis already, reversed, and stays so.
    expect(plan.value.notes).toEqual(['1 of these is bound so already and is left as it is.']);
    expect(await values(a)).toEqual(before);
    expect(await journal(a)).toEqual([]);
  });

  it('writes them as one entry of the Safety page, the readers show them, and its Undo puts every value back', async () => {
    const a = await start();
    const before = await values(a);
    let notified = 0;
    a.wiring.context.bindings.onChanged((c) => {
      if (c.game === 'nuclear-option') notified++;
    });
    expect((await proposals(a).plan(SETUP)).ok).toBe(true);
    const applied = await proposals(a).apply(SETUP);
    if (!applied.ok) throw new Error(applied.error.message);
    expect(applied.value).toMatchObject({ summary: 'Bind 4 actions suggested by AI', files: 2 });
    expect(notified).toBe(1);

    const stick = await rows(a, STICK);
    expect(stick).toContain('Toggle Navigation Lights = Button 1');
    expect(stick).not.toContain('Fire = Button 1');
    // The reversal the player set is kept.
    expect(stick).toContain('Pitch Axis = Y axis, reversed');
    const throttle = await rows(a, THROTTLE);
    expect(throttle).toContain('Zoom In = Button 18');
    expect(throttle).toContain('Zoom Out = Button 8');
    expect(throttle).toContain('Custom Axis 1 = Z axis');
    expect(throttle.some((r) => r.startsWith('Toggle Gear'))).toBe(false);
    expect(throttle.some((r) => r.startsWith('Throttle Axis'))).toBe(false);
    // What the proposal did not name is as it was, the half axis RigReady does not write too.
    expect(throttle).toContain('Eject = Button 32');
    expect(throttle).toContain('Apply Brakes = Z rotation (positive half)');

    const groups = await journal(a);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.id).toBe(applied.value.groupId);
    expect(groups[0]!.reason).toBe('Nuclear Option bindings: Bind 4 actions suggested by AI');
    expect(groups[0]!.entries).toHaveLength(2);

    // Written again, there is nothing left to do.
    const again = await proposals(a).plan(SETUP);
    expect(again.ok && again.value.files).toEqual([]);
    expect(again.ok && again.value.notes).toEqual([
      '4 of these are bound so already and are left as they are.',
    ]);
    const nothing = await proposals(a).apply(SETUP);
    expect(!nothing.ok && nothing.error.message).toContain('Nothing was written');

    const undone = await proposals(a).undo(applied.value.groupId);
    expect(undone.ok).toBe(true);
    expect(notified).toBe(2);
    expect(await values(a)).toEqual(before);
  });

  it('writes each binding as the page writes one: the same bytes as the changes made one at a time', async () => {
    const a = await start();
    // On controls nothing else is on, so that taking over changes nothing more.
    const proposal: BindingProposal = {
      aircraftId: 'all',
      summary: 'Bind 2 actions suggested by AI',
      changes: [bind(STICK_GUID, 'JOY_BTN12', '49'), bind(STICK_GUID, 'JOY_BTN13', '52')],
    };
    expect((await proposals(a).plan(proposal)).ok).toBe(true);
    const applied = await proposals(a).apply(proposal);
    expect(applied.ok).toBe(true);
    const together = await values(a);
    expect((await proposals(a).undo(applied.ok ? applied.value.groupId : '')).ok).toBe(true);
    for (const [actionId, button] of [
      [49, 12],
      [52, 13],
    ]) {
      const saved = await a.invoke<ChangeResult>('nuclear-option-bindings:change', {
        device: STICK,
        actionId,
        button,
      });
      expect(saved.changed).toBe(true);
    }
    expect(await values(a)).toEqual(together);
  });

  it('is refused while the game runs, to write and to undo, and when the bindings changed after they were shown', async () => {
    const a = await start();
    const before = await values(a);
    const shown = await proposals(a).plan(SETUP);
    expect(shown.ok).toBe(true);
    // Meanwhile the game was run and saved a change of its own (here: another binding).
    await a.invoke('nuclear-option-bindings:change', { device: STICK, actionId: 52, button: 13 });
    const between = await values(a);
    expect(between).not.toEqual(before);
    const stale = await proposals(a).apply(SETUP);
    expect(!stale.ok && stale.error.message).toContain('changed after the changes were shown');
    expect(await values(a)).toEqual(between);

    // Looked at again, it is written.
    expect((await proposals(a).plan(SETUP)).ok).toBe(true);
    const applied = await proposals(a).apply(SETUP);
    if (!applied.ok) throw new Error(applied.error.message);
    const after = await values(a);

    await mutate(a, [
      { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
    ]);
    const plan = await proposals(a).plan(SETUP);
    expect(plan.ok && plan.value.blocked).toContain('Close Nuclear Option first');
    const running = await proposals(a).apply(SETUP);
    expect(!running.ok && running.error.message).toContain('Close Nuclear Option first');
    const undo = await proposals(a).undo(applied.value.groupId);
    expect(!undo.ok && undo.error.message).toContain('Close Nuclear Option first');
    expect(await values(a)).toEqual(after);
  });

  it('refuses the whole list when one change cannot be made, saying which and why', async () => {
    const a = await start();
    const before = await values(a);
    const refused = async (changes: BindingProposal['changes']): Promise<string> => {
      const proposal = { aircraftId: 'all', summary: 'Bind', changes };
      const plan = await proposals(a).plan(proposal);
      const apply = await proposals(a).apply(proposal);
      if (plan.ok || apply.ok) throw new Error('not refused');
      return plan.error.message;
    };
    // An action of another tab of the game's screen belongs in that tab's map.
    expect(await refused([bind(THROTTLE_GUID, 'JOY_BTN20', '34')])).toMatch(
      /^Submit Chat belongs to the Chat tab of the game’s controls screen\./
    );
    const good = bind(STICK_GUID, 'JOY_BTN12', '49');
    expect(await refused([])).toBe('Nothing to change.');
    // A hat: how the game saves one is not known.
    expect(await refused([good, bind(STICK_GUID, 'JOY_BTN_POV1_U', '52')])).toMatch(
      /^Link Guns: RigReady binds a button or an axis of a controller in Nuclear Option\. How the game saves a hat is not known/
    );
    // A key, and a clear, are the page's.
    expect(await refused([{ op: 'bind', input: 'F7', actionId: '49' }])).toContain(
      'Bind a key on the Nuclear Option bindings page'
    );
    expect(await refused([{ ...good, op: 'unbind' }])).toContain('Clear a binding on');
    expect(
      await refused([bind('00000000-0000-0000-0000-000000000001', 'JOY_BTN1', '49')])
    ).toContain('has saved no bindings for that controller');
    expect(await refused([good, bind(STICK_GUID, 'JOY_BTN1', 'nonsense')])).toBe(
      'Nuclear Option has no such action.'
    );
    expect(await refused([good, bind(STICK_GUID, 'JOY_BTN1', '987')])).toBe(
      'Nuclear Option has no such action.'
    );
    // An axis action on a button, a button action on an axis, an axis the controller lacks.
    expect(await refused([good, bind(STICK_GUID, 'JOY_BTN2', '0')])).toContain(
      'Pitch Axis: Pitch Axis is an axis'
    );
    expect(await refused([good, bind(STICK_GUID, 'JOY_X', '5')])).toContain(
      'Fire: Fire is a button'
    );
    expect(await refused([good, bind(STICK_GUID, 'JOY_RZ', '2')])).toContain(
      'Yaw Axis: This controller has no axis called RZ'
    );
    // Two on one control, and one action twice.
    expect(await refused([good, bind(STICK_GUID, 'JOY_BTN12', '52')])).toContain(
      'Two of the changes use the same control of Joystick - HOTAS Warthog'
    );
    expect(await refused([good, bind(STICK_GUID, 'JOY_BTN13', '49')])).toBe(
      'Toggle Navigation Lights is in the list twice.'
    );
    const other = await proposals(a).plan({
      aircraftId: 'A-10C',
      summary: 'Bind',
      changes: [good],
    });
    expect(!other.ok && other.error.message).toContain('one set of bindings for every aircraft');
    expect(await values(a)).toEqual(before);
    expect(await journal(a)).toEqual([]);
  });

  it('writes nothing that was not shown first: a list never reviewed, and a list other than the one reviewed', async () => {
    const a = await start();
    const before = await values(a);
    const unseen = await proposals(a).apply(SETUP);
    expect(!unseen.ok && unseen.error.message).toBe(
      'These changes were not shown first, so nothing was written. Look at them, then write them.'
    );
    // A review of one list does not cover another.
    expect((await proposals(a).plan(SETUP)).ok).toBe(true);
    const other = await proposals(a).apply({ ...SETUP, changes: SETUP.changes.slice(0, 1) });
    expect(!other.ok && other.error.message).toContain('were not shown first');
    expect(await values(a)).toEqual(before);
    expect(await journal(a)).toEqual([]);
  });

  it('an action already on the control stays, and what else was on it goes', async () => {
    const a = await start();
    // Next Weapon joins Fire on the trigger, as a single change from the page leaves it.
    await a.invoke('nuclear-option-bindings:change', { device: STICK, actionId: 9, button: 1 });
    const proposal: BindingProposal = {
      aircraftId: 'all',
      summary: 'Bind 1 action suggested by AI',
      changes: [bind(STICK_GUID, 'JOY_BTN1', '5')],
    };
    const plan = await proposals(a).plan(proposal);
    expect(plan.ok && plan.value.files.map((f) => f.lines)).toEqual([
      ['Fire stays on Button 1', 'Button 1 no longer does Next Weapon'],
    ]);
    expect(plan.ok && plan.value.notes).toEqual([]);
    expect((await proposals(a).apply(proposal)).ok).toBe(true);
    const stick = await rows(a, STICK);
    expect(stick).toContain('Fire = Button 1');
    expect(stick.some((r) => r.startsWith('Next Weapon'))).toBe(false);
  });

  it('a failure after the first value was written says that part is written, and Undo takes it out', async () => {
    const a = await start();
    const before = await values(a);
    const files = a.ports.files;
    const write = files.write.bind(files);
    let writes = 0;
    files.write = (async (...args: Parameters<typeof write>) =>
      ++writes === 2
        ? err('file.write', 'The value could not be written.')
        : write(...args)) as typeof write;
    expect((await proposals(a).plan(SETUP)).ok).toBe(true);
    const applied = await proposals(a).apply(SETUP);
    files.write = write;
    expect(!applied.ok && applied.error.message).toBe(
      'The value could not be written. Part of the change was already written; Undo on the Safety page takes it out.'
    );
    expect(await values(a)).not.toEqual(before);
    const groups = await journal(a);
    expect(groups).toHaveLength(1);
    await a.invoke('safety:undo', { groupId: groups[0]!.id, force: false });
    expect(await values(a)).toEqual(before);
  });
});
