import { afterEach, describe, expect, it } from 'vitest';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import { BINDING_FILES, HORNET, HUEY, bindingsFor } from '../../../../tests/dcsBindings';
import type { DcsBindings } from './bindings';
import { copyOps, previewCopy } from './copy';
import { applyEdits, planEdits } from './edits';

let rig: TestRig;
let bindings: DcsBindings;
afterEach(() => rig?.cleanup());

describe('copying common controls between aircraft', () => {
  it('proposes F/A-18C stick and throttle controls for the UH-1H, and the ticked ones are bound on the same inputs', async () => {
    rig = await scenarioRig('flying-fresh', { files: BINDING_FILES });
    bindings = bindingsFor(rig);
    const hornet = await bindings.view(HORNET);
    if (!hornet.ok) throw new Error(hornet.error.message);
    const devices = hornet.value.devices
      .filter((d) => d.role === 'stick' || d.role === 'throttle')
      .map((d) => d.id);
    expect(devices).toHaveLength(2);

    const preview = await previewCopy(bindings, HORNET, HUEY, devices);
    if (!preview.ok) throw new Error(preview.error.message);
    expect(preview.value).toMatchObject({ from: 'F/A-18C', to: 'UH-1H' });
    const byLabel = (label: string, device: string) =>
      preview.value.proposals.filter((p) => p.label === label && p.deviceName.includes(device));

    // The same DCS command exists in both aircraft: view centre and zoom.
    expect(byLabel('Button 19', 'Orion')[0]).toMatchObject({
      from: { name: 'View Center' },
      to: { name: 'Center View' },
      match: 'same',
      selected: true,
      already: false,
      replaces: [],
    });
    expect(byLabel('Button 42', 'THROTTLE')[0]).toMatchObject({
      to: { name: 'Zoom in slow' },
      match: 'same',
      selected: true,
    });
    expect(byLabel('Button 40', 'THROTTLE')[0]).toMatchObject({ to: { name: 'Zoom out slow' } });
    // The same kind of control under another name: the trigger and the radio switch.
    expect(byLabel('Button 5', 'Orion')[0]).toMatchObject({
      from: { name: 'Gun Trigger - SECOND DETENT (Press to shoot)' },
      to: { name: 'Pilot weapon release/Machinegun fire' },
      match: 'equivalent',
      selected: true,
      // In the Huey, Button 5 centres the view by default; the copy would take that away.
      replaces: ['Center View'],
    });
    expect(byLabel('Button 6', 'THROTTLE')[0]).toMatchObject({
      to: { name: "Pilot's radio trigger RADIO (call radio menu)" },
      match: 'equivalent',
    });
    // The Huey has no trim hat: its force trim is offered as the closest action, not ticked.
    const trim = preview.value.proposals.filter((p) => p.from.name.startsWith('Trimmer Switch'));
    expect(trim).toHaveLength(4);
    expect(trim.every((p) => p.match === 'closest' && !p.selected)).toBe(true);
    expect(trim[0]!.to.name).toBe('Pilot Trimmer');
    // The pitch curve the user set comes along with the axis.
    expect(byLabel('Y axis', 'Orion')[0]).toMatchObject({
      from: { name: 'Pitch' },
      to: { name: 'Flight Control Cyclic Pitch' },
      // The same engine command (2001) under the Huey's name for it.
      match: 'same',
      combo: { filter: { curvature: [0.15] } },
    });
    // Hornet-only actions have no counterpart and are listed, not dropped silently.
    expect(preview.value.unmatched.map((u) => u.name)).toEqual(
      expect.arrayContaining([
        'Sensor Control Switch - Fwd',
        'Select AMRAAM',
        'Speed Brake Switch - EXTEND',
      ])
    );

    // The user ticks the defaults plus the trim-hat-up proposal.
    const hatUp = trim.find((p) => p.label === 'Hat 1 up')!;
    const selected = [
      ...preview.value.proposals.filter((p) => p.selected).map((p) => p.id),
      hatUp.id,
    ];
    const ops = copyOps(preview.value, HUEY, selected);
    expect(ops.length).toBe(selected.length);
    const plan = await planEdits(bindings, ops, 'Copy controls from F/A-18C to UH-1H');
    if (!plan.ok) throw new Error(plan.error.message);
    expect(plan.value.files.map((f) => [f.action, f.title])).toEqual([
      ['create', 'WINWING Orion Joystick Base 2 + JGRIP-F16 · UH-1H'],
      ['create', 'WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R · UH-1H'],
    ]);
    expect(plan.value.files[0]!.lines).toEqual(
      expect.arrayContaining([
        "Center View: cancel DCS's default Button 5",
        'Pilot weapon release/Machinegun fire: bind Button 5',
        'Center View: bind Button 19',
        'Pilot Trimmer: bind Hat 1 up',
        'Flight Control Cyclic Pitch: set Y axis to curve 0.15',
      ])
    );
    expect((await applyEdits(bindings, ops, 'Copy controls from F/A-18C to UH-1H')).ok).toBe(true);

    const huey = await bindings.view(HUEY);
    if (!huey.ok) throw new Error(huey.error.message);
    const name = (id: string) => huey.value.commands.find((c) => c.id === id)!.name;
    const on = (device: string, key: string) =>
      huey.value.devices
        .find((d) => d.name.includes(device))!
        .bindings.filter((b) => b.combo.key === key && !b.inert)
        .map((b) => name(b.commandId));
    // Trim, view centre and zoom are on the same inputs as in the Hornet.
    expect(on('Orion', 'JOY_BTN_POV1_U')).toEqual(['Pilot Trimmer']);
    expect(on('Orion', 'JOY_BTN19')).toEqual(['Center View']);
    expect(on('Orion', 'JOY_BTN36')).toEqual(['Center View']);
    expect(on('THROTTLE', 'JOY_BTN42')).toEqual(['Zoom in slow']);
    expect(on('THROTTLE', 'JOY_BTN40')).toEqual(['Zoom out slow']);
    expect(on('Orion', 'JOY_BTN5')).toEqual(['Pilot weapon release/Machinegun fire']);
    // The other three hat directions were not ticked and keep the default view.
    expect(on('Orion', 'JOY_BTN_POV1_D')).toEqual(['View Down slow']);

    // Asking again: what was copied is now "already there" and no longer proposed by default.
    const again = await previewCopy(bindings, HORNET, HUEY, devices);
    if (!again.ok) throw new Error(again.error.message);
    const center = again.value.proposals.find((p) => p.label === 'Button 19')!;
    expect(center).toMatchObject({ already: true, selected: false });
    expect(copyOps(again.value, HUEY, [center.id])).toEqual([]);
    // Unknown aircraft and devices that are not in both are handled.
    expect(await previewCopy(bindings, 'Nope', HUEY, devices)).toMatchObject({ ok: false });
    expect(await previewCopy(bindings, HORNET, 'Nope', devices)).toMatchObject({ ok: false });
    const none = await previewCopy(bindings, HORNET, HUEY, ['joystick/Unknown']);
    expect(none.ok && none.value.proposals).toEqual([]);
  });
});
